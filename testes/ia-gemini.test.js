// Testa o provedor Gemini (src/ia/provedores/gemini.js) contra um servidor
// local que imita a API do Google. Não precisa de chave real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { GoogleGenAI } from '@google/genai';
import { config } from '../src/config.js';
import { analisarEdital, AVISO_LEGAL, ErroAnalise, provedorDaIa } from '../src/ia/analisar-edital.js';
import { analisarComGemini, ESQUEMA_JSON } from '../src/ia/provedores/gemini.js';
import { ANALISE_EXEMPLO } from './fixtures/analise-exemplo.js';

let servidor;
let urlBase;
let ultimoPedido;
let proximaResposta;

before(async () => {
  servidor = http.createServer(async (req, res) => {
    let corpo = '';
    for await (const parte of req) corpo += parte;
    ultimoPedido = { caminho: req.url, cabecalhos: req.headers, corpo: JSON.parse(corpo || '{}') };

    const r = proximaResposta;
    if (r.httpStatus) {
      res.writeHead(r.httpStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: r.httpStatus, message: r.mensagem ?? 'erro simulado', status: r.statusGoogle ?? 'ERRO' } }));
      return;
    }
    const resposta = r.bloqueio
      ? { promptFeedback: { blockReason: r.bloqueio }, usageMetadata: { promptTokenCount: 100 } }
      : {
          candidates: [{
            content: { role: 'model', parts: [{ text: r.texto }] },
            finishReason: r.motivo ?? 'STOP',
            index: 0,
          }],
          usageMetadata: { promptTokenCount: 26000, candidatesTokenCount: 3000, thoughtsTokenCount: 2000, totalTokenCount: 31000 },
          modelVersion: 'gemini-4-hydrogen',
        };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(resposta));
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  urlBase = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const cliente = () => new GoogleGenAI({ apiKey: 'chave-de-teste', httpOptions: { baseUrl: urlBase } });
const PDF_FALSO = Buffer.from('%PDF-1.7\n% edital de teste\n');

test('o esquema enviado ao Gemini usa só recursos aceitos', () => {
  const texto = JSON.stringify(ESQUEMA_JSON);
  assert.ok(!('$schema' in ESQUEMA_JSON));
  assert.ok(!texto.includes('$ref') && !texto.includes('$defs'), 'sem referências internas');
  assert.equal(ESQUEMA_JSON.additionalProperties, false);
  assert.deepEqual(ESQUEMA_JSON.properties.identificacao.properties.orgao.type, ['string', 'null']);
});

test('envia o PDF com JSON estruturado e nível de raciocínio; devolve a análise validada (grátis)', async () => {
  proximaResposta = { texto: JSON.stringify(ANALISE_EXEMPLO) };
  const r = await analisarComGemini(
    { pdf: PDF_FALSO, nomeArquivo: 'edital.pdf', contexto: { objeto: 'Notebooks para escolas' } },
    { cliente: cliente() },
  );

  assert.equal(r.provedor, 'gemini');
  assert.equal(r.modelo, 'gemini-4-hydrogen');
  assert.equal(r.analise.identificacao.numero_edital, 'Pregão Eletrônico nº 45/2026');
  assert.equal(r.analise.aviso_legal, AVISO_LEGAL);
  assert.deepEqual(r.uso, { entrada: 26000, saida: 5000, cacheLeitura: 0, cacheEscrita: 0 });
  assert.equal(r.custoEstimadoUsd, 0, 'plano gratuito não tem custo');

  const { caminho, cabecalhos, corpo } = ultimoPedido;
  assert.match(caminho, /\/models\/gemini-4-hydrogen:generateContent/);
  assert.ok(cabecalhos['x-goog-api-key'] === 'chave-de-teste' || caminho.includes('key=chave-de-teste'), 'chave enviada');

  const [doc, pedido] = corpo.contents[0].parts;
  assert.deepEqual(doc.inlineData, { mimeType: 'application/pdf', data: PDF_FALSO.toString('base64') });
  assert.match(pedido.text, /Notebooks para escolas/);
  assert.match(JSON.stringify(corpo.systemInstruction), /Lei nº 14.133\/2021/);

  const g = corpo.generationConfig;
  assert.equal(g.responseMimeType, 'application/json');
  assert.equal(g.responseJsonSchema.additionalProperties, false);
  assert.equal(g.maxOutputTokens, 65536);
  assert.equal(g.thinkingConfig.thinkingLevel, 'HIGH');
});

