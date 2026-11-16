// Converte um registro da API do PNCP numa linha da tabela public.licitacoes.

const FUSO_BRASILIA = '-03:00';

/** Remove o caractere nulo (o PostgreSQL recusa) e espaços nas pontas. */
export function texto(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replaceAll('\u0000', '').trim();
  return s === '' ? null : s;
}

export function inteiro(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Datas do PNCP vêm sem fuso ("2026-12-08T23:59:59") e estão no horário de
 * Brasília. Devolve ISO 8601 em UTC, pronto para colunas timestamptz.
 */
export function dataPncp(v) {
  const s = texto(v);
  if (!s) return null;
  let iso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = `${s}T00:00:00${FUSO_BRASILIA}`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) iso = `${s}${FUSO_BRASILIA}`;
  else iso = s; // já tem fuso (Z ou ±hh:mm)
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Só aceita links http(s): evita links "javascript:" chegando ao front-end. */
export function urlSegura(v) {
  const s = texto(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function semNulos(obj) {
  return JSON.parse(JSON.stringify(obj).replaceAll('\\u0000', ''));
}

/**
 * @param {object} c registro da API de Consulta do PNCP
 * @param {{ guardarBruto?: boolean, agora?: string }} opcoes
 * @returns {object|null} linha para public.licitacoes, ou null se faltar a chave
 */
export function normalizarContratacao(c, { guardarBruto = false, agora = new Date().toISOString() } = {}) {
  const numeroControle = texto(c?.numeroControlePNCP);
  if (!numeroControle) return null;

  const orgao = c.orgaoEntidade ?? {};
  const unidade = c.unidadeOrgao ?? {};
  const uf = texto(unidade.ufSigla)?.toUpperCase() ?? null;
  const sigiloCodigo = inteiro(c.orcamentoSigilosoCodigo);

  return {
    fonte: 'pncp',
    numero_controle_pncp: numeroControle,
    orgao_cnpj: texto(orgao.cnpj),
    orgao_razao_social: texto(orgao.razaoSocial),
    orgao_esfera: texto(orgao.esferaId),
    orgao_poder: texto(orgao.poderId),
    unidade_codigo: texto(unidade.codigoUnidade),
    unidade_nome: texto(unidade.nomeUnidade),
    uf: uf && /^[A-Z]{2}$/.test(uf) ? uf : null,
    municipio: texto(unidade.municipioNome),
    municipio_ibge: texto(unidade.codigoIbge),
    ano_compra: inteiro(c.anoCompra),
    sequencial_compra: inteiro(c.sequencialCompra),
    numero_compra: texto(c.numeroCompra),
    processo: texto(c.processo),
    modalidade_id: inteiro(c.modalidadeId),
    modalidade_nome: texto(c.modalidadeNome),
    modo_disputa_id: inteiro(c.modoDisputaId),
    modo_disputa_nome: texto(c.modoDisputaNome),
    instrumento_convocatorio: texto(c.tipoInstrumentoConvocatorioNome),
    situacao_id: inteiro(c.situacaoCompraId),
    situacao_nome: texto(c.situacaoCompraNome),
    objeto: texto(c.objetoCompra) ?? '(objeto não informado)',
    informacao_complementar: texto(c.informacaoComplementar),
    srp: typeof c.srp === 'boolean' ? c.srp : null,
    amparo_legal: texto(c.amparoLegal?.nome),
    valor_estimado: numero(c.valorTotalEstimado),
    valor_homologado: numero(c.valorTotalHomologado),
    orcamento_sigiloso: sigiloCodigo === null ? null : sigiloCodigo !== 1, // 1 = "Compra sem sigilo"
    data_publicacao: dataPncp(c.dataPublicacaoPncp),
    data_abertura_proposta: dataPncp(c.dataAberturaProposta),
    data_encerramento_proposta: dataPncp(c.dataEncerramentoProposta),
    data_atualizacao_pncp: dataPncp(c.dataAtualizacaoGlobal ?? c.dataAtualizacao),
    sistema_origem: texto(c.usuarioNome),
    link_sistema_origem: urlSegura(c.linkSistemaOrigem),
    dados_brutos: guardarBruto ? semNulos(c) : null,
    sincronizado_em: agora,
  };
}

/** Normaliza uma página e remove repetidos (o upsert falha com chave duplicada no mesmo lote). */
export function normalizarPagina(registros, opcoes) {
  const porChave = new Map();
  for (const r of registros) {
    const linha = normalizarContratacao(r, opcoes);
    if (linha) porChave.set(linha.numero_controle_pncp, linha);
  }
  return [...porChave.values()];
}
