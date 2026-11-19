// Inteligência de mercado (coleta de resultados do PNCP) e leitura automática de editais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coletarCompra, coletarResultados, linhaDeResultado, proximaTentativa } from '../src/mercado/coletar.js';
import { lerEditaisAutomaticamente } from '../src/ia/leitura-automatica.js';

const LIC = {
  id: 7, numero_controle_pncp: '04628376000104-1-000060/2026', orgao_cnpj: '04628376000104', ano_compra: 2026, sequencial_compra: 60,
  orgao_razao_social: 'MUNICIPIO X', uf: 'SP', municipio: 'Campinas', modalidade_id: 6, modalidade_nome: 'Pregão - Eletrônico',
  sistema_origem: 'BLL Compras', objeto: 'Aquisição de copos', data_encerramento_proposta: '2026-11-01T10:00:00Z',
};
const RES = {
  niFornecedor: '10.936.713/0001-15', nomeRazaoSocialFornecedor: 'COPIAR BRASIL LTDA', porteFornecedorNome: 'ME',
  quantidadeHomologada: 100, valorUnitarioHomologado: 8, valorTotalHomologado: 800, dataResultado: '2026-11-10', sequencialResultado: 1,
};

test('linhaDeResultado: vencedor, valores e dados da compra', () => {
  const l = linhaDeResultado(LIC, { numeroItem: 3, descricao: 'Copo 200 ml', materialOuServico: 'M', unidadeMedida: 'PCT', quantidade: 100, valorUnitarioEstimado: 10 }, RES);
  assert.equal(l.fornecedor_ni, '10936713000115');
  assert.equal(l.item_numero, 3);
  assert.equal(l.material_servico, 'M');
  assert.equal(l.valor_unit_estimado, 10);
  assert.equal(l.valor_unit_homologado, 8);
  assert.equal(l.portal, 'BLL Compras');
  assert.equal(l.data_resultado, '2026-11-10');
});

test('coletarCompra: só itens com resultado; ignora cancelados e 404', async () => {
  const pedidos = [];
  const r = await coletarCompra(LIC, {
    itens: async () => [{ numeroItem: 1, temResultado: true, descricao: 'Copo' }, { numeroItem: 2, temResultado: false }, { numeroItem: 3, temResultado: true }],
    resultados: async (c, n) => {
      pedidos.push(n);
      if (n === 3) throw Object.assign(new Error('não achou'), { status: 404 });
      return [RES, { ...RES, sequencialResultado: 2, dataCancelamento: '2026-11-11' }];
    },
  });
  assert.deepEqual(pedidos, [1, 3]);
  assert.equal(r.itens, 3);
  assert.equal(r.comResultado, 2);
  assert.equal(r.linhas.length, 1);
});

/** Supabase de mentira: guarda o que foi gravado. */
function falsoSupabase({ licitacoes = [LIC], coleta = [] } = {}) {
  const gravado = { resultados: [], coleta: [] };
  const consulta = (dados) => {
    const q = { data: dados, error: null };
    for (const m of ['select', 'eq', 'lt', 'gte', 'order', 'limit', 'in']) q[m] = () => q;
    q.then = (ok) => ok({ data: dados, error: null });
    return q;
  };
  return {
    gravado,
    from(tabela) {
      if (tabela === 'licitacoes') return consulta(licitacoes);
      if (tabela === 'mercado_coleta') return { ...consulta(coleta), upsert: async (l) => { gravado.coleta.push(l); return { error: null }; } };
      if (tabela === 'mercado_resultados') return { upsert: async (l) => { gravado.resultados.push(...l); return { error: null }; } };
      throw new Error(tabela);
    },
  };
}

test('coletarResultados: grava resultados, anota a coleta e respeita a próxima tentativa', async () => {
  const agora = Date.parse('2026-11-19T12:00:00Z');
  const sb = falsoSupabase({ licitacoes: [LIC, { ...LIC, id: 8, numero_controle_pncp: '04628376000104-1-000061/2026' }],
    coleta: [{ numero_controle_pncp: '04628376000104-1-000061/2026', situacao: 'sem_resultado', tentativas: 1, proxima_em: '2026-11-25T00:00:00Z' }] });
  const r = await coletarResultados({ lote: 10 }, {
    supabase: sb, agora, log: {},
    coletar: async () => ({ itens: 2, comResultado: 1, linhas: [linhaDeResultado(LIC, { numeroItem: 1 }, RES)] }),
  });
  assert.equal(r.compras, 1, 'a compra com tentativa marcada para depois fica para depois');
  assert.equal(sb.gravado.resultados.length, 1);
  assert.equal(sb.gravado.coleta[0].situacao, 'sem_resultado', 'parte dos itens ainda sem resultado: volta depois');
  assert.ok(sb.gravado.coleta[0].proxima_em > new Date(agora).toISOString());
});

test('proximaTentativa: espera crescente, no máximo 15 dias', () => {
  const agora = Date.parse('2026-11-19T00:00:00Z');
  assert.equal(proximaTentativa(1, agora), '2026-11-21T00:00:00.000Z');
  assert.equal(proximaTentativa(10, agora), '2026-12-04T00:00:00.000Z');
});

test('leitura automática: só licitações acompanhadas, abertas e sem análise; para quando a cota acaba', async () => {
  const tabelas = {
    organizacoes: [{ id: 'org1' }],
    crm_cards: [{ licitacao_id: 1 }, { licitacao_id: 2 }],
    membros: [{ user_id: 'u1' }],
    favoritos: [{ licitacao_id: 3 }],
    licitacoes: [{ id: 1 }, { id: 2 }, { id: 3 }],
    analises_edital: [{ licitacao_id: 1 }],
  };
  const sb = {
    from(t) {
      const q = { then: (ok) => ok({ data: tabelas[t], error: null }) };
      for (const m of ['select', 'eq', 'in', 'gte', 'order']) q[m] = () => q;
      return q;
    },
  };
  const pedidos = [];
  const r = await lerEditaisAutomaticamente({ porOrganizacao: 5 }, {
    supabase: sb, log: {},
    analisar: async (p) => { pedidos.push(p.licitacao_id); return pedidos.length === 1 ? { id: 'a1' } : { cota: true }; },
  });
  assert.deepEqual(pedidos, [2, 3], 'a licitação 1 já tem análise');
  assert.deepEqual(r, { organizacoes: 1, iniciadas: 1, semCota: 1 });
});
