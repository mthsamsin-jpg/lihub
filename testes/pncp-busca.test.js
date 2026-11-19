// Busca ao vivo no PNCP: portal de origem, normalização e rotas (sem acessar a internet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { buscarNoPncp, normalizarResultado, portalDaOrigem } from '../src/pncp/busca.js';
import { ligarPncpAoVivo } from '../src/api/pncp-ao-vivo.js';
import { normalizarItens } from '../src/pncp/detalhes.js';

// Formato real de um resultado do /api/search do PNCP (18/11/2026, campos principais).
const BRUTO = {
  title: 'Edital nº 0015/2026',
  description: '[Portal de Compras Públicas] - Registro de preços para manutenção de notebooks',
  numero: '0015', ano: '2026', numero_sequencial: '60',
  numero_controle_pncp: '04628376000104-1-000060/2026',
  orgao_cnpj: '04628376000104', orgao_nome: 'MUNICIPIO DE ITAMARATI', unidade_nome: 'Prefeitura Municipal de Itamarati',
  municipio_nome: 'Itamarati', uf: 'AM', modalidade_licitacao_nome: 'Pregão - Eletrônico', modo_disputa_nome: 'Aberto',
  srp: true, valor_total_estimado: 0, indicador_orcamento_sigiloso: true, situacao_nome: 'Divulgada no PNCP',
  data_publicacao_pncp: '2026-11-17T23:48:27.288030', data_fim_recebimento_propostas: '', data_fim_vigencia: '2026-11-30T09:59',
  link_sistema_origem: 'https://www.portaldecompraspublicas.com.br/processos/AM/x', usuario_nome: 'ECustomize Consultoria em Software S.A',
  cancelado: false,
};

test('portalDaOrigem: pelo prefixo da descrição, pelo link e pelo sistema', () => {
  assert.deepEqual(portalDaOrigem({ descricao: '[Portal de Compras Públicas] - x' }), { chave: 'pcp', nome: 'Portal de Compras Públicas' });
  assert.equal(portalDaOrigem({ descricao: '[Compras.gov.br] - x' }).chave, 'comprasnet');
  assert.equal(portalDaOrigem({ link: 'https://bllcompras.com/Process/ProcessView?x' }).chave, 'bll');
  assert.equal(portalDaOrigem({ link: 'https://bnccompras.com/Process/1' }).chave, 'bnc');
  assert.equal(portalDaOrigem({ link: 'https://sala.bbmnet.com.br/x' }).chave, 'bbmnet');
  assert.equal(portalDaOrigem({ sistema: 'Licitanet Licitações Eletrônicas' }).chave, 'licitanet');
  assert.deepEqual(portalDaOrigem({ descricao: '[Sistema Próprio] - x', sistema: 'E & L PRODUCOES' }), { chave: 'outros', nome: 'Sistema Próprio' });
});

test('normalizarResultado: campos para a tela e para o "Importar para o Robô Turbo 2.0"', () => {
  const r = normalizarResultado(BRUTO);
  assert.equal(r.portal, 'pcp');
  assert.equal(r.objeto, 'Registro de preços para manutenção de notebooks');
  assert.equal(r.numero, '0015/2026');
  assert.equal(r.valorEstimado, null, 'zero = sigiloso, não R$ 0,00');
  assert.equal(r.orcamentoSigiloso, true);
  assert.equal(r.fimPropostas, '2026-11-30T09:59');
  assert.deepEqual([r.cnpj, r.ano, r.sequencial], ['04628376000104', 2026, 60]);
  assert.equal(r.linkPncp, 'https://pncp.gov.br/app/editais/04628376000104/2026/60');
});

test('buscarNoPncp: monta a consulta, tira cancelados e filtra a UF', async () => {
  let url;
  const r = await buscarNoPncp({ q: 'notebook', uf: 'AM' }, {
    base: 'https://pncp.exemplo/api/search',
    obter: async (u) => { url = new URL(u); return { total: 3, items: [BRUTO, { ...BRUTO, cancelado: true }, { ...BRUTO, uf: 'SP' }] }; },
  });
  assert.equal(url.searchParams.get('q'), 'notebook');
  assert.equal(url.searchParams.get('status'), 'recebendo_proposta');
  assert.equal(url.searchParams.get('tipos_documento'), 'edital');
  assert.equal(r.resultados.length, 1);
  await assert.rejects(buscarNoPncp({ q: 'x' }, { obter: async () => ({ outra: 'coisa' }) }), /formato inesperado/);
  await assert.rejects(buscarNoPncp({ q: 'x' }, { obter: async () => { throw Object.assign(new Error('x'), { status: 503 }); } }), /fora do ar/);
});

