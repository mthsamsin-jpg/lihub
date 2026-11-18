// Busca AO VIVO no PNCP por palavra-chave (sem passar pelo banco sincronizado).
//
// A API de consulta oficial (/api/consulta/v1/contratacoes/publicacao) só filtra
// por data, modalidade e UF: não tem busca por texto. A busca por palavra usa o
// mesmo endpoint público que o próprio site do PNCP usa (/api/search), que traz
// órgão, objeto, número, valor estimado, modo de disputa e o link do sistema de
// origem (de onde sai o portal da disputa). É um endpoint público mas NÃO
// documentado: se ele mudar, a busca avisa e o resto do sistema segue igual.
// Os itens de cada compra vêm da API de integração oficial (cliente.js).
import { config } from '../config.js';
import { obterJson } from './cliente.js';

export class ErroBuscaPncp extends Error {
  constructor(mensagem, status = 502) {
    super(mensagem);
    this.status = status;
  }
}

// Portal da disputa a partir do texto "[Portal X] - ..." da descrição, do link
// do sistema de origem e do nome do sistema que publicou. A ordem importa.
const PORTAIS = [
  ['comprasnet', 'Compras.gov.br', ['compras.gov', 'comprasnet', 'siasg', 'comprasgovernamentais']],
  ['bll', 'BLL Compras', ['bllcompras', 'bll compras', 'bolsa de licita', '[bll']],
  ['licitanet', 'Licitanet', ['licitanet']],
  ['pcp', 'Portal de Compras Públicas', ['portal de compras p', 'portaldecompraspublicas', 'ecustomize']],
  ['bnc', 'BNC', ['bnccompras', 'bolsa nacional de compras', '[bnc']],
  ['licitar', 'Licitar Digital', ['licitar digital', 'licitardigital']],
  ['bbmnet', 'BBMNET', ['bbmnet', 'bbm net']],
  ['licitacoes-e', 'Licitações-e', ['licitacoes-e', 'licitações-e', 'banco do brasil']],
  ['comprasbr', 'ComprasBR', ['comprasbr', 'compras br']],
  ['licitamais', 'Licita Mais Brasil', ['licita mais', 'licitamais']],
];
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Descobre o portal da disputa. Devolve { chave, nome } ('outros' se não reconhecer). */
export function portalDaOrigem({ descricao = '', link = '', sistema = '' } = {}) {
  const prefixo = /^\s*\[([^\]]+)\]/.exec(descricao)?.[1] || '';
  for (const fonte of [`[${prefixo}`, link, sistema]) {
    const t = semAcento(fonte);
    if (!t || t === '[') continue;
    const achado = PORTAIS.find(([, , termos]) => termos.some((x) => t.includes(semAcento(x))));
    if (achado) return { chave: achado[0], nome: achado[1] };
  }
  return { chave: 'outros', nome: prefixo || sistema || 'Outro portal' };
}

const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const data = (v) => (v ? String(v).slice(0, 16) : null);

/** Um resultado bruto do /api/search -> formato da tela. */
export function normalizarResultado(r) {
  const descricao = String(r.description || '');
  const portal = portalDaOrigem({ descricao, link: r.link_sistema_origem, sistema: r.usuario_nome });
  const valor = numero(r.valor_total_estimado);
  return {
    numeroControle: r.numero_controle_pncp || null,
    cnpj: r.orgao_cnpj || null,
    ano: numero(r.ano),
    sequencial: numero(r.numero_sequencial),
    numero: r.numero && r.ano ? `${r.numero}/${r.ano}` : (r.title || null),
    titulo: r.title || null,
    objeto: descricao.replace(/^\s*\[[^\]]+\]\s*-?\s*/, '').trim() || null,
    orgao: r.orgao_nome || null,
    unidade: r.unidade_nome || null,
    municipio: r.municipio_nome || null,
    uf: r.uf || null,
    modalidade: r.modalidade_licitacao_nome || null,
    modoDisputa: r.modo_disputa_nome || null,
    srp: r.srp === true,
    valorEstimado: valor && valor > 0 ? valor : null,
    orcamentoSigiloso: r.indicador_orcamento_sigiloso === true,
    situacao: r.situacao_nome || null,
    publicadoEm: data(r.data_publicacao_pncp),
    fimPropostas: data(r.data_fim_recebimento_propostas || r.data_fim_vigencia),
    portal: portal.chave,
    portalNome: portal.nome,
    linkOrigem: r.link_sistema_origem || null,
    linkPncp: r.orgao_cnpj && r.ano && r.numero_sequencial ? `https://pncp.gov.br/app/editais/${r.orgao_cnpj}/${r.ano}/${r.numero_sequencial}` : null,
  };
}

/**
 * Busca contratações com propostas abertas no PNCP.
 * @param {{ q: string, pagina?: number, tamanho?: number, uf?: string, status?: string }} filtros
 */
export async function buscarNoPncp({ q, pagina = 1, tamanho = 20, uf = null, status = 'recebendo_proposta' }, { base = config.pncp.urlBusca, obter = obterJson } = {}) {
  const url = new URL(`${base.replace(/\/$/, '')}/`);
  url.searchParams.set('q', q);
  url.searchParams.set('tipos_documento', 'edital');
  url.searchParams.set('ordenacao', '-data');
  url.searchParams.set('pagina', String(pagina));
  url.searchParams.set('tam_pagina', String(tamanho));
  if (status) url.searchParams.set('status', status);
  if (uf) url.searchParams.set('ufs', uf);
  let json;
  try {
    json = await obter(url.toString(), { tentativas: 2, timeoutMs: 45_000 });
  } catch (e) {
    throw new ErroBuscaPncp([502, 503, 504].includes(e?.status) ? 'O PNCP está fora do ar agora. Tente de novo em alguns minutos.' : `Não consegui buscar no PNCP: ${e.message}`);
  }
  if (!json || !Array.isArray(json.items)) throw new ErroBuscaPncp('O PNCP respondeu num formato inesperado (a busca do site pode ter mudado).');
  const resultados = json.items.filter((r) => !r.cancelado && (!uf || r.uf === uf)).map(normalizarResultado);
  return { total: numero(json.total) ?? json.items.length, pagina, resultados };
}
