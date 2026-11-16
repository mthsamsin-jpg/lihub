// Preparação do documento do edital (PDF enviado, texto ou PDF baixado do PNCP).
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { baixarArquivo, escolherEdital, listarArquivos } from '../pncp/cliente.js';
import { interpretarNumeroControle } from '../pncp/dominio.js';
import { ErroAnalise } from './erros.js';

export const maxBytesPdf = () => config.servidor.pdfMaxMb * 1024 * 1024;

export const sha256 = (dados) => createHash('sha256').update(dados).digest('hex');

/** Confere se é um PDF dentro do limite de tamanho. */
export function verificarPdf(dados, maxBytes = maxBytesPdf()) {
  if (!dados?.length) {
    throw new ErroAnalise('O arquivo está vazio.', { codigo: 'arquivo_vazio', status: 400 });
  }
  if (dados.length > maxBytes) {
    const mb = (dados.length / 1048576).toFixed(1);
    throw new ErroAnalise(`O PDF tem ${mb} MB; o limite é ${Math.round(maxBytes / 1048576)} MB.`, { codigo: 'arquivo_grande', status: 413 });
  }
  const inicio = dados.subarray(0, 1024).toString('latin1');
  if (inicio.startsWith('PK')) {
    throw new ErroAnalise('O arquivo é compactado (.zip). Extraia e envie o PDF do edital.', { codigo: 'arquivo_zip', status: 415 });
  }
  if (!inicio.includes('%PDF-')) {
    throw new ErroAnalise('O arquivo não é um PDF válido.', { codigo: 'nao_e_pdf', status: 415 });
  }
  return dados;
}

/**
 * Baixa o edital publicado no PNCP para uma licitação do catálogo.
 * @param {object} licitacao linha de public.licitacoes
 * @param {{ maxBytes?: number, sinal?: AbortSignal }} [opcoes]
 */
export async function obterEditalDoPncp(licitacao, { maxBytes = maxBytesPdf(), sinal } = {}) {
  const compra = licitacao.orgao_cnpj && licitacao.ano_compra && licitacao.sequencial_compra
    ? { cnpj: licitacao.orgao_cnpj, ano: licitacao.ano_compra, sequencial: licitacao.sequencial_compra }
    : interpretarNumeroControle(licitacao.numero_controle_pncp);
  if (!compra) {
    throw new ErroAnalise('Esta licitação não tem identificação do PNCP. Envie o PDF do edital.', { codigo: 'sem_identificacao', status: 400 });
  }

  let arquivos;
  try {
    arquivos = await listarArquivos(compra, { sinal, tentativas: 2 });
  } catch (e) {
    const foraDoAr = e?.status === 503 || e?.status === 502;
    throw new ErroAnalise(
      foraDoAr
        ? 'O serviço de documentos do PNCP está fora do ar no momento. Tente mais tarde ou envie o PDF do edital.'
        : `Não foi possível consultar os documentos no PNCP: ${e?.message ?? e}`,
      { codigo: 'pncp_indisponivel', status: 502, causa: e },
    );
  }

  const edital = escolherEdital(arquivos, compra);
  if (!edital) {
    throw new ErroAnalise('O PNCP não tem documentos publicados para esta licitação. Envie o PDF do edital.', { codigo: 'sem_documentos', status: 404 });
  }

  let arquivo;
  try {
    arquivo = await baixarArquivo(edital.url, { maxBytes, sinal });
  } catch (e) {
    throw new ErroAnalise(`Falha ao baixar o edital do PNCP: ${e?.message ?? e}`, { codigo: 'download_falhou', status: 502, causa: e });
  }
  verificarPdf(arquivo.dados, maxBytes);
  return { pdf: arquivo.dados, nomeArquivo: arquivo.nome || `${edital.titulo}.pdf` };
}
