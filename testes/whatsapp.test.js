// WhatsApp: resposta automática do suporte, webhook da Meta, alertas do robô e botão do site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';
import { ASSUNTOS, assinaturaValida, assuntoDe, configWhatsapp, emHorario, ligarWhatsapp, numeroWhatsapp, respostaSuporte } from '../src/whatsapp.js';
import { criarNotificador } from '../worker/notificacoes.js';

const UTIL = new Date('2026-11-25T15:00:00Z'); // quarta, 12h em Brasília
const NOITE = new Date('2026-11-25T23:30:00Z'); // quarta, 20h30
const SABADO = new Date('2026-11-28T15:00:00Z');
const CFG = { token: 't', telefoneId: '123', segredoApp: 'segredo', verificacao: 'v', modeloAlerta: 'alerta_robo', idioma: 'pt_BR' };

// Botão do site carregado num navegador simulado.
function site() {
  const ctx = { document: { readyState: 'loading', addEventListener() {} }, location: { hash: '' } };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(new URL('../site/js/suporte.js', import.meta.url), 'utf8'), ctx);
  return ctx.LH.suporteWhatsapp;
}

test('número do celular no formato da Meta', () => {
  assert.equal(numeroWhatsapp('(48) 99145-4256'), '5548991454256');
  assert.equal(numeroWhatsapp('5548991454256'), '5548991454256');
  for (const t of ['(11) 3333-4444', '', null, '991454256']) assert.equal(numeroWhatsapp(t), null, String(t));
});

test('configuração: sem token fica desligado', () => {
  assert.equal(configWhatsapp({}), null);
  assert.equal(configWhatsapp({ WHATSAPP_TOKEN: 'x', WHATSAPP_TELEFONE_ID: '1' }).modeloAlerta, 'alerta_robo');
});

test('horário de atendimento em Brasília', () => {
  assert.ok(emHorario(UTIL));
  assert.ok(!emHorario(NOITE));
  assert.ok(!emHorario(SABADO));
});

test('primeira mensagem solta recebe saudação e menu', () => {
  const r = respostaSuporte('oi, boa tarde', { primeira: true, agora: UTIL });
  assert.match(r, /suporte do \*Uso LicitaHub\*/);
  assert.match(r, /1\. Proposta comercial/);
  assert.match(r, /0\. Falar com uma pessoa/);
  assert.match(r, /Nunca pedimos senha/);
  assert.equal(respostaSuporte('obrigado!', { primeira: false, agora: UTIL }), null, 'conversa em andamento: o atendente segue');
});

test('número do menu pede os detalhes do assunto', () => {
  const r = respostaSuporte('4', { primeira: false, agora: UTIL });
  assert.match(r, /Robô Turbo 2\.0/);
  assert.match(r, /nº do pregão/);
  assert.match(respostaSuporte('0', { primeira: false, agora: UTIL }), /chamar uma pessoa/);
  assert.match(respostaSuporte('42', { primeira: false, agora: UTIL }), /Não achei esse número/);
  assert.match(respostaSuporte('5', { primeira: false, agora: NOITE }), /fora do horário/);
});

test('mensagem pronta do site: cada assunto é reconhecido e pede o que falta', () => {
  const s = site();
  for (const [titulo, campos] of s.ASSUNTOS.filter(([t]) => t !== 'Outro assunto')) {
    const msg = s.mensagem(titulo, campos, { email: 'a@exemplo.invalid' });
    assert.equal(assuntoDe(msg)?.[1], titulo, titulo);
    assert.match(respostaSuporte(msg, { primeira: true, agora: UTIL }), new RegExp(`Recebemos a sua mensagem sobre \\*${titulo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*`));
  }
  assert.match(respostaSuporte(s.mensagem('Outro assunto', ['Minha dúvida']), { primeira: true, agora: UTIL }), /Escolha o assunto/);
  assert.equal(ASSUNTOS.length, s.ASSUNTOS.length - 1);
});

