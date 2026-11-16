// Testa o provedor Claude (src/ia/provedores/claude.js) contra um servidor local
// que imita a API da Anthropic (streaming SSE). Não gasta créditos nem precisa de chave real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { AVISO_LEGAL, ErroAnalise } from '../src/ia/analisar-edital.js';
import { analisarComClaude as analisarEdital } from '../src/ia/provedores/claude.js';
import { AnaliseEditalSchema } from '../src/ia/esquema-analise.js';
import { verificarPdf } from '../src/ia/documento.js';
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
      res.end(JSON.stringify({ type: 'error', error: { type: r.tipoErro, message: 'erro simulado' } }));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const enviar = (evento, dados) => res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    enviar('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_teste', type: 'message', role: 'assistant', model: r.modelo ?? 'claude-sonnet-5-5',
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 15000, output_tokens: 1 },
      },
    });
    enviar('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    for (const pedaco of r.texto.match(/[\s\S]{1,300}/g) ?? []) {
      enviar('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: pedaco } });
    }
    enviar('content_block_stop', { type: 'content_block_stop', index: 0 });
    enviar('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: r.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2500 },
    });
    enviar('message_stop', { type: 'message_stop' });
    res.end();
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  urlBase = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor.close());

const cliente = () => new Anthropic({ apiKey: 'chave-de-teste', baseURL: urlBase, maxRetries: 0 });
const PDF_FALSO = Buffer.from('%PDF-1.7\n% edital de teste\n');

test('o exemplo de análise segue o esquema', () => {
  assert.equal(AnaliseEditalSchema.safeParse(ANALISE_EXEMPLO).success, true);
});

test('envia o PDF com saída estruturada, fallback e streaming; devolve a análise validada', async () => {
  proximaResposta = { texto: JSON.stringify(ANALISE_EXEMPLO) };
  const r = await analisarEdital(
    { pdf: PDF_FALSO, nomeArquivo: 'edital-45-2026.pdf', contexto: { objeto: 'Notebooks para escolas', orgao: 'Prefeitura' } },
    { cliente: cliente() },
  );

  // resposta
  assert.equal(r.analise.identificacao.numero_edital, 'Pregão Eletrônico nº 45/2026');
  assert.equal(r.analise.aviso_legal, AVISO_LEGAL);
  assert.equal(r.modelo, 'claude-sonnet-5-5');
  assert.deepEqual(r.uso, { entrada: 15000, saida: 2500, cacheLeitura: 0, cacheEscrita: 0 });
  assert.equal(r.custoEstimadoUsd, 0.055); // 15k x $2/M + 2,5k x $10/M
  assert.equal(r.fallbackUsado, false);

  // pedido enviado à API
  const { caminho, cabecalhos, corpo } = ultimoPedido;
  assert.match(caminho, /^\/v1\/messages(\?|$)/);
  assert.match(cabecalhos['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(cabecalhos.authorization, 'Bearer chave-de-teste');
  assert.ok(cabecalhos['anthropic-version'], 'versão da API enviada pelo SDK');
  assert.equal(corpo.model, 'claude-sonnet-5-5');
  assert.equal(corpo.stream, true);
  assert.equal(corpo.fallbacks, 'default');
  assert.equal(corpo.max_tokens, 64000);
  assert.equal(corpo.output_config.effort, 'high');
  assert.equal(corpo.output_config.format.type, 'json_schema');
  assert.equal(corpo.output_config.format.schema.additionalProperties, false);
  assert.ok(!('parse' in corpo.output_config.format), 'a função parse não vai para a API');
  assert.ok(!('temperature' in corpo), 'sem parâmetros de amostragem');
  assert.match(corpo.system, /Lei nº 14.133\/2021/);

  const [doc, pedido] = corpo.messages[0].content;
  assert.equal(doc.type, 'document');
  assert.equal(doc.title, 'edital-45-2026.pdf');
  assert.deepEqual(doc.source, { type: 'base64', media_type: 'application/pdf', data: PDF_FALSO.toString('base64') });
  assert.equal(pedido.type, 'text');
  assert.match(pedido.text, /Notebooks para escolas/);
});

test('aceita texto no lugar do PDF', async () => {
  proximaResposta = { texto: JSON.stringify(ANALISE_EXEMPLO) };
  await analisarEdital({ texto: 'EDITAL DE PREGÃO ELETRÔNICO Nº 45/2026 ...' }, { cliente: cliente(), esforco: 'medium' });
  const doc = ultimoPedido.corpo.messages[0].content[0];
  assert.deepEqual(doc.source, { type: 'text', media_type: 'text/plain', data: 'EDITAL DE PREGÃO ELETRÔNICO Nº 45/2026 ...' });
  assert.equal(ultimoPedido.corpo.output_config.effort, 'medium');
});

test('recusa, resposta cortada e formatos inválidos viram erros claros', async () => {
  const casos = [
    [{ texto: '{}', stopReason: 'refusal' }, 'recusa'],
    [{ texto: '{"identificacao": {', stopReason: 'max_tokens' }, 'resposta_cortada'],
    [{ texto: 'isto não é json' }, 'json_invalido'],
    [{ texto: JSON.stringify({ ...ANALISE_EXEMPLO, confianca: 'talvez' }) }, 'formato_invalido'],
    [{ httpStatus: 401, tipoErro: 'authentication_error' }, 'chave_invalida'],
    [{ httpStatus: 400, tipoErro: 'invalid_request_error' }, 'documento_recusado'],
  ];
  for (const [resposta, codigo] of casos) {
    proximaResposta = resposta;
    await assert.rejects(
      analisarEdital({ pdf: PDF_FALSO }, { cliente: cliente() }),
      (e) => e instanceof ErroAnalise && e.codigo === codigo,
      `esperado código "${codigo}"`,
    );
  }
});

test('entrada vazia e arquivos que não são PDF são recusados antes de chamar a API', async () => {
  await assert.rejects(analisarEdital({}, { cliente: cliente() }), (e) => e.codigo === 'entrada_vazia');
  assert.throws(() => verificarPdf(Buffer.from('PK\u0003\u0004zip')), (e) => e.codigo === 'arquivo_zip');
  assert.throws(() => verificarPdf(Buffer.from('<html>')), (e) => e.codigo === 'nao_e_pdf');
  assert.throws(() => verificarPdf(Buffer.alloc(0)), (e) => e.codigo === 'arquivo_vazio');
  assert.throws(() => verificarPdf(Buffer.from('%PDF-1.7 xxxxxxxx'), 5), (e) => e.codigo === 'arquivo_grande');
  assert.equal(verificarPdf(PDF_FALSO).length, PDF_FALSO.length);
});
