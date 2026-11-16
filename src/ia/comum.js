// Partes da leitura de edital que valem para qualquer provedor de IA.
import { AnaliseEditalSchema } from './esquema-analise.js';
import { ErroAnalise } from './erros.js';

export const AVISO_LEGAL =
  'Análise gerada automaticamente por inteligência artificial a partir do documento enviado. ' +
  'Pode conter erros ou omissões e não substitui a leitura integral do edital e de seus anexos, ' +
  'nem a orientação de um profissional habilitado. A responsabilidade pelas propostas, documentos ' +
  'e declarações apresentados é exclusivamente do licitante.';

/**
 * Confere se há PDF ou texto para analisar.
 * @param {{ pdf?: Buffer, texto?: string }} [entrada]
 * @returns {'pdf'|'texto'}
 */
export function exigirDocumento({ pdf, texto } = {}) {
  if (pdf?.length) return 'pdf';
  if (texto?.trim()) return 'texto';
  throw new ErroAnalise('Envie o PDF ou o texto do edital.', { codigo: 'entrada_vazia', status: 400 });
}

/**
 * Valida o JSON devolvido pela IA contra o esquema da análise e acrescenta o
 * aviso legal. Lança ErroAnalise com mensagem amigável se algo estiver errado.
 */
export function validarAnalise(textoJson) {
  let bruto;
  try {
    bruto = JSON.parse(textoJson);
  } catch {
    throw new ErroAnalise('A IA devolveu uma resposta em formato inválido. Tente novamente.', { codigo: 'json_invalido', status: 502 });
  }
  const validacao = AnaliseEditalSchema.safeParse(bruto);
  if (!validacao.success) {
    throw new ErroAnalise('A resposta da IA não seguiu o formato esperado. Tente novamente.', {
      codigo: 'formato_invalido', status: 502, detalhes: validacao.error.issues.slice(0, 5),
    });
  }
  return { ...validacao.data, aviso_legal: AVISO_LEGAL };
}
