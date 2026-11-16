// Testa a API HTTP (src/api/app.js) com um "banco" em memória no lugar do
// Supabase e uma IA falsa no lugar do Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarApp } from '../src/api/app.js';
import { ErroAnalise } from '../src/ia/erros.js';
import { ANALISE_EXEMPLO } from './fixtures/analise-exemplo.js';

const ORG = randomUUID();
const OUTRA_ORG = randomUUID();
const USUARIO = { id: randomUUID(), email: 'ana@exemplo.com' };
const TEXTO_EDITAL = 'EDITAL DE PREGÃO ELETRÔNICO Nº 45/2026. '.repeat(10);
const PDF = Buffer.from('%PDF-1.7\n% edital enviado pelo usuário\n');
const silencioso = { info() {}, aviso() {}, erro() {} };

function montar({ cota = { limite: 10, usadas: 0 }, analisar } = {}) {
  const analises = new Map();
  const chamadasIa = [];

  const repositorio = {
    usuarioDoToken: async (token) => (token === 'token-valido' ? USUARIO : null),
    comoUsuario: () => ({
      ehMembro: async (org) => org === ORG,
      licitacao: async (id) => ({
        1: { id: 1, fonte: 'pncp', numero_controle_pncp: '46395000000139-1-000010/2026', orgao_cnpj: '46395000000139',
             ano_compra: 2026, sequencial_compra: 10, objeto: 'Manutenção de ar-condicionado',
             orgao_razao_social: 'Município de São Paulo', modalidade_nome: 'Pregão - Eletrônico', sistema_origem: 'Compras.gov.br' },
        2: { id: 2, fonte: 'manual', objeto: 'Cotação privada' },
      })[id] ?? null,
      baixarDoStorage: async (caminho) => (caminho === `${ORG}/edital.pdf` ? PDF : null),
      analise: async (id) => analises.get(id) ?? null,
    }),
    cotaMensal: async () => cota,
    criarAnalise: async (campos) => {
      const id = randomUUID();
      analises.set(id, { id, ...campos });
      return id;
    },
    atualizarAnalise: async (id, campos) => Object.assign(analises.get(id), campos),
    analiseConcluidaPorHash: async (org, hash, ignorar) =>
      [...analises.values()].find((a) => a.organizacao_id === org && a.arquivo_sha256 === hash && a.status === 'concluida' && a.id !== ignorar) ?? null,
  };

  const app = criarApp({
    repositorio,
    analisar: analisar ?? (async (entrada) => {
      chamadasIa.push(entrada);
      return {
        analise: { ...ANALISE_EXEMPLO, aviso_legal: 'aviso' },
        modelo: 'claude-sonnet-5-5',
        uso: { entrada: 12000, saida: 2000 },
        custoEstimadoUsd: 0.044,
      };
    }),
    obterEdital: async () => ({ pdf: Buffer.from('%PDF-1.7 baixado do PNCP'), nomeArquivo: 'edital-pncp.pdf' }),
    opcoes: { origens: ['http://localhost:5500'] },
    log: silencioso,
  });
  return { app, analises, chamadasIa };
}

const pedir = (app, caminho, { corpo, token = 'token-valido', metodo = corpo ? 'POST' : 'GET', cabecalhos = {} } = {}) =>
  app.request(caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...cabecalhos },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

test('saúde responde sem login; rotas /api exigem login válido', async () => {
  const { app } = montar();
  assert.equal((await pedir(app, '/saude', { token: null })).status, 200);
  assert.equal((await pedir(app, '/api/editais/analisar', { corpo: {}, token: null })).status, 401);
  assert.equal((await pedir(app, '/api/editais/analisar', { corpo: {}, token: 'expirado' })).status, 401);
});

test('valida o pedido antes de gastar com a IA', async () => {
  const { app, chamadasIa } = montar();
  const casos = [
    [{ organizacao_id: ORG }, 400],                                                         // sem origem
    [{ organizacao_id: ORG, texto: TEXTO_EDITAL, licitacao_id: 1 }, 400],                    // duas origens
    [{ organizacao_id: 'abc', texto: TEXTO_EDITAL }, 400],                                   // id inválido
    [{ organizacao_id: OUTRA_ORG, texto: TEXTO_EDITAL }, 403],                               // não é membro
    [{ organizacao_id: ORG, texto: 'curto' }, 400],                                          // texto curto
    [{ organizacao_id: ORG, arquivo_path: `${OUTRA_ORG}/edital.pdf` }, 400],                 // pasta de outra org
    [{ organizacao_id: ORG, arquivo_path: `${ORG}/../x/edital.pdf` }, 400],                  // tentativa de sair da pasta
    [{ organizacao_id: ORG, licitacao_id: 999 }, 404],                                       // licitação invisível
    [{ organizacao_id: ORG, licitacao_id: 2 }, 400],                                         // manual: precisa PDF
  ];
  for (const [corpo, status] of casos) {
    const r = await pedir(app, '/api/editais/analisar', { corpo });
    assert.equal(r.status, status, `${JSON.stringify(corpo)} -> esperado ${status}, veio ${r.status}`);
    assert.ok((await r.json()).erro, 'resposta de erro tem mensagem');
  }
  assert.equal(chamadasIa.length, 0);
});

