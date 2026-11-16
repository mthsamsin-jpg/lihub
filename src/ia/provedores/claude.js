// Leitura de edital com o Claude (API da Anthropic, SDK oficial). Provedor
// opcional: ative com IA_PROVEDOR=claude no .env.
//
// - Modelo: linha Sonnet (padrão claude-sonnet-5-5). Configurável por CLAUDE_MODELO.
// - Saída estruturada (output_config.format): a API garante o JSON Schema da análise.
// - Streaming: editais longos geram respostas demoradas.
// - Fallback no servidor (fallbacks: "default"): se o modelo recusar por um
//   falso positivo dos filtros de segurança, a própria API tenta outro modelo.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { config } from '../../config.js';
import { exigirDocumento, validarAnalise } from '../comum.js';
import { AnaliseEditalSchema } from '../esquema-analise.js';
import { ErroAnalise } from '../erros.js';
import { INSTRUCOES_SISTEMA, montarPedido } from '../prompt.js';

// JSON Schema gerado a partir do Zod. Tiramos o "parse" automático do SDK para
// conferir o motivo de parada (recusa, resposta cortada) antes de validar.
const { parse: _parseAutomatico, ...FORMATO_JSON } = betaZodOutputFormat(AnaliseEditalSchema);

const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

let clientePadrao = null;
/** Cliente da Anthropic. Lê ANTHROPIC_API_KEY do ambiente. */
export function clienteAnthropic() {
  clientePadrao ??= new Anthropic();
  return clientePadrao;
}

export function estimarCustoClaude(uso, modelo) {
  const p = config.claude.precos[modelo];
  if (!p || !uso) return null;
  const milhao = 1_000_000;
  const custo =
    ((uso.input_tokens ?? 0) * p.entrada +
      (uso.output_tokens ?? 0) * p.saida +
      (uso.cache_read_input_tokens ?? 0) * p.cacheLeitura +
      (uso.cache_creation_input_tokens ?? 0) * p.cacheEscrita) / milhao;
  return Math.round(custo * 10_000) / 10_000;
}

function traduzirErroDaApi(e) {
  if (e instanceof ErroAnalise) return e;
  if (e instanceof Anthropic.APIUserAbortError) {
    return new ErroAnalise('A análise foi cancelada.', { codigo: 'cancelada', status: 499, causa: e });
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new ErroAnalise('Chave da API da Anthropic ausente ou inválida (ANTHROPIC_API_KEY).', { codigo: 'chave_invalida', status: 500, causa: e });
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new ErroAnalise('A chave da Anthropic não tem permissão para este modelo ou recurso.', { codigo: 'sem_permissao', status: 500, causa: e });
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ErroAnalise('Muitas análises ao mesmo tempo. Tente novamente em alguns minutos.', { codigo: 'limite_taxa', status: 429, causa: e });
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new ErroAnalise(
      'A IA não conseguiu processar este documento (pode ser grande demais, ter mais de 600 páginas, estar protegido por senha ou corrompido).',
      { codigo: 'documento_recusado', status: 422, detalhes: e.message, causa: e },
    );
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ErroAnalise('Não foi possível conectar à API da Anthropic. Verifique a internet do servidor.', { codigo: 'sem_conexao', status: 502, causa: e });
  }
  if (e instanceof Anthropic.APIError) {
    return new ErroAnalise(`A API da Anthropic respondeu com erro (${e.status ?? 'sem status'}). Tente novamente.`, { codigo: 'erro_api', status: 502, causa: e });
  }
  return e;
}

/**
 * @param {{ pdf?: Buffer, texto?: string, nomeArquivo?: string, contexto?: object }} entrada
 * @param {{ modelo?: string, esforco?: 'low'|'medium'|'high'|'xhigh'|'max', maxTokens?: number,
 *   cliente?: Anthropic, sinal?: AbortSignal }} [opcoes]
 */
export async function analisarComClaude(entrada, opcoes = {}) {
  const { pdf, texto, nomeArquivo, contexto } = entrada ?? {};
  const {
    modelo = config.claude.modelo,
    esforco = config.claude.esforco,
    maxTokens = config.claude.maxTokens,
    cliente = clienteAnthropic(),
    sinal,
  } = opcoes;

  const documento = exigirDocumento({ pdf, texto }) === 'pdf'
    ? { type: 'document', title: nomeArquivo || 'edital.pdf', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } }
    : { type: 'document', title: nomeArquivo || 'edital.txt', source: { type: 'text', media_type: 'text/plain', data: texto } };

  let mensagem;
  try {
    const stream = cliente.beta.messages.stream(
      {
        model: modelo,
        max_tokens: maxTokens,
        betas: [BETA_FALLBACK],
        fallbacks: 'default',
        system: INSTRUCOES_SISTEMA,
        output_config: { effort: esforco, format: FORMATO_JSON },
        messages: [{ role: 'user', content: [documento, { type: 'text', text: montarPedido(contexto) }] }],
      },
      { signal: sinal },
    );
    mensagem = await stream.finalMessage();
  } catch (e) {
    throw traduzirErroDaApi(e);
  }

  if (mensagem.stop_reason === 'refusal') {
    throw new ErroAnalise(
      'A IA não aceitou analisar este documento. Confira se o arquivo é mesmo um edital e tente novamente.',
      { codigo: 'recusa', status: 422, detalhes: mensagem.stop_details ?? null },
    );
  }
  if (mensagem.stop_reason === 'max_tokens') {
    throw new ErroAnalise(
      'A análise ficou maior que o limite de resposta e foi interrompida. Tente enviar só o edital, sem os anexos.',
      { codigo: 'resposta_cortada', status: 422 },
    );
  }

  const analise = validarAnalise(mensagem.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
  const uso = mensagem.usage ?? {};
  return {
    analise,
    provedor: 'claude',
    modelo: mensagem.model,
    fallbackUsado: (uso.iterations ?? []).some((i) => i?.type === 'fallback_message'),
    uso: {
      entrada: uso.input_tokens ?? 0,
      saida: uso.output_tokens ?? 0,
      cacheLeitura: uso.cache_read_input_tokens ?? 0,
      cacheEscrita: uso.cache_creation_input_tokens ?? 0,
    },
    custoEstimadoUsd: estimarCustoClaude(uso, mensagem.model),
  };
}
