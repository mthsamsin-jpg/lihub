// HTTP resiliente para coletores de fontes que NÃO são o PNCP (Diários Oficiais,
// portais de prefeituras). O PNCP usa o próprio cliente (src/pncp/cliente.js), que
// já tem o ritmo global medido para aquela API.
//
// Cada fonte ganha um "ritmo" próprio:
//   - intervalo mínimo entre pedidos (não sobrecarrega o site nem bloqueia o IP);
//   - tempo limite por pedido;
//   - novas tentativas com espera exponencial + variação aleatória em 5xx, 408, 429 e falhas de rede;
//   - respeita o cabeçalho Retry-After.
import { esperar } from '../../util.js';

const AGENTE = 'UsoLicitaHub-Coletor/1.0 (+https://usolicitahub.com.br)';
const REPETIR = new Set([408, 425, 429, 500, 502, 503, 504]);

export class ErroHttp extends Error {
  constructor(mensagem, { status = null, url = null } = {}) {
    super(mensagem);
    this.name = 'ErroHttp';
    this.status = status;
    this.url = url;
  }
}

/** Espera da tentativa n (1, 2, 3...): base * 2^(n-1), com teto e variação de até 25%. */
export function esperaExponencial(n, { baseMs = 1_000, tetoMs = 60_000, aleatorio = Math.random } = {}) {
  const bruto = Math.min(baseMs * 2 ** (n - 1), tetoMs);
  return Math.round(bruto + bruto * 0.25 * aleatorio());
}

/**
 * Cria um requisitador com ritmo próprio.
 * @param {{ intervaloMs?: number, timeoutMs?: number, tentativas?: number, baseEsperaMs?: number,
 *   fetch?: typeof fetch, log?: any }} [opcoes]
 */
export function criarRequisitador({
  intervaloMs = 1_000, timeoutMs = 60_000, tentativas = 4, baseEsperaMs = 1_000, fetch: f = fetch, log = null,
} = {}) {
  let proximaEm = 0;

  async function vez(sinal) {
    const agora = Date.now();
    const espera = Math.max(0, proximaEm - agora);
    proximaEm = Math.max(agora, proximaEm) + intervaloMs;
    if (espera) await esperar(espera, sinal);
  }

  /**
   * @param {string} url
   * @param {{ sinal?: AbortSignal, formato?: 'json'|'texto', headers?: object }} [o]
   */
  async function requisitar(url, { sinal, formato = 'json', headers = {} } = {}) {
    for (let n = 1; ; n++) {
      await vez(sinal);
      let resposta;
      let erro;
      try {
        resposta = await f(url, {
          headers: { 'User-Agent': AGENTE, Accept: formato === 'json' ? 'application/json' : '*/*', ...headers },
          signal: sinal ? AbortSignal.any([sinal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
        if (resposta.status === 204) return null;
        if (resposta.ok) return formato === 'json' ? await resposta.json() : await resposta.text();
        erro = new ErroHttp(`HTTP ${resposta.status}`, { status: resposta.status, url });
        await resposta.body?.cancel().catch(() => {});
      } catch (e) {
        if (sinal?.aborted) throw sinal.reason;
        erro = e instanceof ErroHttp ? e : new ErroHttp(e?.name === 'TimeoutError' ? `sem resposta em ${timeoutMs / 1000} s` : e.message, { url });
      }
      const repetivel = erro.status === null || REPETIR.has(erro.status);
      if (!repetivel || n >= tentativas) throw erro;
      const pedida = Number(resposta?.headers?.get('retry-after')) * 1000;
      const espera = Number.isFinite(pedida) && pedida > 0 ? Math.min(pedida, 120_000) : esperaExponencial(n, { baseMs: baseEsperaMs });
      log?.aviso?.('http.tentar_de_novo', { url, tentativa: n, erro: erro.message, esperaMs: espera });
      await esperar(espera, sinal);
    }
  }
  return requisitar;
}
