import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarCron } from '../src/services/collectors/cron.js';
import { prepararLote, registroPadrao } from '../src/services/collectors/esquema.js';
import { criarRequisitador, esperaExponencial } from '../src/services/collectors/http.js';
import { executarColeta } from '../src/services/collectors/index.js';

const silencioso = { log() {}, warn() {}, error() {} };
const { criarLogEstruturado } = await import('../src/services/collectors/log.js');
const log = criarLogEstruturado('teste', { saida: silencioso });

const bruto = (n, extra = {}) => ({
  numeroControlePNCP: `00394460000141-1-${String(n).padStart(6, '0')}/2026`,
  orgaoEntidade: { cnpj: '00394460000141', razaoSocial: 'ÓRGÃO TESTE' },
  unidadeOrgao: { ufSigla: 'sp', municipioNome: 'Campinas', codigoIbge: '3509502' },
  anoCompra: 2026, sequencialCompra: n, modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico',
  objetoCompra: `Compra ${n}`, valorTotalEstimado: 1000 + n,
  dataPublicacaoPncp: '2026-11-18T10:00:00', dataAberturaProposta: '2026-11-20T08:00:00',
  linkSistemaOrigem: 'https://portal.exemplo/edital', ...extra,
});

// Supabase simulado: licitacoes (upsert), sync_execucoes (insert/update/delete com filtros,
// índice único "uma executando por fonte e tipo") e rpc de limpeza.
function supabaseFalso({ falharUpsert = 0, execucoes = [] } = {}) {
  const tabelas = { licitacoes: new Map(), sync_execucoes: execucoes.map((e, i) => ({ id: i + 1, ultimo_sinal: new Date().toISOString(), ...e })) };
  const chamadas = { upserts: [], rpc: [] };
  const tipo = (e) => `${e.fonte}|${String(e.modo).startsWith('coletor:')}`;
  function consulta(acao, valor) {
    const filtros = [];
    const q = {
      eq(c, v) { filtros.push((r) => r[c] === v); return q; },
      neq(c, v) { filtros.push((r) => r[c] !== v); return q; },
      lt(c, v) { filtros.push((r) => r[c] < v); return q; },
      select() { return q; },
      then(ok, falha) {
        const alvo = tabelas.sync_execucoes.filter((r) => filtros.every((f) => f(r)));
        if (acao === 'update') alvo.forEach((r) => Object.assign(r, valor));
        if (acao === 'delete') tabelas.sync_execucoes = tabelas.sync_execucoes.filter((r) => !alvo.includes(r));
        return Promise.resolve({ data: alvo.map((r) => ({ id: r.id })), error: null }).then(ok, falha);
      },
    };
    return q;
  }
  return {
    tabelas, chamadas,
    rpc(nome, args) { chamadas.rpc.push({ nome, args }); return Promise.resolve({ data: 7, error: null }); },
    from(nome) {
      if (nome === 'licitacoes') {
        return {
          upsert(linhas, opcoes) {
            chamadas.upserts.push({ tamanho: linhas.length, opcoes });
            if (falharUpsert > 0) { falharUpsert--; return Promise.resolve({ error: { message: 'falha transitória' } }); }
            for (const l of linhas) tabelas.licitacoes.set(`${l.fonte}|${l.external_id}`, l);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {
        insert(linha) {
          const conflito = tabelas.sync_execucoes.some((r) => r.status === 'executando' && tipo(r) === tipo(linha));
          const nova = { id: tabelas.sync_execucoes.length + 1, status: 'executando', iniciado_em: new Date().toISOString(), ultimo_sinal: new Date().toISOString(), ...linha };
          if (!conflito) tabelas.sync_execucoes.push(nova);
          return { select: () => ({ single: async () => (conflito
            ? { data: null, error: { code: '23505', message: 'duplicate key' } }
            : { data: { id: nova.id }, error: null }) }) };
        },
        update: (v) => consulta('update', v),
        delete: () => consulta('delete'),
      };
    },
  };
}

test('cron: campos, intervalos, passos e fuso de Brasília', () => {
  const cadaHora10 = interpretarCron('10 * * * *');
  assert.equal(cadaHora10(new Date('2026-11-19T13:10:00Z')), true);
  assert.equal(cadaHora10(new Date('2026-11-19T13:11:00Z')), false);
  // 06:00 em Brasília = 09:00 UTC
  const seisDaManhaUteis = interpretarCron('0 6 * * 1-5');
  assert.equal(seisDaManhaUteis(new Date('2026-11-19T09:00:00Z')), true); // quinta
  assert.equal(seisDaManhaUteis(new Date('2026-11-22T09:00:00Z')), false); // domingo
  assert.equal(interpretarCron('*/15 8-18/2 * * *')(new Date('2026-11-19T13:45:00Z')), true); // 10:45 BRT
  assert.throws(() => interpretarCron('61 * * * *'), /minuto/);
  assert.throws(() => interpretarCron('* * *'), /5 campos/);
});

test('esquema: limpa campos, valida e remove repetidos do lote', () => {
  const r = registroPadrao({ source: 'pncp', external_id: ' X1 ', orgao: ' Prefeitura ', orgao_cnpj: '00.394.460/0001-41', uf: 'sp',
    municipio: 'Campinas', objeto: 'Compra', modalidade: 'Pregão', valor_estimado: '10.5', data_publicacao: '2026-11-18',
    data_abertura: null, url_edital: 'javascript:alert(1)' });
  assert.equal(r.external_id, 'X1');
  assert.equal(r.orgao_cnpj, '00394460000141');
  assert.equal(r.uf, 'SP');
  assert.equal(r.valor_estimado, 10.5);
  assert.equal(r.data_publicacao, '2026-11-18T03:00:00.000Z');
  assert.equal(r.url_edital, null, 'link perigoso descartado');

  const { linhas, invalidos } = prepararLote([r, { ...r }, { ...r, external_id: null }], {});
  assert.equal(linhas.length, 1);
  assert.equal(invalidos.length, 1);
  assert.equal(linhas[0].fonte, 'pncp');
  assert.equal(linhas[0].dados_brutos, null, 'sem payload bruto por padrão');

  const comBruto = prepararLote([{ ...r, raw_data: { a: 1 } }, { ...r, external_id: 'G', raw_data: { g: 'x'.repeat(20_000) } }], { guardarBruto: true }).linhas;
  assert.deepEqual(comBruto[0].dados_brutos, { a: 1 });
  assert.equal(comBruto[1].dados_brutos, null, 'bruto grande é descartado mesmo com guardarBruto');
});

test('http: tenta de novo com espera exponencial e desiste em 4xx', async () => {
  assert.equal(esperaExponencial(1, { baseMs: 100, aleatorio: () => 0 }), 100);
  assert.equal(esperaExponencial(4, { baseMs: 100, aleatorio: () => 0 }), 800);
  assert.equal(esperaExponencial(20, { baseMs: 100, tetoMs: 1000, aleatorio: () => 0 }), 1000);

  let n = 0;
  const f = async () => (++n < 3 ? new Response('x', { status: 503 }) : Response.json({ ok: true }));
  const req = criarRequisitador({ intervaloMs: 0, baseEsperaMs: 1, fetch: f });
  assert.deepEqual(await req('https://x.test/a'), { ok: true });
  assert.equal(n, 3);

  let m = 0;
  const g = async () => { m++; return new Response('x', { status: 404 }); };
  await assert.rejects(criarRequisitador({ intervaloMs: 0, baseEsperaMs: 1, fetch: g })('https://x.test/b'), /HTTP 404/);
  assert.equal(m, 1, '404 não é repetido');
});

test('coleta PNCP: pagina tudo, grava em lotes com fonte+external_id e registra a execução', async () => {
  const urls = [];
  const paginas = { 1: [1, 2, 3], 2: [3, 4] }; // o 3 repete entre páginas (retificação)
  const obterJson = async (url) => {
    urls.push(url);
    const p = Number(new URL(url).searchParams.get('pagina'));
    return { data: paginas[p].map((n) => bruto(n, p === 2 && n === 3 ? { objetoCompra: 'Compra 3 RETIFICADA' } : {})), totalPaginas: 2, totalRegistros: 5 };
  };
  const supabase = supabaseFalso({ falharUpsert: 1 });
  const r = await executarColeta(
    { fontes: ['pncp'], ufs: ['SP'], modalidades: [6], modo: 'publicacao', desde: '2026-11-18', ate: '2026-11-19', lote: 2 },
    { supabase, log, deps: { pncp: { obterJson } } },
  );
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/v1\/contratacoes\/publicacao\?/);
  assert.match(urls[0], /dataInicial=20261118&dataFinal=20261119&codigoModalidadeContratacao=6&uf=SP&pagina=1/);
  assert.equal(r.recebidos, 5);
  assert.equal(r.gravados, 5);
  assert.equal(r.falhas, 0, 'a falha transitória do upsert foi repetida');
  assert.ok(supabase.chamadas.upserts.every((u) => u.tamanho <= 2 && u.opcoes.onConflict === 'fonte,external_id'));
  assert.equal(supabase.tabelas.licitacoes.size, 4, 'sem duplicata');
  const l3 = supabase.tabelas.licitacoes.get('pncp|00394460000141-1-000003/2026');
  assert.equal(l3.objeto, 'Compra 3 RETIFICADA');
  assert.equal(l3.numero_controle_pncp, '00394460000141-1-000003/2026');
  assert.equal(supabase.tabelas.sync_execucoes[0].status, 'concluida');
  assert.equal(l3.url_edital, null, 'no PNCP o link do edital é o link_pncp (sem duplicar)');
  assert.equal(l3.link_sistema_origem, 'https://portal.exemplo/edital');
  assert.equal(supabase.chamadas.rpc.length, 0, 'sem limpar: true não apaga nada');
  assert.equal(supabase.tabelas.sync_execucoes[0].modo, 'coletor:publicacao');
});

test('coleta PNCP: nacional que falha divide por estado; 429 persistente interrompe', async () => {
  const urls = [];
  const obterJson = async (url) => {
    urls.push(url);
    const uf = new URL(url).searchParams.get('uf');
    if (!uf) throw Object.assign(new Error('HTTP 500'), { status: 500 });
    if (uf === 'AL') throw Object.assign(new Error('HTTP 429'), { status: 429 });
    return { data: [bruto(uf.charCodeAt(0) * 100 + uf.charCodeAt(1))], totalPaginas: 1 };
  };
  const r = await executarColeta(
    { fontes: ['pncp'], modalidades: [6], desde: '2026-11-18', ate: '2026-11-19', simular: true },
    { log, deps: { pncp: { obterJson } } },
  );
  assert.equal(urls.length, 3, 'nacional, AC e AL (parou no 429)');
  assert.equal(r.gravados, 1);
  assert.equal(r.fontes[0].status, 'parcial');
  assert.match(r.fontes[0].interrompido, /429/);
});

test('coleta: valida opções e não deixa duas execuções ao mesmo tempo', async () => {
  await assert.rejects(executarColeta({ fontes: ['apify'], simular: true }, { log }), /Fonte desconhecida/);
  await assert.rejects(executarColeta({ ufs: ['XX'], simular: true }, { log }), /UF desconhecida/);
  await assert.rejects(executarColeta({ desde: '2026-11-20', ate: '2026-11-19', simular: true }, { log }), /depois/);
  await assert.rejects(executarColeta({}, { log }), /cliente do Supabase/);

  let liberar;
  const trava = new Promise((r) => { liberar = r; });
  const obterJson = async () => { await trava; return { data: [], totalPaginas: 0 }; };
  const primeira = executarColeta({ ufs: ['SP'], modalidades: [6], simular: true }, { log, deps: { pncp: { obterJson } } });
  await assert.rejects(executarColeta({ simular: true }, { log }), (e) => e.codigo === 'em_andamento');
  liberar();
  await primeira;
});

test('trava entre servidores: execução viva bloqueia; abandonada é fechada e liberada', async () => {
  const antigo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const obterJson = async () => ({ data: [bruto(1)], totalPaginas: 1 });
  const opcoes = { ufs: ['SP'], modalidades: [6], desde: '2026-11-18', ate: '2026-11-19' };

  // outra coleta viva (sinal recente): esta fonte é pulada, nada é gravado
  const viva = supabaseFalso({ execucoes: [{ fonte: 'pncp', modo: 'coletor:atualizacao', status: 'executando' }] });
  const r1 = await executarColeta(opcoes, { supabase: viva, log, deps: { pncp: { obterJson } } });
  assert.equal(r1.fontes[0].status, 'ignorada');
  assert.equal(viva.tabelas.licitacoes.size, 0);

  // sincronizador ANTIGO rodando não trava o coletor novo (tipos diferentes)... mas a
  // execução morta do coletor (sem sinal há 2 h) é fechada como abandonada e a coleta segue
  const morta = supabaseFalso({ execucoes: [
    { fonte: 'pncp', modo: 'coletor:atualizacao', status: 'executando', ultimo_sinal: antigo },
    { fonte: 'pncp', modo: 'atualizacao', status: 'executando' },
  ] });
  const r2 = await executarColeta(opcoes, { supabase: morta, log, deps: { pncp: { obterJson } } });
  assert.equal(r2.fontes[0].status, 'concluida');
  assert.equal(morta.tabelas.sync_execucoes[0].status, 'erro');
  assert.match(morta.tabelas.sync_execucoes[0].detalhes.erro, /abandonada/);
  assert.equal(morta.tabelas.sync_execucoes[1].status, 'executando', 'a viva do outro tipo fica intacta');
  assert.equal(morta.tabelas.sync_execucoes[2].status, 'concluida');
});

test('limpeza no fim (agendamento) e ALERTA_COLETA em falha parcial', async () => {
  const velho = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const supabase = supabaseFalso({ execucoes: [{ fonte: 'pncp', modo: 'atualizacao', status: 'concluida', iniciado_em: velho }] });
  const linhas = [];
  const logCaptura = criarLogEstruturado('teste', { saida: { log() {}, warn() {}, error: (l) => linhas.push(JSON.parse(l)) } });
  const obterJson = async (url) => {
    const p = Number(new URL(url).searchParams.get('pagina'));
    if (p === 2) throw Object.assign(new Error('HTTP 500'), { status: 500 });
    return { data: [bruto(p)], totalPaginas: 3 };
  };
  const r = await executarColeta({ ufs: ['SP'], modalidades: [6], desde: '2026-11-18', ate: '2026-11-19', limpar: true, limparDias: 90 },
    { supabase, log: logCaptura, deps: { pncp: { obterJson } } });
  assert.equal(r.fontes[0].status, 'parcial');
  assert.deepEqual(supabase.chamadas.rpc, [{ nome: 'limpar_licitacoes_antigas', args: { p_dias: 90 } }]);
  assert.deepEqual(r.limpeza, { licitacoes: 7, execucoes: 1 });
  assert.equal(supabase.tabelas.sync_execucoes.length, 1, 'histórico velho apagado; a execução atual fica');
  const alerta = linhas.find((l) => l.evento === 'ALERTA_COLETA');
  assert.ok(alerta, 'alerta emitido');
  assert.equal(alerta.nivel, 'erro');
  assert.equal(alerta.status, 'parcial');
  assert.match(alerta.primeiraFalha, /HTTP 500/);
});
