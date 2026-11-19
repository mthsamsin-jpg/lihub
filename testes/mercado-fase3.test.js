// Fase 3 da inteligência de mercado: coleta retroativa direcionada, trava de espaço,
// janela noturna e as consultas novas (Pesquisa de Preço real e painel do concorrente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { coletarResultados } from '../src/mercado/coletar.js';
import { dentroDaJanela, descobrirRetro, linhaDaFila, termosRetro } from '../src/mercado/retro.js';

const AGORA = Date.parse('2026-11-19T15:00:00Z');

// Supabase simulado com o mínimo usado por retro.js e coletar.js.
function supabaseFalso({ radares = [], mb = 200, coleta = [], licitacoes = [] } = {}) {
  const t = { radares, mercado_coleta: [...coleta], mercado_retro_termos: [], mercado_resultados: [], licitacoes };
  const chamadas = [];
  function consulta(tabela) {
    const f = [];
    let lim = Infinity;
    let acao = 'select';
    let valor = null;
    let opcoes = {};
    const q = {
      select() { return q; }, order() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      in(c, v) { f.push((r) => v.includes(r[c])); return q; },
      lt(c, v) { f.push((r) => r[c] < v); return q; },
      lte(c, v) { f.push((r) => r[c] <= v); return q; },
      gte(c, v) { f.push((r) => r[c] >= v); return q; },
      limit(n) { lim = n; return q; },
      upsert(v, o = {}) { acao = 'upsert'; valor = Array.isArray(v) ? v : [v]; opcoes = o; return q; },
      then(ok, falha) {
        let data;
        if (acao === 'upsert') {
          chamadas.push({ tabela, linhas: valor.length, opcoes });
          const chave = tabela === 'mercado_retro_termos' ? 'termo' : tabela === 'mercado_resultados' ? null : 'numero_controle_pncp';
          data = [];
          for (const l of valor) {
            const i = chave ? t[tabela].findIndex((r) => r[chave] === l[chave]) : -1;
            if (i >= 0 && opcoes.ignoreDuplicates) continue;
            if (i >= 0) Object.assign(t[tabela][i], l); else t[tabela].push({ ...l });
            data.push(l);
          }
        } else {
          data = t[tabela].filter((r) => f.every((x) => x(r))).slice(0, lim);
        }
        return Promise.resolve({ data, error: null }).then(ok, falha);
      },
    };
    return q;
  }
  return { t, chamadas, from: consulta, rpc: async (nome) => (nome === 'banco_tamanho_mb' ? { data: mb, error: null } : { data: null, error: { message: 'x' } }) };
}

const achado = (n, publicadoEm = '2026-06-10T10:00') => ({
  numeroControle: `00394460000141-1-${String(n).padStart(6, '0')}/2026`, cnpj: '00394460000141', ano: 2026, sequencial: n,
  orgao: 'ÓRGÃO X', uf: 'SC', municipio: 'Joinville', modalidade: 'Pregão - Eletrônico', portal: 'bll', portalNome: 'BLL Compras',
  objeto: 'Papel A4', publicadoEm, fimPropostas: '2026-06-25T09:00',
});

test('termosRetro: palavras dos radares ativos + extras, sem repetir, os mais usados primeiro', async () => {
  const sb = supabaseFalso({ radares: [
    { ativo: true, palavras: ['Papel A4', 'toner'] }, { ativo: true, palavras: ['papel a4', 'ab'] }, { ativo: false, palavras: ['notebook'] },
  ] });
  assert.deepEqual(await termosRetro(sb, { extras: ['copo descartável'] }), ['papel a4', 'copo descartável', 'toner']);
});

test('linhaDaFila: dados mínimos da compra para coletar sem o catálogo', () => {
  const l = linhaDaFila(achado(5), '2026-11-19T15:00:00.000Z');
  assert.equal(l.origem, 'retro');
  assert.equal(l.situacao, 'pendente');
  assert.equal(l.sequencial_compra, 5);
  assert.equal(l.portal, 'BLL Compras');
  assert.equal(l.encerrada_em, '2026-06-25T12:00:00.000Z');
});

