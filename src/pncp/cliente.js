// Cliente da API pública do PNCP (Portal Nacional de Contratações Públicas).
// Documentação: https://pncp.gov.br/api/consulta/swagger-ui/index.html
//
// A API é gratuita e não exige chave, mas é lenta e às vezes instável
// (respostas 500/503, consultas de 30 a 60 segundos). Por isso:
//   - tempo limite generoso por requisição;
//   - novas tentativas com espera crescente em 5xx e falhas de rede;
//   - ritmo controlado: intervalo mínimo entre consultas e, quando o PNCP
//     responde HTTP 429 ("vá mais devagar"), pausa geral crescente;
//   - 204 (sem conteúdo) é tratado como "nenhum resultado".
import { config } from '../config.js';
import { esperar } from '../util.js';

const AGENTE = 'LicitaHub-Sincronizador/0.1';

export class ErroPncp extends Error {
  constructor(mensagem, { status = null, url = null, corpo = null } = {}) {
    super(mensagem);
    this.name = 'ErroPncp';
    this.status = status;
    this.url = url;
    this.corpo = corpo;
  }
}

function montarUrl(base, caminho, parametros = {}) {
  const url = new URL(base.replace(/\/$/, '') + caminho);
  for (const [k, v] of Object.entries(parametros)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

function sinalComTempo(timeoutMs, sinalExterno) {
  const tempo = AbortSignal.timeout(timeoutMs);
  return sinalExterno ? AbortSignal.any([tempo, sinalExterno]) : tempo;
}

// Ritmo das consultas, compartilhado pelo processo inteiro. Medido em
// 15/11/2026: consultas uma de cada vez são aceitas; várias ao mesmo tempo, ou
// novas tentativas logo depois de uma recusa, recebem HTTP 429. Então toda
// consulta respeita um intervalo mínimo e, quando chega um 429, todas param
// JUNTAS por um tempo crescente (15 s, 30 s, 60 s, até 2 min).
const padraoRitmo = () => ({
  intervaloMs: config.pncp.intervaloMs,
  pausaInicialMs: 15_000,
  pausaMaximaMs: 120_000,
  recusasMaximas: 6, // 429 seguidos na mesma consulta antes de desistir (~6 min de pausas)
});
const ritmo = { ...padraoRitmo(), proximaEm: 0, pausaAte: 0, recusasSeguidas: 0 };

/** Ajusta o ritmo das consultas; sem argumentos, volta ao padrão. Usado nos testes. */
export function ajustarRitmo(valores = {}) {
  Object.assign(ritmo, padraoRitmo(), valores, { proximaEm: 0, pausaAte: 0, recusasSeguidas: 0 });
}

/** Espera a vez desta consulta: intervalo mínimo e pausas pedidas pelo PNCP. */
async function aguardarVez(sinal) {
  for (;;) {
    if (sinal?.aborted) throw sinal.reason;
    const agora = Date.now();
    const livreEm = Math.max(ritmo.proximaEm, ritmo.pausaAte);
    if (livreEm <= agora) {
      ritmo.proximaEm = agora + ritmo.intervaloMs;
      return;
    }
    await esperar(livreEm - agora, sinal);
  }
}

/** O PNCP respondeu 429: pausa todas as consultas. Devolve a espera em ms. */
function pausarTudo(resposta) {
  ritmo.recusasSeguidas += 1;
  const pedida = Number(resposta?.headers?.get('retry-after')) * 1000;
  const esperaMs = Number.isFinite(pedida) && pedida > 0
    ? Math.min(pedida, ritmo.pausaMaximaMs)
    : Math.min(ritmo.pausaInicialMs * 2 ** (ritmo.recusasSeguidas - 1), ritmo.pausaMaximaMs);
  ritmo.pausaAte = Math.max(ritmo.pausaAte, Date.now() + esperaMs);
  return esperaMs;
}

function esperaAntesDeTentar(falhas, resposta) {
  const pedida = Number(resposta?.headers?.get('retry-after'));
  if (Number.isFinite(pedida) && pedida > 0) return Math.min(pedida * 1000, 60_000);
  return Math.min(2_000 * 2 ** (falhas - 1), 30_000) + Math.floor(Math.random() * 1_000);
}

/**
 * GET com controle de ritmo e novas tentativas. Devolve o JSON, ou null quando
 * a API responde 204.
 * @param {string} url
 * @param {{ timeoutMs?: number, tentativas?: number, maxRecusas?: number, sinal?: AbortSignal,
 *   aoFalhar?: (info: { tentativa: number, erro: ErroPncp, esperaMs: number }) => void }} [opcoes]
 *   tentativas: limite para erros 5xx e de rede; maxRecusas: limite para HTTP 429.
 */
export async function obterJson(url, opcoes = {}) {
  const {
    timeoutMs = config.pncp.timeoutMs,
    tentativas = config.pncp.tentativas,
    maxRecusas = ritmo.recusasMaximas,
    sinal,
    aoFalhar,
  } = opcoes;

  let falhas = 0;
  let recusas = 0;
  for (;;) {
    await aguardarVez(sinal);
    let resposta;
    let erro;
    try {
      resposta = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': AGENTE },
        signal: sinalComTempo(timeoutMs, sinal),
      });
      if (resposta.status === 204) {
        ritmo.recusasSeguidas = 0;
        return null;
      }
      const corpo = await resposta.text();
      if (resposta.ok) {
        ritmo.recusasSeguidas = 0;
        if (!corpo.trim()) return null;
        try {
          return JSON.parse(corpo);
        } catch {
          throw new ErroPncp('O PNCP respondeu algo que não é JSON.', { status: resposta.status, url, corpo: corpo.slice(0, 300) });
        }
      }
      erro = new ErroPncp(
        resposta.status === 429 ? 'O PNCP pediu para ir mais devagar (HTTP 429).' : `O PNCP respondeu HTTP ${resposta.status}.`,
        { status: resposta.status, url, corpo: corpo.slice(0, 300) },
      );
    } catch (e) {
      if (sinal?.aborted) throw sinal.reason ?? e;
      if (e instanceof ErroPncp) throw e; // resposta que não é JSON: repetir não resolve
      const motivo = e?.name === 'TimeoutError' ? `tempo esgotado (${Math.round(timeoutMs / 1000)} s)` : (e?.cause?.code || e?.message);
      erro = new ErroPncp(`Falha ao acessar o PNCP: ${motivo}.`, { url });
    }

    if (erro.status === 429) {
      recusas += 1;
      const esperaMs = pausarTudo(resposta);
      if (recusas >= maxRecusas) throw erro;
      aoFalhar?.({ tentativa: recusas, erro, esperaMs });
      continue; // a pausa acontece em aguardarVez()
    }
    if (erro.status !== null && erro.status < 500) throw erro; // 4xx: repetir não resolve
    falhas += 1;
    if (falhas >= tentativas) throw erro;
    const esperaMs = esperaAntesDeTentar(falhas, resposta);
    aoFalhar?.({ tentativa: falhas, erro, esperaMs });
    await esperar(esperaMs, sinal);
  }
}

