// Leitura de edital com o Gemini (Google), SDK oficial @google/genai.
// Provedor padrão (IA_PROVEDOR=gemini). Chave grátis em https://aistudio.google.com
//
// - Modelo padrão: gemini-4-hydrogen (estável, com plano gratuito, lê PDF de
//   até 1.000 páginas). Configurável por GEMINI_MODELO.
// - Saída estruturada: responseMimeType "application/json" + responseJsonSchema,
//   então a resposta segue o esquema da análise.
// - Novas tentativas automáticas do SDK em 408, 429 e 5xx.
//
// ATENÇÃO (termos do Google, nov/2026): no plano GRATUITO o Google pode usar o
// conteúdo enviado para melhorar os produtos dele, inclusive com revisão humana,
// e pede que não se envie informação pessoal ou confidencial. Editais são
// documentos públicos; antes de atender clientes, ative o plano pago.
import { ApiError, GoogleGenAI } from '@google/genai';
import * as z from 'zod/v4';
import { config } from '../../config.js';
import { exigirDocumento, validarAnalise } from '../comum.js';
import { AnaliseEditalSchema } from '../esquema-analise.js';
import { ErroAnalise } from '../erros.js';
import { INSTRUCOES_SISTEMA, montarPedido } from '../prompt.js';

// JSON Schema da análise. O Zod já escreve campos anuláveis como
// ["string", "null"], formato aceito pelo Gemini; "$schema" sai por não fazer
// parte do subconjunto aceito.
const { $schema: _versao, ...ESQUEMA_JSON } = z.toJSONSchema(AnaliseEditalSchema);
export { ESQUEMA_JSON };