test('descobrirRetro: enfileira só o que está na janela, guarda o cursor e para no fim', async () => {
  const sb = supabaseFalso({ coleta: [{ numero_controle_pncp: achado(2).numeroControle, origem: 'catalogo', situacao: 'ok' }] });
  const pedidos = [];
  const buscar = async ({ q, pagina, status, tamanho }) => {
    pedidos.push({ q, pagina, status });
    if (pagina === 1) return { resultados: Array.from({ length: tamanho }, (_, i) => achado(i + 1)) };
    return { resultados: [achado(100), achado(101, '2025-01-01T10:00')] }; // página incompleta = fim
  };
  const r = await descobrirRetro({ termos: ['papel a4'], tamanhoPagina: 3 }, { supabase: sb, buscar, agora: AGORA });
  assert.deepEqual(pedidos.map((p) => [p.pagina, p.status]), [[1, 'encerradas'], [2, 'encerradas']]);
  assert.equal(r.encontradas, 4, 'a de 2025 está fora dos 12 meses');
  assert.equal(r.enfileiradas, 3, 'a que já estava na fila (catálogo) não é mexida');
  assert.equal(sb.t.mercado_coleta.find((c) => c.sequencial_compra === undefined && c.origem === 'catalogo')?.situacao, 'ok');
  const cur = sb.t.mercado_retro_termos[0];
  assert.equal(cur.pagina, 2);
  assert.ok(cur.concluido_em, 'termo concluído');

  // rodada seguinte: termo concluído há menos de 30 dias não é buscado de novo
  pedidos.length = 0;
  await descobrirRetro({ termos: ['papel a4'] }, { supabase: sb, buscar, agora: AGORA + 86_400_000 });
  assert.equal(pedidos.length, 0);
});

test('descobrirRetro: respeita o limite de páginas por rodada e continua de onde parou', async () => {
  const sb = supabaseFalso();
  const paginas = [];
  const buscar = async ({ pagina }) => { paginas.push(pagina); return { resultados: Array.from({ length: 2 }, (_, i) => achado(pagina * 10 + i)) }; };
  await descobrirRetro({ termos: ['toner'], tamanhoPagina: 2, paginasPorRodada: 3 }, { supabase: sb, buscar, agora: AGORA });
  await descobrirRetro({ termos: ['toner'], tamanhoPagina: 2, paginasPorRodada: 2 }, { supabase: sb, buscar, agora: AGORA });
  assert.deepEqual(paginas, [1, 2, 3, 4, 5]);
  assert.equal(sb.t.mercado_retro_termos[0].concluido_em, null);
});

test('descobrirRetro: trava de espaço não deixa a base crescer', async () => {
  const sb = supabaseFalso({ mb: 450 });
  let chamou = false;
  const r = await descobrirRetro({ termos: ['papel'], limiteMb: 400 }, { supabase: sb, buscar: async () => { chamou = true; return { resultados: [] }; }, agora: AGORA });
  assert.match(r.parado, /450 MB/);
  assert.equal(chamou, false);
});

test('coletarResultados retro: completa o lote com a fila retroativa e desiste em 3 tentativas', async () => {
  const fila = linhaDaFila(achado(9), new Date(AGORA - 1000).toISOString());
  const sb = supabaseFalso({ coleta: [fila] });
  const vistos = [];
  const coletar = async (lic) => { vistos.push(lic); return { itens: 2, comResultado: 0, linhas: [] }; };
  const r = await coletarResultados({ lote: 5, retro: true }, { supabase: sb, coletar, agora: AGORA, log: {} });
  assert.equal(r.retro, 1);
  assert.equal(vistos[0].orgao_cnpj, '00394460000141');
  assert.equal(vistos[0].sistema_origem, 'BLL Compras');
  const c = sb.t.mercado_coleta[0];
  assert.equal(c.origem, 'retro');
  assert.equal(c.situacao, 'sem_resultado');
  assert.equal(c.tentativas, 1);

  // sem retro: a fila retroativa não é tocada
  const r2 = await coletarResultados({ lote: 5 }, { supabase: supabaseFalso({ coleta: [fila] }), coletar, agora: AGORA, log: {} });
  assert.equal(r2.retro, 0);

  // 3ª tentativa sem resultado: desiste
  sb.t.mercado_coleta[0].tentativas = 2;
  sb.t.mercado_coleta[0].proxima_em = new Date(AGORA - 1000).toISOString();
  await coletarResultados({ lote: 5, retro: true }, { supabase: sb, coletar, agora: AGORA, log: {} });
  assert.equal(sb.t.mercado_coleta[0].situacao, 'desistiu');
});

