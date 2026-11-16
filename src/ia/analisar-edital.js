// Leitura de edital por IA. Escolhe o provedor pelo .env:
//   IA_PROVEDOR=gemini  (padrão; Google, tem plano gratuito)
//   IA_PROVEDOR=claude  (Anthropic, pago por uso)
// Os dois devolvem exatamente o mesmo formato (src/ia/esquema-analise.js).
import { config } from '../config.js';
import { AVISO_LEGAL } from './comum.js';
import { ErroAnalise } from './erros.js';
import { analisarComClaude } from './provedores/claude.js';
import { analisarComGemini } from './provedores/gemini.js';

export { AVISO_LEGAL, ErroAnalise };

const PROVEDORES = {
  gemini: {
    nome: 'Gemini (Google)',
    analisar: analisarComGemini,
    modelo: () => config.gemini.modelo,
    temChave: () => Boolean(config.gemini.chave),
    variavelChave: 'GEMINI_API_KEY',
  },
  claude: {
    nome: 'Claude (Anthropic)',
    analisar: analisarComClaude,
    modelo: () => config.claude.modelo,
    temChave: () => Boolean(process.env.ANTHROPIC_API_KEY),
    variavelChave: 'ANTHROPIC_API_KEY',
  },
};

function obterProvedor(id) {
  const provedor = PROVEDORES[String(id ?? '').toLowerCase()];
  if (!provedor) {
    throw new ErroAnalise(`IA_PROVEDOR inválido: "${id}". Use "gemini" ou "claude".`, { codigo: 'provedor_invalido', status: 500 });
  }
  return provedor;
}

/** Informações do provedor em uso (para telas e avisos). */
export function provedorDaIa(id = config.ia.provedor) {
  const p = obterProvedor(id);
  return {
    id: String(id).toLowerCase(),
    nome: p.nome,
    modelo: p.modelo(),
    chaveConfigurada: p.temChave(),
    variavelChave: p.variavelChave,
  };
}

/**
 * Analisa um edital e devolve { analise, provedor, modelo, uso, custoEstimadoUsd }.
 * @param {{ pdf?: Buffer, texto?: string, nomeArquivo?: string, contexto?: object }} entrada
 * @param {{ provedor?: string, modelo?: string, esforco?: string, pensamento?: string,
 *   sinal?: AbortSignal, cliente?: any }} [opcoes]
 */
export async function analisarEdital(entrada, opcoes = {}) {
  const { provedor = config.ia.provedor, ...resto } = opcoes;
  return obterProvedor(provedor).analisar(entrada, resto);
}