test('texto no lugar do PDF, nível de raciocínio e custo no plano pago', async () => {
  proximaResposta = { texto: JSON.stringify(ANALISE_EXEMPLO) };
  const planoOriginal = config.gemini.plano;
  config.gemini.plano = 'pago';
  try {
    const r = await analisarComGemini({ texto: 'EDITAL DE PREGÃO ELETRÔNICO Nº 45/2026 ...', nomeArquivo: 'ed"ital.txt' },
      { cliente: cliente(), pensamento: 'medium' });
    assert.equal(r.custoEstimadoUsd, 0.0765); // 26k x $1,50/M + 5k x $7,50/M
  } finally {
    config.gemini.plano = planoOriginal;
  }
  const parte = ultimoPedido.corpo.contents[0].parts[0];
  assert.match(parte.text, /^<documento nome="edital.txt">\nEDITAL DE PREGÃO/);
  assert.equal(ultimoPedido.corpo.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');

  await analisarComGemini({ texto: 'EDITAL ...' }, { cliente: cliente(), pensamento: 'auto' });
  assert.equal(ultimoPedido.corpo.generationConfig.thinkingConfig, undefined, '"auto" usa o padrão do modelo');
});

test('motivos de parada, bloqueios e respostas inválidas viram erros claros', async () => {
  const casos = [
    [{ texto: '{"identificacao": {', motivo: 'MAX_TOKENS' }, 'resposta_cortada'],
    [{ texto: '', motivo: 'SAFETY' }, 'recusa'],
    [{ texto: '', motivo: 'RECITATION' }, 'recusa'],
    [{ bloqueio: 'PROHIBITED_CONTENT' }, 'recusa'],
    [{ texto: 'isto não é json' }, 'json_invalido'],
    [{ texto: JSON.stringify({ ...ANALISE_EXEMPLO, confianca: 'talvez' }) }, 'formato_invalido'],
  ];
  for (const [resposta, codigo] of casos) {
    proximaResposta = resposta;
    await assert.rejects(
      analisarComGemini({ pdf: PDF_FALSO }, { cliente: cliente(), tentativas: 1 }),
      (e) => e instanceof ErroAnalise && e.codigo === codigo,
      `esperado "${codigo}" para ${JSON.stringify(resposta).slice(0, 60)}`,
    );
  }
});

test('erros HTTP do Google viram mensagens amigáveis', async () => {
  const casos = [
    [{ httpStatus: 400, mensagem: 'API key not valid. Please pass a valid API key.', statusGoogle: 'INVALID_ARGUMENT' }, 'chave_invalida'],
    [{ httpStatus: 400, mensagem: 'User location is not supported for the API use.', statusGoogle: 'FAILED_PRECONDITION' }, 'regiao_indisponivel'],
    [{ httpStatus: 400, mensagem: 'Invalid response_json_schema: too many states.', statusGoogle: 'INVALID_ARGUMENT' }, 'esquema_recusado'],
    [{ httpStatus: 400, mensagem: 'The document has no pages.', statusGoogle: 'INVALID_ARGUMENT' }, 'documento_recusado'],
    [{ httpStatus: 404, mensagem: 'models/gemini-4-hydrogen is not found for API version v1beta', statusGoogle: 'NOT_FOUND' }, 'modelo_invalido'],
    [{ httpStatus: 429, mensagem: 'Resource has been exhausted (e.g. check quota).', statusGoogle: 'RESOURCE_EXHAUSTED' }, 'limite_taxa'],
    [{ httpStatus: 503, mensagem: 'The model is overloaded. Please try again later.', statusGoogle: 'UNAVAILABLE' }, 'ia_indisponivel'],
  ];
  for (const [resposta, codigo] of casos) {
    proximaResposta = resposta;
    await assert.rejects(
      analisarComGemini({ pdf: PDF_FALSO }, { cliente: cliente(), tentativas: 1 }),
      (e) => e instanceof ErroAnalise && e.codigo === codigo,
      `esperado "${codigo}" para HTTP ${resposta.httpStatus}: ${resposta.mensagem}`,
    );
  }
});

test('o seletor usa o provedor do .env (Gemini por padrão) e recusa nomes desconhecidos', async () => {
  assert.equal(config.ia.provedor, 'gemini');
  const info = provedorDaIa();
  assert.equal(info.nome, 'Gemini (Google)');
  assert.equal(info.modelo, 'gemini-4-hydrogen');
  assert.equal(info.variavelChave, 'GEMINI_API_KEY');
  assert.equal(provedorDaIa('claude').nome, 'Claude (Anthropic)');
  assert.throws(() => provedorDaIa('chatgpt'), (e) => e.codigo === 'provedor_invalido');

  proximaResposta = { texto: JSON.stringify(ANALISE_EXEMPLO) };
  const r = await analisarEdital({ pdf: PDF_FALSO }, { cliente: cliente() });
  assert.equal(r.provedor, 'gemini');
});