test('dentroDaJanela: horário de Brasília, inclusive faixa que vira a meia-noite', () => {
  const as = (h) => new Date(Date.UTC(2026, 10, 19, h + 3, 30)); // h:30 em Brasília
  assert.equal(dentroDaJanela('0-6', as(3)), true);
  assert.equal(dentroDaJanela('0-6', as(7)), false);
  assert.equal(dentroDaJanela('22-5', as(23)), true);
  assert.equal(dentroDaJanela('22-5', as(12)), false);
  assert.equal(dentroDaJanela('', as(12)), true);
});

test('SQL: mercado_pesquisa (palavras, período, local) e painel do concorrente', async () => {
  const db = new PGlite();
  await db.exec(`create schema extensions; create function extensions.unaccent(t text) returns text language sql immutable as $$
    select translate(t, 'áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC') $$;
    create role authenticated; create role anon; create role service_role;
    create table public.mercado_resultados (id serial, numero_controle_pncp text, orgao_cnpj text, orgao_nome text, uf text, municipio text,
      portal text, item_descricao text, unidade text, quantidade_homologada numeric, valor_unit_estimado numeric, valor_unit_homologado numeric,
      valor_total_homologado numeric, desconto_pct numeric, fornecedor_ni text, fornecedor_nome text, data_resultado date);
    create table public.mercado_coleta (numero_controle_pncp text primary key, situacao text, proxima_em timestamptz);`);
  const sql = readFileSync(new URL('../supabase/atualizar-mercado-fase3.sql', import.meta.url), 'utf8')
    .replace(/create or replace function public\.banco_tamanho_mb[\s\S]*$/, '');
  await db.exec(sql);
  await db.exec(`insert into public.mercado_resultados (numero_controle_pncp, orgao_cnpj, orgao_nome, uf, municipio, portal, item_descricao, unidade,
      quantidade_homologada, valor_unit_homologado, valor_total_homologado, desconto_pct, fornecedor_ni, fornecedor_nome, data_resultado) values
    ('A', '1', 'Pref. Joinville', 'SC', 'Joinville', 'BLL', 'Papel A4 75g resma', 'RESMA', 10, 25, 250, 10, '111', 'Alfa', current_date - 10),
    ('B', '2', 'Pref. Blumenau', 'SC', 'Blumenau', 'BNC', 'PAPEL SULFITE A4', 'RESMA', 5, 27, 135, 5, '111', 'Alfa', current_date - 40),
    ('C', '3', 'Pref. Curitiba', 'PR', 'Curitiba', 'BLL', 'Papelão ondulado', 'UN', 1, 3, 3, 0, '222', 'Beta', current_date - 5),
    ('D', '1', 'Pref. Joinville', 'SC', 'Joinville', 'BLL', 'Papel A4 reciclado', 'RESMA', 2, 30, 60, 1, '111', 'Alfa', current_date - 500)`);
  const pesquisa = async (...a) => (await db.query('select public.mercado_pesquisa($1, $2, $3, $4) as r', a)).rows[0].r;
  const tudo = await pesquisa('papel a4', null, null, 12);
  assert.deepEqual(tudo.map((r) => r.numero_controle_pncp), ['A', 'B'], 'palavra inteira (não "papelão") e só 12 meses');
  assert.equal((await pesquisa('papel a4', ['SC'], 'blumenau', 12)).length, 1, 'município sem acento/caixa');
  assert.equal((await pesquisa('papel a4', null, null, 24)).length, 3, 'período maior');

  const painel = (await db.query("select public.mercado_concorrente_painel('111') as p")).rows[0].p;
  assert.equal(painel.orgaos[0].orgao, 'Pref. Joinville');
  assert.equal(painel.orgaos[0].compras, 2);
  assert.equal(painel.mensal.reduce((s, m) => s + m.itens, 0), 3, '24 meses');
  assert.deepEqual(painel.ufs.map((u) => u.uf), ['SC']);
  await db.close();
});