// ---------------------------------------------------------------------------
// API de Consulta (/api/consulta)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ dataInicial?: string, dataFinal: string, modalidade?: number,
 *   uf?: string|null, pagina?: number, tamanhoPagina?: number }} ParametrosConsulta
 */

/**
 * Contratações com recebimento de propostas aberto até `dataFinal` (AAAAMMDD).
 * @param {ParametrosConsulta} p
 */
export function urlPropostasAbertas({ dataFinal, modalidade, uf, pagina = 1, tamanhoPagina = 50 }) {
  return montarUrl(config.pncp.urlConsulta, '/v1/contratacoes/proposta', {
    dataFinal, codigoModalidadeContratacao: modalidade, uf, pagina, tamanhoPagina,
  });
}

/**
 * Contratações atualizadas entre `dataInicial` e `dataFinal` (AAAAMMDD).
 * @param {ParametrosConsulta} p
 */
export function urlAtualizacoes({ dataInicial, dataFinal, modalidade, uf, pagina = 1, tamanhoPagina = 50 }) {
  return montarUrl(config.pncp.urlConsulta, '/v1/contratacoes/atualizacao', {
    dataInicial, dataFinal, codigoModalidadeContratacao: modalidade, uf, pagina, tamanhoPagina,
  });
}

/** Uma contratação específica. */
export function obterContratacao({ cnpj, ano, sequencial }, opcoes) {
  return obterJson(montarUrl(config.pncp.urlConsulta, `/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`), opcoes);
}