test('respeita a cota mensal do plano', async () => {
  const { app } = montar({ cota: { limite: 10, usadas: 10 } });
  const r = await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, texto: TEXTO_EDITAL } });
  assert.equal(r.status, 429);
  assert.equal((await r.json()).codigo, 'cota_esgotada');
});

test('texto: 202, processa em segundo plano, grava resultado e reaproveita o mesmo arquivo', async () => {
  const { app, chamadasIa } = montar();
  const r = await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, texto: TEXTO_EDITAL } });
  assert.equal(r.status, 202);
  const { id } = await r.json();
  await app.aguardarTarefas();

  const consulta = await pedir(app, `/api/editais/analises/${id}`);
  assert.equal(consulta.status, 200);
  const analise = await consulta.json();
  assert.equal(analise.status, 'concluida');
  assert.equal(analise.origem, 'texto');
  assert.equal(analise.solicitado_por, USUARIO.id);
  assert.equal(analise.modelo, 'claude-sonnet-5-5');
  assert.equal(analise.tokens_entrada, 12000);
  assert.equal(analise.resultado.identificacao.numero_edital, 'Pregão Eletrônico nº 45/2026');
  assert.match(analise.arquivo_sha256, /^[0-9a-f]{64}$/);

  // mesmo texto de novo: não chama a IA, reaproveita
  const r2 = await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, texto: TEXTO_EDITAL } });
  const { id: id2 } = await r2.json();
  await app.aguardarTarefas();
  const segunda = await (await pedir(app, `/api/editais/analises/${id2}`)).json();
  assert.equal(segunda.status, 'concluida');
  assert.equal(segunda.modelo, 'reaproveitado');
  assert.equal(segunda.custo_estimado_usd, 0);
  assert.equal(chamadasIa.length, 1);

  // forcar: true analisa de novo
  await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, texto: TEXTO_EDITAL, forcar: true } });
  await app.aguardarTarefas();
  assert.equal(chamadasIa.length, 2);
});

test('PDF do Storage e edital do PNCP chegam à IA como PDF', async () => {
  const { app, chamadasIa } = montar();
  await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, arquivo_path: `${ORG}/edital.pdf` } });
  await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, licitacao_id: 1 } });
  await app.aguardarTarefas();

  assert.equal(chamadasIa.length, 2);
  const upload = chamadasIa.find((c) => !c.contexto);
  const pncp = chamadasIa.find((c) => c.contexto);
  assert.deepEqual(upload.pdf, PDF);
  assert.equal(upload.nomeArquivo, 'edital.pdf');
  assert.equal(pncp.nomeArquivo, 'edital-pncp.pdf');
  assert.equal(pncp.contexto.numeroControle, '46395000000139-1-000010/2026');
});

test('falhas da IA ficam registradas com mensagem amigável', async () => {
  const { app } = montar({
    analisar: async () => { throw new ErroAnalise('A IA não aceitou analisar este documento.', { codigo: 'recusa', status: 422 }); },
  });
  const r = await pedir(app, '/api/editais/analisar', { corpo: { organizacao_id: ORG, texto: TEXTO_EDITAL } });
  const { id } = await r.json();
  await app.aguardarTarefas();
  const analise = await (await pedir(app, `/api/editais/analises/${id}`)).json();
  assert.equal(analise.status, 'erro');
  assert.equal(analise.erro, 'A IA não aceitou analisar este documento.');

  const { app: app2 } = montar({ analisar: async () => { throw new TypeError('bug interno com detalhes técnicos'); } });
  const r2 = await pedir(app2, '/api/editais/analisar', { corpo: { organizacao_id: ORG, texto: TEXTO_EDITAL } });
  const { id: id2 } = await r2.json();
  await app2.aguardarTarefas();
  const a2 = await (await pedir(app2, `/api/editais/analises/${id2}`)).json();
  assert.equal(a2.erro, 'Erro inesperado ao analisar o edital. Tente novamente.', 'detalhes técnicos não vazam');
});

test('CORS libera só as origens configuradas', async () => {
  const { app } = montar();
  const ok = await app.request('/api/editais/analisar', {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:5500', 'access-control-request-method': 'POST' },
  });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5500');
  const bloqueado = await app.request('/api/editais/analisar', {
    method: 'OPTIONS',
    headers: { origin: 'https://site-estranho.com', 'access-control-request-method': 'POST' },
  });
  assert.notEqual(bloqueado.headers.get('access-control-allow-origin'), 'https://site-estranho.com');
});
