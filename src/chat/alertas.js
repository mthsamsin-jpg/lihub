// Alertas do chat unificado: webhook (Discord/Slack/JSON), Telegram (Bot API
// oficial) e WhatsApp (Cloud API oficial da Meta). Cada canal só funciona se o
// servidor tiver a chave dele; sem chave, o canal é ignorado em silêncio.
//
//   TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_NOME          robô criado no @BotFather
//   WHATSAPP_TOKEN, WHATSAPP_NUMERO_ID             número empresarial na Meta
//   WHATSAPP_MODELO (padrão alerta_pregao), WHATSAPP_IDIOMA (padrão pt_BR)
//     O WhatsApp só deixa a EMPRESA iniciar conversa com um modelo aprovado
//     pela Meta. Modelo sugerido (categoria "Utility"), com 3 variáveis:
//     "Uso LicitaHub: {{1}} no pregão {{2}}. {{3}}"
import { enviarWebhook, PORTAIS, textoDoAlerta } from './caixa.js';

const TELEGRAM = 'https://api.telegram.org';
const GRAPH = 'https://graph.facebook.com/v21.0';

const ROTULOS = {
  mencao_cnpj: 'citaram o seu CNPJ', mencao_nome: 'citaram a sua empresa', convocacao: 'convocação', anexo: 'pedido de anexo',
  prazo: 'prazo', suspensao: 'suspensão/reabertura', resultado: 'resultado', palavra: 'palavra de alerta',
};

/** Configuração dos canais a partir das variáveis de ambiente. */
export const canaisDoAmbiente = (env = process.env) => ({
  telegramToken: env.TELEGRAM_BOT_TOKEN || null,
  telegramNome: env.TELEGRAM_BOT_NOME || null,
  whatsapp: env.WHATSAPP_TOKEN && env.WHATSAPP_NUMERO_ID
    ? { token: env.WHATSAPP_TOKEN, numeroId: env.WHATSAPP_NUMERO_ID, modelo: env.WHATSAPP_MODELO || 'alerta_pregao', idioma: env.WHATSAPP_IDIOMA || 'pt_BR' }
    : null,
});

async function postar(f, url, corpo, headers = {}) {
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`respondeu ${r.status}`);
  return r.json().catch(() => ({}));
}

export function enviarTelegram(token, chatId, texto, { fetch: f = fetch } = {}) {
  return postar(f, `${TELEGRAM}/bot${token}/sendMessage`, { chat_id: chatId, text: texto.slice(0, 4000), disable_web_page_preview: true });
}

/** Mensagem de modelo do WhatsApp com as 3 variáveis (motivo, pregão, trecho da mensagem). */
export function enviarWhatsapp(cfg, numero, m, { fetch: f = fetch } = {}) {
  const motivo = (m.gatilhos || []).map((g) => ROTULOS[g]).filter(Boolean).join(', ') || 'mensagem do pregoeiro';
  const pregao = `${PORTAIS[m.portal] || m.portal} ${m.compra_ref}`;
  const trecho = `${m.autor || 'Pregoeiro'}: ${String(m.texto).replace(/\s+/g, ' ')}`.slice(0, 900);
  return postar(f, `${GRAPH}/${cfg.numeroId}/messages`, {
    messaging_product: 'whatsapp', to: String(numero).replace(/\D/g, ''), type: 'template',
    template: {
      name: cfg.modelo, language: { code: cfg.idioma },
      components: [{ type: 'body', parameters: [motivo, pregao, trecho].map((text) => ({ type: 'text', text })) }],
    },
  }, { authorization: `Bearer ${cfg.token}` });
}

/**
 * Alertador: manda uma mensagem relevante para todos os canais da organização.
 * Devolve quantos envios deram certo; falha de um canal não impede os outros.
 */
export function criarAlertador(canais = canaisDoAmbiente(), { fetch: f = fetch, log = console } = {}) {
  return async function alertar(perfil, m) {
    const tarefas = [];
    if (perfil.webhook) tarefas.push(['webhook', () => enviarWebhook(perfil.webhook, m, { fetch: f })]);
    if (canais.telegramToken) {
      for (const c of perfil.telegram || []) tarefas.push(['telegram', () => enviarTelegram(canais.telegramToken, c.id, textoDoAlerta(m), { fetch: f })]);
    }
    if (canais.whatsapp) {
      for (const n of perfil.whatsapp || []) tarefas.push(['whatsapp', () => enviarWhatsapp(canais.whatsapp, n, m, { fetch: f })]);
    }
    let ok = 0;
    for (const [canal, tarefa] of tarefas) {
      try { await tarefa(); ok += 1; } catch (e) { log.aviso?.(`Alerta ${canal} não enviado: ${e.message}`); }
    }
    return ok;
  };
}

// --- Vínculo do Telegram ------------------------------------------------------
// A tela gera um código e mostra o link t.me/<robô>?start=<código>. A pessoa
// abre o link e toca em "Iniciar"; o servidor lê as mensagens novas do robô
// (getUpdates, sem precisar de endereço público), acha o código e guarda o chat.

/** Lê as mensagens novas do robô e vincula os códigos. Devolve o próximo offset. */
export async function vincularTelegram({ token, supabase, offset = 0, fetch: f = fetch, log = console, agora = Date.now() }) {
  const r = await f(`${TELEGRAM}/bot${token}/getUpdates?timeout=0&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Telegram respondeu ${r.status}`);
  const { result = [] } = await r.json();
  let proximo = offset;
  for (const u of result) {
    proximo = Math.max(proximo, u.update_id + 1);
    const msg = u.message;
    const codigo = /^\/start\s+([A-Za-z0-9]{8,32})$/.exec(String(msg?.text || '').trim())?.[1];
    if (!codigo || !msg?.chat?.id) continue;
    const { data: mon } = await supabase.from('monitoramentos').select('organizacao_id, telegram_chats, telegram_codigo_ate')
      .eq('telegram_codigo', codigo).maybeSingle();
    const valido = mon && (!mon.telegram_codigo_ate || new Date(mon.telegram_codigo_ate).getTime() > agora);
    if (!valido) {
      await enviarTelegram(token, msg.chat.id, 'Código inválido ou vencido. Gere um novo link na tela Monitoramento de Chat do Uso LicitaHub.', { fetch: f }).catch(() => {});
      continue;
    }
    const nome = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.title || msg.chat.username || 'Telegram';
    const chats = [...(mon.telegram_chats || []).filter((c) => c.id !== msg.chat.id), { id: msg.chat.id, nome }].slice(-5);
    await supabase.from('monitoramentos').update({ telegram_chats: chats, telegram_codigo: null, telegram_codigo_ate: null })
      .eq('organizacao_id', mon.organizacao_id);
    await enviarTelegram(token, msg.chat.id, '✅ Pronto! Os alertas do chat dos pregões do Uso LicitaHub vão chegar aqui.', { fetch: f }).catch(() => {});
    log.info?.(`Telegram vinculado à organização ${mon.organizacao_id}.`);
  }
  return proximo;
}