// ---------------------------------------------------------------------------
// API de Integração (/api/pncp): documentos (edital em PDF) da contratação.
// Atenção: em 15/11/2026 esta API respondia "503 No server is available"
// (manutenção do governo). O código trata a indisponibilidade com mensagem clara.
// ---------------------------------------------------------------------------

function baseCompra({ cnpj, ano, sequencial }) {
  return `${config.pncp.urlIntegracao.replace(/\/$/, '')}/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`;
}

/** Lista os documentos publicados da contratação (edital, termo de referência, anexos). */
export async function listarArquivos(compra, opcoes) {
  const lista = await obterJson(`${baseCompra(compra)}/arquivos`, opcoes);
  return Array.isArray(lista) ? lista : [];
}

/** Escolhe o documento mais provável de ser o edital. */
export function escolherEdital(arquivos, compra) {
  const ativos = arquivos.filter((a) => a && a.statusAtivo !== false);
  const nome = (a) => `${a.tipoDocumentoNome ?? ''} ${a.tipoDocumentoDescricao ?? ''} ${a.titulo ?? ''}`;
  const escolhido =
    ativos.find((a) => /edital/i.test(nome(a)) && !/aviso|errata|retifica/i.test(nome(a))) ||
    ativos.find((a) => /edital/i.test(nome(a))) ||
    ativos.find((a) => /termo de refer|aviso de contrata/i.test(nome(a))) ||
    ativos[0];
  if (!escolhido) return null;

  const url = escolhido.url || escolhido.uri ||
    (escolhido.sequencialDocumento != null ? `${baseCompra(compra)}/arquivos/${escolhido.sequencialDocumento}` : null);
  return url ? { url, titulo: escolhido.titulo || escolhido.tipoDocumentoNome || 'Edital' } : null;
}

/**
 * Baixa um arquivo do PNCP com limite de tamanho.
 * Só aceita endereços do próprio PNCP (evita que o servidor seja usado para
 * acessar endereços arbitrários).
 * @param {string} url
 * @param {{ maxBytes?: number, timeoutMs?: number, sinal?: AbortSignal }} [opcoes]
 */
export async function baixarArquivo(url, { maxBytes, timeoutMs = 120_000, sinal } = {}) {
  const alvo = new URL(url);
  if (alvo.protocol !== 'https:' || !(alvo.hostname === 'pncp.gov.br' || alvo.hostname.endsWith('.pncp.gov.br'))) {
    throw new ErroPncp('Endereço de arquivo fora do PNCP recusado.', { url });
  }

  await aguardarVez(sinal);
  const resposta = await fetch(alvo, {
    headers: { 'User-Agent': AGENTE },
    signal: sinalComTempo(timeoutMs, sinal),
    redirect: 'follow',
  });
  if (!resposta.ok) {
    throw new ErroPncp(`Não foi possível baixar o arquivo do PNCP (HTTP ${resposta.status}).`, { status: resposta.status, url });
  }
  const tamanhoDeclarado = Number(resposta.headers.get('content-length'));
  if (maxBytes && tamanhoDeclarado > maxBytes) {
    throw new ErroPncp(`O arquivo tem ${(tamanhoDeclarado / 1048576).toFixed(1)} MB, acima do limite.`, { url });
  }

  const partes = [];
  let total = 0;
  for await (const parte of resposta.body) {
    total += parte.length;
    if (maxBytes && total > maxBytes) {
      throw new ErroPncp('O arquivo é maior que o limite permitido.', { url });
    }
    partes.push(parte);
  }

  const disposicao = resposta.headers.get('content-disposition') || '';
  const bruto = /filename\*=UTF-8''([^;]+)/i.exec(disposicao)?.[1] || /filename="?([^";]+)"?/i.exec(disposicao)?.[1] || null;
  let nome = bruto;
  try { nome = bruto ? decodeURIComponent(bruto) : null; } catch { /* mantém o nome original */ }
  return {
    dados: Buffer.concat(partes),
    tipo: resposta.headers.get('content-type') || '',
    nome,
  };
}
