// WhatsApp do Uso LicitaHub pela API oficial da Meta (WhatsApp Cloud API).
//   - Suporte: quem manda mensagem para o número recebe na hora um menu de
//     assuntos e, ao escolher, a lista do que enviar para agilizar o atendimento.
//   - Alertas: envio de modelo aprovado pela Meta (o robô usa em worker/notificacoes.js).
//
// Variáveis (Render): WHATSAPP_TOKEN, WHATSAPP_TELEFONE_ID, WHATSAPP_SEGREDO_APP,
// WHATSAPP_VERIFICACAO e, opcional, WHATSAPP_MODELO_ALERTA / WHATSAPP_IDIOMA.
// Sem elas, tudo fica desligado. Passo a passo: docs/WHATSAPP.md.
// Nenhuma mensagem de cliente é gravada.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://graph.facebook.com/v21.0';

export function configWhatsapp(env = process.env) {
  const t = (k) => env[k]?.trim() || null;
  if (!t('WHATSAPP_TOKEN') || !t('WHATSAPP_TELEFONE_ID')) return null;
  return {
    token: t('WHATSAPP_TOKEN'), telefoneId: t('WHATSAPP_TELEFONE_ID'),
    segredoApp: t('WHATSAPP_SEGREDO_APP'), verificacao: t('WHATSAPP_VERIFICACAO'),
    modeloAlerta: t('WHATSAPP_MODELO_ALERTA') || 'alerta_robo', idioma: t('WHATSAPP_IDIOMA') || 'pt_BR',
  };
}

