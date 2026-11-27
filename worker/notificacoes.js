// Alertas do Robô Turbo 2.0 por e-mail, para a pessoa que conectou o robô ao pregão
// e pediu para receber (perfis.alerta_email). Envio pelo Resend (RESEND_API_KEY),
// remetente EMAIL_REMETENTE do domínio do site.
// (O WhatsApp fica para quando houver um número empresarial na API oficial da Meta.)

const escaparHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** E-mail do alerta (texto + HTML simples, no padrão dos outros e-mails do site). */
export function montarEmail(alerta, { site = 'https://usolicitahub.com.br' } = {}) {
  const assunto = alerta.probabilidadeVitoria != null
    ? `Robô Turbo 2.0 · ${alerta.probabilidadeVitoria.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de chance · pregão ${alerta.pregao}`
    : `Robô Turbo 2.0 · pregão ${alerta.pregao}`;
  const texto = `${alerta.texto}\n\nAcompanhe ao vivo: ${site}/app.html#/robo\n\nVocê recebe este alerta porque ligou os alertas do Robô Turbo 2.0 no seu perfil.`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px 12px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb"><tr><td style="padding:24px 26px">
<p style="margin:0 0 4px;font-size:13px;color:#0284c7;font-weight:bold">Uso LicitaHub · Robô Turbo 2.0</p>
<h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;color:#111827">Pregão ${escaparHtml(alerta.pregao)}${alerta.lote ? `, lote ${escaparHtml(alerta.lote)}` : ''}</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6">${escaparHtml(alerta.texto)}</p>
<a href="${site}/app.html#/robo" style="display:inline-block;padding:11px 20px;background:#0284c7;color:#fff;border-radius:8px;font-weight:bold;text-decoration:none">Acompanhar ao vivo</a>
<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#6b7280">Estimativa estatística, não é garantia de resultado. Você recebe este alerta porque ligou os alertas do Robô Turbo 2.0 no seu perfil.</p>
</td></tr></table></body></html>`;
  return { assunto, texto, html };
}

export async function enviarEmail({ para, assunto, texto, html }, { chave, remetente, fetch: f = fetch }) {
  const r = await f('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `Uso LicitaHub <${remetente}>`, to: [para], subject: assunto, text: texto, html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`O Resend recusou o e-mail (${r.status}).`);
}

/** Lê a configuração do ambiente. email = null se o servidor não tiver a chave do Resend. */
export function canaisDoAmbiente(env = process.env) {
  const t = (k) => env[k]?.trim() || null;
  const email = t('RESEND_API_KEY') ? { chave: t('RESEND_API_KEY'), remetente: t('EMAIL_REMETENTE') || 'nao-responda@usolicitahub.com.br' } : null;
  return { email, site: t('SITE_URL') || 'https://usolicitahub.com.br' };
}

/**
 * Notificador de UMA sessão. Mudanças urgentes (chance virou a favor/contra, sem
 * chance, primeira previsão) vão na hora; as demais respeitam um intervalo mínimo
 * (padrão 60 s), para não lotar a caixa de entrada.
 *
 * @param {{ email?: string|null, alertaEmail?: boolean }} destino
 * @param {ReturnType<typeof canaisDoAmbiente>} canais
 * @returns {null | ((alerta: object) => Promise<void>)}
 */
export function criarNotificador(destino, canais, { log = console, agora = () => Date.now(), intervaloEmailMs = 60_000, fetch: f = fetch } = {}) {
  if (destino?.alertaEmail && destino.email && !canais?.email) log.aviso?.('Alerta por e-mail ligado, mas o servidor não tem RESEND_API_KEY.');
  if (!(destino?.alertaEmail && destino.email && canais?.email)) return null;
  let ultimoEmail = -Infinity;
  return async (alerta) => {
    const urgente = ['sem_chance', 'virou_favoravel', 'virou_desfavoravel', 'primeira'].includes(alerta.motivo);
    if (!urgente && agora() - ultimoEmail < intervaloEmailMs) return;
    ultimoEmail = agora();
    try {
      await enviarEmail({ para: destino.email, ...montarEmail(alerta, { site: canais.site }) }, { ...canais.email, fetch: f });
    } catch (e) { log.erro?.(`Alerta por e-mail: ${e.message}`); }
  };
}
