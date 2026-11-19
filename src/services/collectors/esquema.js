// Objeto padronizado que TODO coletor devolve, e a conversão para a linha de
// public.licitacoes. Só campos essenciais e estruturados: nada de payload bruto
// (o raw_data só é guardado se SCRAPER_GUARDAR_BRUTO=1, e mesmo assim limitado).
import { z } from 'zod';
import { dataPncp, numero, texto, urlSegura } from '../../pncp/normalizar.js';

const LIMITE_BRUTO = 8_000; // caracteres de JSON; acima disso o bruto é descartado

export const RegistroPadrao = z.object({
  external_id: z.string().min(1).max(200),
  source: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  orgao: z.string().nullable(),
  orgao_cnpj: z.string().regex(/^\d{14}$/).nullable().optional(),
  municipio: z.string().nullable(),
  uf: z.string().regex(/^[A-Z]{2}$/).nullable(),
  objeto: z.string().min(1),
  modalidade: z.string().nullable(),
  modalidade_id: z.number().int().nullable().optional(),
  valor_estimado: z.number().nullable(),
  data_publicacao: z.string().nullable(),
  data_abertura: z.string().nullable(),
  data_encerramento: z.string().nullable().optional(),
  url_edital: z.string().nullable(),
  raw_data: z.unknown().optional(),
  /** Campos extras da fonte que têm coluna própria em licitacoes (ex.: PNCP). */
  extras: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Monta um RegistroPadrao a partir de valores soltos, limpando texto, datas e números.
 * Coletores novos usam isto para não repetir a limpeza.
 */
export function registroPadrao(v) {
  const uf = texto(v.uf)?.toUpperCase() ?? null;
  const cnpj = texto(v.orgao_cnpj)?.replace(/\D/g, '') ?? null;
  return {
    external_id: texto(v.external_id),
    source: v.source,
    orgao: texto(v.orgao),
    orgao_cnpj: cnpj && cnpj.length === 14 ? cnpj : null,
    municipio: texto(v.municipio),
    uf: uf && /^[A-Z]{2}$/.test(uf) ? uf : null,
    objeto: texto(v.objeto) ?? '(objeto não informado)',
    modalidade: texto(v.modalidade),
    modalidade_id: Number.isInteger(v.modalidade_id) ? v.modalidade_id : null,
    valor_estimado: numero(v.valor_estimado),
    data_publicacao: dataPncp(v.data_publicacao),
    data_abertura: dataPncp(v.data_abertura),
    data_encerramento: dataPncp(v.data_encerramento),
    url_edital: urlSegura(v.url_edital),
    raw_data: v.raw_data,
    extras: v.extras,
  };
}

/** RegistroPadrao -> linha de public.licitacoes. */
export function paraLinha(r, { guardarBruto = false, agora = new Date().toISOString() } = {}) {
  let bruto = null;
  if (guardarBruto && r.raw_data !== undefined) {
    const json = JSON.stringify(r.raw_data).replaceAll('\\u0000', '');
    if (json.length <= LIMITE_BRUTO) bruto = JSON.parse(json);
  }
  return {
    // extras primeiro: os campos padronizados abaixo sempre prevalecem
    ...(r.extras || {}),
    fonte: r.source,
    external_id: r.external_id,
    orgao_razao_social: r.orgao,
    orgao_cnpj: r.orgao_cnpj ?? null,
    municipio: r.municipio,
    uf: r.uf,
    objeto: r.objeto,
    modalidade_nome: r.modalidade,
    modalidade_id: r.modalidade_id ?? null,
    valor_estimado: r.valor_estimado,
    data_publicacao: r.data_publicacao,
    data_abertura_proposta: r.data_abertura,
    data_encerramento_proposta: r.data_encerramento ?? null,
    url_edital: r.url_edital,
    dados_brutos: bruto,
    sincronizado_em: agora,
  };
}

/**
 * Valida e converte uma página. Registros inválidos são descartados (e contados);
 * repetidos na mesma página ficam só uma vez (o upsert recusa chave duplicada no lote).
 */
export function prepararLote(registros, opcoes) {
  const porChave = new Map();
  const invalidos = [];
  for (const r of registros) {
    const v = RegistroPadrao.safeParse(r);
    if (!v.success) { invalidos.push({ external_id: r?.external_id ?? null, erro: v.error.issues[0]?.message }); continue; }
    porChave.set(`${v.data.source}|${v.data.external_id}`, paraLinha(v.data, opcoes));
  }
  return { linhas: [...porChave.values()], invalidos };
}
