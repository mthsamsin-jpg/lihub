// Envio dos alertas preditivos para um webhook (Slack, Discord, Teams, n8n, Zapier...).
// O corpo leva "text" (Slack/Teams/n8n) e "content" (Discord) com a mesma frase,
// mais os números em campos separados para quem quiser automatizar.

const BLOQUEADOS = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const IP_PRIVADO = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

/** Só https, sem IP direto e sem nomes internos (o servidor não pode virar ponte para a rede interna). */
export function validarWebhook(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return 'Endereço inválido.'; }
  if (u.protocol !== 'https:') return 'O webhook precisa começar com https://.';
  if (u.username || u.password) return 'Não use usuário e senha no endereço.';
  const host = u.hostname;
  if (BLOQUEADOS.test(host) || IP_PRIVADO.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return 'Use o endereço público do serviço (não um IP nem um nome interno).';
  if (u.toString().length > 500) return 'Endereço longo demais.';
  return null;
}

export async function enviarWebhook(url, dados, { fetch: f = fetch, timeoutMs = 5000 } = {}) {
  const erro = validarWebhook(url);
  if (erro) throw new Error(erro);
  const r = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'UsoLicitaHub-RoboTurbo/2.0' },
    body: JSON.stringify({ text: dados.texto, content: dados.texto?.slice(0, 1900), ...dados }),
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`O webhook respondeu ${r.status}.`);
}