test('mensagem do site: só os dados da tela, sem senha nem ids', () => {
  const s = site();
  const m = s.mensagem('Robô Turbo 2.0', ['Portal'], { email: 'a@exemplo.invalid', plano: 'Max', tela: '#/robo' });
  assert.match(m, /\*Assunto:\* Robô Turbo 2\.0\n\*Conta:\* a@exemplo\.invalid\n\*Plano:\* Max\n\*Tela:\* #\/robo\n\n\*Portal:\* $/);
  assert.ok(!/Conta/.test(s.mensagem('X', [], {})), 'sem login, sem conta');
  assert.equal(new URL(s.link('Olá & tudo?')).searchParams.get('text'), 'Olá & tudo?');
});

test('assinatura da Meta', () => {
  const corpo = '{"a":1}';
  const ok = `sha256=${createHmac('sha256', 'segredo').update(corpo).digest('hex')}`;
  assert.ok(assinaturaValida(corpo, ok, 'segredo'));
  assert.ok(!assinaturaValida(corpo, ok, 'outro'));
  assert.ok(!assinaturaValida(`${corpo} `, ok, 'segredo'));
  assert.ok(!assinaturaValida(corpo, ok, null), 'sem segredo configurado, nada entra');
});

test('webhook: verifica, responde uma vez e recusa assinatura falsa', async () => {
  const enviados = [];
  const fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return { ok: true }; };
  const app = new Hono();
  ligarWhatsapp(app, { cfg: CFG, log: {}, agora: () => UTIL, fetch });
  const get = (q) => app.request(`/whatsapp/webhook?${new URLSearchParams(q)}`);
  assert.equal(await (await get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'v', 'hub.challenge': '99' })).text(), '99');
  assert.equal((await get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '99' })).status, 403);
  const aviso = (id, texto) => JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id, from: '5511987654321', type: 'text', text: { body: texto } }] } }] }] });
  const post = (corpo, segredo = 'segredo') => app.request('/whatsapp/webhook', { method: 'POST', body: corpo, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}` } });
  assert.equal((await post(aviso('m1', 'oi'), 'falso')).status, 401);
  assert.equal((await post(aviso('m1', 'oi'))).status, 200);
  await post(aviso('m1', 'oi')); // reenvio da Meta: não responde de novo
  await post(aviso('m2', '3'));
  await post(aviso('m3', 'valeu'));
  await new Promise((r) => { setTimeout(r, 10); });
  assert.equal(enviados.length, 2);
  assert.equal(enviados[0].to, '5511987654321');
  assert.match(enviados[0].text.body, /Escolha o assunto/);
  assert.match(enviados[1].text.body, /Leitura de edital/);
});

test('alerta do robô por WhatsApp: só urgente, com intervalo, e um canal não derruba o outro', async () => {
  let t = 0;
  const pedidos = [];
  const fetch = async (url, o) => { pedidos.push([url.includes('graph.facebook') ? 'zap' : 'email', JSON.parse(o.body)]); return url.includes('resend') ? { ok: false, status: 500 } : { ok: true }; };
  const canais = { email: { chave: 'k', remetente: 'r@x' }, whatsapp: CFG, site: 'https://s' };
  const n = criarNotificador({ email: 'a@b.com', alertaEmail: true, alertaWhatsapp: true, telefone: '(48) 99145-4256' }, canais, { fetch, agora: () => t, log: { erro() {} } });
  await n({ motivo: 'primeira', pregao: '90012/2026', lote: '1', texto: 'Chance de 60%.\nFechamento previsto R$ 10,00' });
  const zap = pedidos.filter((p) => p[0] === 'zap');
  assert.equal(zap.length, 1, 'e-mail falhou e o WhatsApp saiu');
  assert.equal(zap[0][1].to, '5548991454256');
  assert.deepEqual(zap[0][1].template.components[0].parameters.map((p) => p.text), ['90012/2026, lote 1', 'Chance de 60%. Fechamento previsto R$ 10,00', 'https://s/app.html#/robo']);
  t = 60_000; await n({ motivo: 'virou_favoravel', pregao: 'p', texto: 'x' });
  t = 120_000; await n({ motivo: 'atualizacao', pregao: 'p', texto: 'x' });
  t = 400_000; await n({ motivo: 'sem_chance', pregao: 'p', texto: 'x' });
  assert.equal(pedidos.filter((p) => p[0] === 'zap').length, 2, 'intervalo de 5 min e só urgente');
  assert.equal(criarNotificador({ alertaWhatsapp: true, telefone: '(11) 3333-4444' }, canais, { log: {} }), null, 'fixo não recebe');
  assert.equal(criarNotificador({ alertaWhatsapp: true, telefone: '(48) 99145-4256' }, { site: 's' }, { log: {} }), null, 'sem Meta configurada');
});