test('rotas: valida a busca e a identificação da compra', async () => {
  const app = new Hono();
  ligarPncpAoVivo(app, {
    buscar: async ({ q, uf }) => ({ total: 1, pagina: 1, resultados: [{ q, uf, objeto: 'Aquisição de notebook', numeroControle: 'x' }] }),
    itens: async () => [{ numeroItem: 1, descricao: 'Notebook', quantidade: 30, unidadeMedida: 'UN', valorUnitarioEstimado: 4890 }],
  });
  assert.equal((await app.request('/api/pncp/busca?q=no')).status, 400);
  const ok = await (await app.request('/api/pncp/busca?q=notebook&uf=sp')).json();
  assert.deepEqual([ok.resultados[0].q, ok.resultados[0].uf, ok.resultados[0].achadoEm], ['notebook', 'SP', 'objeto']);
  const semUf = await (await app.request('/api/pncp/busca?q=notebook&uf=XX')).json();
  assert.equal(semUf.resultados[0].uf, null);
  assert.equal((await app.request('/api/pncp/compras/123/2026/60/itens')).status, 400);
  const itens = await (await app.request('/api/pncp/compras/04628376000104/2026/60/itens')).json();
  assert.deepEqual(itens.itens[0], { numero: 1, descricao: 'Notebook', tipo: '', quantidade: 30, unidade: 'UN', valorUnitario: 4890, valorTotal: null, beneficio: '', situacao: '', posicao: 1, total: 1 });
});

test('itens: ordem oficial 1..N, sem repetidos entre páginas, sem número vai para o fim', () => {
  const r = normalizarItens([
    { numeroItem: 10, descricao: 'J' }, { numeroItem: 2, descricao: 'B' }, null,
    { descricao: 'sem número' }, { numeroItem: 1, descricao: 'A' }, { numeroItem: 2, descricao: 'B repetido' },
  ]);
  assert.deepEqual(r.map((i) => i.numero), [1, 2, 10, null]);
  assert.deepEqual(r.map((i) => i.posicao), [1, 2, 3, 4]);
  assert.ok(r.every((i) => i.total === 4));
  assert.equal(r[1].descricao, 'B');
});

test('palavras: vírgula = OU, todas as palavras da alternativa, começo de palavra, sem acento', async () => {
  const { gruposDeTermos, casaTermos, tipoObjeto } = await import('../src/pncp/termos.js');
  const g = gruposDeTermos('copo, papel A4');
  assert.deepEqual(g, [['copo'], ['papel', 'a4']]);
  assert.equal(casaTermos('AQUISIÇÃO DE COPOS DESCARTÁVEIS', g), true);
  assert.equal(casaTermos('Utensílios de copa e cozinha', g), false, 'copo não acha copa');
  assert.equal(casaTermos('Resmas de papel sulfite A4', g), true);
  assert.equal(casaTermos('Papel higiênico', g), false, 'papel sem A4 não passa');
  assert.equal(casaTermos('Ação de saúde', gruposDeTermos('acao')), true, 'sem acento');
  assert.equal(tipoObjeto('Aquisição de copos descartáveis'), 'material');
  assert.equal(tipoObjeto('Contratação de empresa para prestação de serviços de limpeza'), 'servico');
});

test('busca ao vivo: confere objeto e itens, junta alternativas e filtra o tipo', async () => {
  const base = (id, objeto) => ({ numeroControle: id, cnpj: '04628376000104', ano: 2026, sequencial: Number(id), objeto });
  const app = new Hono();
  const pedidos = [];
  ligarPncpAoVivo(app, {
    buscar: async ({ q, uf }) => {
      pedidos.push([q, uf]);
      return q === 'copo'
        ? { total: 3, resultados: [base('1', 'Aquisição de copos'), base('2', 'Material de expediente'), base('3', 'Utensílios de copa')] }
        : { total: 1, resultados: [base('4', 'Aquisição de papel A4'), base('1', 'Aquisição de copos')] };
    },
    itens: async ({ sequencial }) => (sequencial === 2
      ? [{ numeroItem: 1, descricao: 'Copo plástico 200 ml', materialOuServico: 'M' }, { numeroItem: 2, descricao: 'Caneta' }]
      : [{ numeroItem: 1, descricao: 'Panela' }]),
  });
  const r = await (await app.request('/api/pncp/busca?q=' + encodeURIComponent('copo, papel A4') + '&uf=SP')).json();
  assert.deepEqual(pedidos, [['copo', 'SP'], ['papel a4', 'SP']]);
  assert.deepEqual(r.resultados.map((x) => [x.numeroControle, x.achadoEm, x.itensComTermo]), [['1', 'objeto', null], ['2', 'itens', 1], ['4', 'objeto', null]]);
  const servicos = await (await app.request('/api/pncp/busca?q=copo&tipo=servico')).json();
  assert.equal(servicos.resultados.length, 0, 'compras de copo não são serviço');
});