/** "(48) 99145-4256" -> "5548991454256". Null se não for celular brasileiro. */
export function numeroWhatsapp(telefone) {
  let d = String(telefone ?? '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  return /^[1-9]{2}9\d{8}$/.test(d) ? `55${d}` : null;
}

async function chamar(cfg, corpo, f = fetch) {
  const r = await f(`${API}/${cfg.telefoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`A Meta recusou a mensagem do WhatsApp (${r.status}).`);
}

/** Texto livre: só vale até 24 h depois da última mensagem do cliente. */
export const enviarTexto = (cfg, para, texto, f) => chamar(cfg, { to: para, type: 'text', text: { body: texto.slice(0, 4096), preview_url: false } }, f);

/** Modelo aprovado (pode ser enviado a qualquer hora). Parâmetros sem quebra de linha. */
export function enviarModelo(cfg, para, parametros, f) {
  const limpo = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 900) || '-';
  return chamar(cfg, {
    to: para, type: 'template',
    template: { name: cfg.modeloAlerta, language: { code: cfg.idioma }, components: [{ type: 'body', parameters: parametros.map((p) => ({ type: 'text', text: limpo(p) })) }] },
  }, f);
}

// --- Suporte: menu automático ---------------------------------------------------------
const PEDIR = (itens) => `Para agilizar, envie aqui:\n${itens.map((i) => `• ${i}`).join('\n')}`;
export const ASSUNTOS = [
  ['1', 'Proposta comercial e declarações', /propost|declara/i, ['o e-mail da sua conta', 'o número da proposta (ex.: PROP-2026-001)', 'o que você tentou fazer e o que apareceu', 'um print da tela, se puder']],
  ['2', 'Busca, radar e favoritos', /busca|radar|favorit|licita[cç][aã]o n[aã]o/i, ['o e-mail da sua conta', 'as palavras e os filtros usados', 'o link ou o nº de controle PNCP da licitação, se tiver']],
  ['3', 'Leitura de edital com IA', /edital|leitura|\bia\b/i, ['o e-mail da sua conta', 'o link ou o nº da licitação', 'o que a leitura mostrou de errado ou o que faltou']],
  ['4', 'Robô Turbo 2.0', /rob[oô]|lance|disputa|preg[aã]o/i, ['o e-mail da sua conta', 'o portal (ex.: Compras.gov.br, BLL)', 'o nº do pregão e do lote', 'o horário em que aconteceu e o que o robô mostrou']],
  ['5', 'Assinatura, pagamento e nota', /assinatura|pagamento|cobran|cart[aã]o|pix|nota fiscal|plano/i, ['o e-mail da conta que paga', 'a data e o valor da cobrança', 'a forma de pagamento (cartão, Pix ou boleto)', 'nunca envie o número completo do cartão']],
  ['6', 'Cancelamento', /cancel/i, ['o e-mail da conta', 'o motivo, se quiser contar (nos ajuda a melhorar)', 'lembre: em Meu Perfil você mesmo cancela a renovação, sem multa']],
  ['7', 'Erro ou travamento no sistema', /erro|trav|bug|n[aã]o (abre|carrega|funciona)|lento/i, ['o e-mail da sua conta', 'em qual tela aconteceu', 'a mensagem de erro (copie ou mande print)', 'se usa computador ou celular, e qual navegador']],
  ['8', 'Cadastro, login e senha', /login|senha|acesso|cadastro|entrar/i, ['o e-mail usado no cadastro', 'o que aparece ao tentar entrar', 'nunca envie a sua senha: para trocar, use "Esqueci a senha" na tela de entrada']],
  ['9', 'Sugestão de melhoria', /sugest|melhori|ideia/i, ['o que você gostaria que o sistema fizesse', 'em qual tela', 'como isso ajudaria no seu dia a dia']],
  ['10', 'Planos e contratação', /conhecer|contrat|planos|pre[cç]o|teste/i, ['o porte da sua empresa e o que vende ao governo', 'em quais estados participa', 'se já usa outra plataforma']],
];
const HUMANO = ['0', 'Falar com uma pessoa'];

/** Dia útil das 9h às 18h, no horário de Brasília. */
export function emHorario(data = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(data).map((x) => [x.type, x.value]));
  return !['Sat', 'Sun'].includes(p.weekday) && Number(p.hour) >= 9 && Number(p.hour) < 18;
}
const RODAPE = (agora) => `${emHorario(agora) ? 'Um atendente responde por aqui em instantes.' : 'Estamos fora do horário (seg. a sex., 9h às 18h). Deixe tudo por aqui que respondemos no próximo dia útil.'}\n\n🔒 Nunca pedimos senha nem código por WhatsApp.`;
const MENU = `Escolha o assunto respondendo só com o número:\n${[...ASSUNTOS.map(([n, t]) => `${n}. ${t}`), `${HUMANO[0]}. ${HUMANO[1]}`].join('\n')}`;

/** Assunto da mensagem: número do menu, "*Assunto:*" do site ou palavras do texto. */
export function assuntoDe(texto) {
  const t = String(texto ?? '').trim();
  const n = /^\s*(\d{1,2})\s*[.)-]?\s*$/.exec(t)?.[1];
  if (n === HUMANO[0]) return HUMANO;
  if (n) return ASSUNTOS.find((a) => a[0] === String(Number(n))) || null;
  const doSite = /assunto:\**\s*([^\n]+)/i.exec(t)?.[1];
  const alvo = doSite || t;
  return ASSUNTOS.find((a) => a[1].toLowerCase() === alvo.replace(/\*/g, '').trim().toLowerCase())
    || ASSUNTOS.find((a) => a[2].test(alvo)) || null;
}

/**
 * Resposta automática do suporte. Null = não responder (o atendente segue a conversa).
 * @param {{ primeira: boolean }} estado  primeira mensagem do contato nas últimas 12 h
 */
export function respostaSuporte(texto, { primeira, agora = new Date() }) {
  const a = assuntoDe(texto);
  const doSite = /assunto:/i.test(String(texto));
  const numero = /^\s*\d{1,2}\s*[.)-]?\s*$/.test(String(texto ?? ''));
  if (a === HUMANO) return `Certo! Vou chamar uma pessoa da equipe. Enquanto isso, conte em uma mensagem o que precisa e o e-mail da sua conta.\n\n${RODAPE(agora)}`;
  if (a && (numero || doSite || primeira)) {
    const [, titulo, , pedir] = a;
    const recebido = doSite ? `Recebemos a sua mensagem sobre *${titulo}*. Obrigado!` : `Assunto: *${titulo}*.`;
    return `${primeira ? 'Olá! 👋 Aqui é o suporte do *Uso LicitaHub*.\n' : ''}${recebido}\n\n${PEDIR(pedir)}\n\n${RODAPE(agora)}`;
  }
  if (numero) return `Não achei esse número. ${MENU}`;
  if (primeira) return `Olá! 👋 Aqui é o suporte do *Uso LicitaHub*. Para direcionar o seu atendimento, explique a sua dúvida com detalhes ou escolha um assunto.\n\n${MENU}\n\n${RODAPE(agora)}`;
  return null;
}

/** Assinatura X-Hub-Signature-256 da Meta (sem o segredo, nada é aceito). */
export function assinaturaValida(corpo, cabecalho, segredo) {
  if (!segredo || !cabecalho?.startsWith('sha256=')) return false;
  const a = Buffer.from(createHmac('sha256', segredo).update(corpo).digest('hex'));
  const b = Buffer.from(cabecalho.slice(7));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Rotas GET/POST /whatsapp/webhook (sem login: a Meta assina cada aviso). */
export function ligarWhatsapp(app, { cfg = configWhatsapp(), log = console, agora = () => new Date(), fetch: f = fetch } = {}) {
  const vistos = new Map(); // id da mensagem -> quando (a Meta pode reenviar)
  const contatos = new Map(); // número -> última mensagem (para a saudação, 12 h)
  const limpar = () => {
    const limite = agora().getTime() - 12 * 3600_000;
    for (const m of [vistos, contatos]) for (const [k, t] of m) if (t < limite) m.delete(k);
  };

  app.get('/whatsapp/webhook', (c) => {
    if (!cfg?.verificacao) return c.text('WhatsApp não configurado.', 503);
    const q = (k) => c.req.query(k);
    if (q('hub.mode') === 'subscribe' && q('hub.verify_token') === cfg.verificacao) return c.text(q('hub.challenge') || '');
    return c.text('Proibido.', 403);
  });

  app.post('/whatsapp/webhook', async (c) => {
    if (!cfg) return c.json({ erro: 'WhatsApp não configurado.' }, 503);
    const corpo = await c.req.text();
    if (corpo.length > 256 * 1024) return c.json({ erro: 'Aviso grande demais.' }, 413);
    if (!assinaturaValida(corpo, c.req.header('x-hub-signature-256'), cfg.segredoApp)) return c.json({ erro: 'Assinatura inválida.' }, 401);
    let dados;
    try { dados = JSON.parse(corpo); } catch { return c.json({ erro: 'JSON inválido.' }, 400); }
    limpar();
    const mensagens = (dados.entry || []).flatMap((e) => (e.changes || []).flatMap((ch) => ch.value?.messages || []));
    for (const m of mensagens) {
      if (!m?.id || !m.from || vistos.has(m.id)) continue;
      vistos.set(m.id, agora().getTime());
      const texto = m.type === 'text' ? m.text?.body : m.type === 'interactive' ? m.interactive?.button_reply?.title || m.interactive?.list_reply?.title : '';
      const primeira = !contatos.has(m.from);
      contatos.set(m.from, agora().getTime());
      const resposta = respostaSuporte(texto || '', { primeira, agora: agora() });
      if (resposta) enviarTexto(cfg, m.from, resposta, f).catch((e) => log.erro?.(`WhatsApp suporte: ${e.message}`));
    }
    return c.json({ recebido: true });
  });
}