// Nível de raciocínio ("thinking") do Gemini. "auto" = não envia (usa o padrão do modelo).
const NIVEIS = { minimal: 'MINIMAL', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', xhigh: 'XHIGH', max: 'XHIGH' };

let clientePadrao = null;
export function clienteGemini() {
  if (!clientePadrao) {
    if (!config.gemini.chave) {
      throw new ErroAnalise('Chave do Gemini ausente: defina GEMINI_API_KEY no arquivo .env.', { codigo: 'chave_invalida', status: 500 });
    }
    clientePadrao = new GoogleGenAI({ apiKey: config.gemini.chave });
  }
  return clientePadrao;
}

/** No plano gratuito o custo é zero; no pago, usa a tabela de preços do config. */
export function estimarCustoGemini(uso, modelo) {
  if (config.gemini.plano !== 'pago') return 0;
  const chave = Object.keys(config.gemini.precos).find((m) => String(modelo).startsWith(m));
  const p = chave ? config.gemini.precos[chave] : null;
  if (!p || !uso) return null;
  const saida = (uso.candidatesTokenCount ?? 0) + (uso.thoughtsTokenCount ?? 0); // raciocínio é cobrado como saída
  const custo = ((uso.promptTokenCount ?? 0) * p.entrada + saida * p.saida) / 1_000_000;
  return Math.round(custo * 10_000) / 10_000;
}

function traduzirErro(e, modelo) {
  if (e instanceof ErroAnalise) return e;
  if (e?.name === 'AbortError') {
    return new ErroAnalise('A análise foi cancelada.', { codigo: 'cancelada', status: 499, causa: e });
  }
  if (e instanceof ApiError) {
    const mensagem = String(e.message ?? '');
    if (/api[_ ]?key/i.test(mensagem)) {
      return new ErroAnalise('Chave do Gemini inválida (GEMINI_API_KEY). Confira a chave em aistudio.google.com.', { codigo: 'chave_invalida', status: 500, causa: e });
    }
    if (/location|region/i.test(mensagem)) {
      return new ErroAnalise('O Gemini não está disponível na região deste servidor.', { codigo: 'regiao_indisponivel', status: 500, causa: e });
    }
    if (e.status === 400 && /schema/i.test(mensagem)) {
      return new ErroAnalise('O Gemini recusou o formato de resposta configurado (esquema).', { codigo: 'esquema_recusado', status: 500, detalhes: mensagem, causa: e });
    }
    if (e.status === 400) {
      return new ErroAnalise(
        'A IA não conseguiu processar este documento (pode ser grande demais, protegido por senha ou corrompido).',
        { codigo: 'documento_recusado', status: 422, detalhes: mensagem, causa: e },
      );
    }
    if (e.status === 401 || e.status === 403) {
      return new ErroAnalise('A chave do Gemini não tem permissão para usar este modelo.', { codigo: 'sem_permissao', status: 500, detalhes: mensagem, causa: e });
    }
    if (e.status === 404) {
      return new ErroAnalise(`O modelo "${modelo}" não existe ou não está disponível para esta chave (GEMINI_MODELO).`, { codigo: 'modelo_invalido', status: 500, causa: e });
    }
    if (e.status === 429) {
      return new ErroAnalise('Limite de uso do Gemini atingido (por minuto ou por dia, no plano gratuito). Tente novamente mais tarde.', { codigo: 'limite_taxa', status: 429, causa: e });
    }
    if (e.status >= 500) {
      return new ErroAnalise('O Gemini está instável ou sobrecarregado agora. Tente novamente em alguns minutos.', { codigo: 'ia_indisponivel', status: 502, causa: e });
    }
    return new ErroAnalise(`O Gemini respondeu com erro (${e.status}). Tente novamente.`, { codigo: 'erro_api', status: 502, causa: e });
  }
  if (e instanceof TypeError || e?.cause?.code) {
    return new ErroAnalise('Não foi possível conectar ao Gemini. Verifique a internet do servidor.', { codigo: 'sem_conexao', status: 502, causa: e });
  }
  return e;
}

const recusa = (mensagem, detalhes) => new ErroAnalise(mensagem, { codigo: 'recusa', status: 422, detalhes });

/**
 * @param {{ pdf?: Buffer, texto?: string, nomeArquivo?: string, contexto?: object }} entrada
 * @param {{ modelo?: string, pensamento?: string, maxTokens?: number, tentativas?: number,
 *   cliente?: GoogleGenAI, sinal?: AbortSignal }} [opcoes]
 */
export async function analisarComGemini(entrada, opcoes = {}) {
  const { pdf, texto, nomeArquivo, contexto } = entrada ?? {};
  const {
    modelo = config.gemini.modelo,
    pensamento = config.gemini.pensamento,
    maxTokens = config.gemini.maxTokens,
    tentativas = 3,
    cliente,
    sinal,
  } = opcoes;

  const documento = exigirDocumento({ pdf, texto }) === 'pdf'
    ? { inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } }
    // texto entre marcadores: deixa claro para o modelo o que é documento e o que é pedido
    : { text: `<documento nome="${String(nomeArquivo || 'edital.txt').replace(/["<>]/g, '')}">\n${texto}\n</documento>` };

  const nivel = NIVEIS[String(pensamento ?? '').toLowerCase()];
  let resposta;
  try {
    resposta = await (cliente ?? clienteGemini()).models.generateContent({
      model: modelo,
      contents: [{ role: 'user', parts: [documento, { text: montarPedido(contexto) }] }],
      config: {
        systemInstruction: INSTRUCOES_SISTEMA,
        responseMimeType: 'application/json',
        responseJsonSchema: ESQUEMA_JSON,
        maxOutputTokens: maxTokens,
        ...(nivel ? { thinkingConfig: { thinkingLevel: nivel } } : {}),
        ...(sinal ? { abortSignal: sinal } : {}),
        httpOptions: {
          timeout: 10 * 60_000,
          retryOptions: { attempts: tentativas, initialDelay: 2, maxDelay: 30 },
        },
      },
    });
  } catch (e) {
    throw traduzirErro(e, modelo);
  }

  const bloqueio = resposta.promptFeedback?.blockReason;
  if (bloqueio) {
    throw recusa('A IA não aceitou analisar este documento. Confira se o arquivo é mesmo um edital.', { motivo: bloqueio });
  }
  const candidato = resposta.candidates?.[0];
  const motivo = candidato?.finishReason;
  if (!candidato) throw recusa('A IA não devolveu resposta para este documento. Tente novamente.', null);
  if (motivo === 'MAX_TOKENS') {
    throw new ErroAnalise(
      'A análise ficou maior que o limite de resposta e foi interrompida. Tente enviar só o edital, sem os anexos.',
      { codigo: 'resposta_cortada', status: 422 },
    );
  }
  if (motivo === 'RECITATION') {
    throw recusa('A IA interrompeu a resposta por repetir trechos longos do documento. Tente novamente.', { motivo });
  }
  if (motivo && motivo !== 'STOP') {
    throw recusa('A IA não aceitou analisar este documento. Confira se o arquivo é mesmo um edital.', { motivo });
  }

  const analise = validarAnalise(resposta.text ?? '');
  const uso = resposta.usageMetadata ?? {};
  const modeloUsado = resposta.modelVersion || modelo;
  return {
    analise,
    provedor: 'gemini',
    modelo: modeloUsado,
    uso: {
      entrada: uso.promptTokenCount ?? 0,
      saida: (uso.candidatesTokenCount ?? 0) + (uso.thoughtsTokenCount ?? 0),
      cacheLeitura: uso.cachedContentTokenCount ?? 0,
      cacheEscrita: 0,
    },
    custoEstimadoUsd: estimarCustoGemini(uso, modeloUsado),
  };
}
