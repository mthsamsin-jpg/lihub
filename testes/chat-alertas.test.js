// Chat Unificado, Fase 2: alertas por webhook, Telegram e WhatsApp; vínculo do Telegram.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canaisDoAmbiente, criarAlertador, enviarWhatsapp, vincularTelegram } from '../src/chat/alertas.js';

const M = { id: 1, portal: 'bll', compra_ref: '123/2026', autor: 'Pregoeiro', texto: 'Empresa X, anexe o catálogo em 30 minutos.', gatilhos: ['mencao_nome', 'anexo', 'prazo'] };

test('canais do ambiente: cada canal só liga com a chave dele', () => {
  assert.deepEqual(canaisDoAmbiente({}), { telegramToken: null, telegramNome: null, whatsapp: null });
  const c = canaisDoAmbiente({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_NOME: 'robo', WHATSAPP_TOKEN: 'w', WHATSAPP_NUMERO_ID: '9' });
  assert.equal(c.whatsapp.modelo, 'alerta_pregao');
  assert.equal(c.whatsapp.idioma, 'pt_BR');
});

test('alertador: manda para webhook, cada Telegram e cada WhatsApp; falha de um não para os outros', async () => {
  const chamadas = [];
  const f = async (url, o) => {
    chamadas.push([url, JSON.parse(o.body)]);
    return url.includes('falha') ? { ok: false, status: 500 } : { ok: true, json: async () => ({}) };
  };
  const alertar = criarAlertador({ telegramToken: 'TK', whatsapp: { token: 'W', numeroId: '77', modelo: 'alerta_pregao', idioma: 'pt_BR' } }, { fetch: f, log: {} });
  const ok = await alertar({ webhook: 'https://falha.exemplo/x', telegram: [{ id: 10 }, { id: 11 }], whatsapp: ['5511912345678'] }, M);
  assert.equal(ok, 3, 'webhook falhou; 2 Telegram + 1 WhatsApp deram certo');
  assert.ok(chamadas.some(([u, b]) => u.endsWith('/botTK/sendMessage') && b.chat_id === 11 && b.text.includes('pregão 123/2026')));
  const wpp = chamadas.find(([u]) => u.includes('graph.facebook.com'));
  assert.equal(wpp[1].to, '5511912345678');
  assert.equal(wpp[1].template.name, 'alerta_pregao');
});

test('WhatsApp: modelo com motivo, pregão e trecho', async () => {
  let corpo;
  await enviarWhatsapp({ token: 'W', numeroId: '1', modelo: 'm', idioma: 'pt_BR' }, '+55 (11) 91234-5678', M, {
    fetch: async (u, o) => { corpo = JSON.parse(o.body); assert.equal(o.headers.authorization, 'Bearer W'); return { ok: true, json: async () => ({}) }; },
  });
  const p = corpo.template.components[0].parameters.map((x) => x.text);
  assert.equal(corpo.to, '5511912345678');
  assert.match(p[0], /citaram a sua empresa, pedido de anexo, prazo/);
  assert.equal(p[1], 'BLL 123/2026');
  assert.match(p[2], /^Pregoeiro: Empresa X/);
});

test('Telegram: vincula o código válido, recusa o vencido e avança o offset', async () => {
  const enviados = [];
  const atualizados = [];
  const linhas = {
    BOM12345: { organizacao_id: 'o1', telegram_chats: [], telegram_codigo_ate: '2026-11-19T10:30:00Z' },
    VELHO123: { organizacao_id: 'o2', telegram_chats: [], telegram_codigo_ate: '2026-11-19T09:00:00Z' },
  };
  const supabase = {
    from: () => {
      let codigo;
      const q = {
        select: () => q,
        eq: (c, v) => { if (c === 'telegram_codigo') codigo = v; return q; },
        maybeSingle: async () => ({ data: linhas[codigo] || null }),
        update: (campos) => ({ eq: async (c, v) => { atualizados.push([v, campos]); return {}; } }),
      };
      return q;
    },
  };
  const f = async (url, o) => {
    if (url.includes('getUpdates')) {
      return { ok: true, json: async () => ({ result: [
        { update_id: 5, message: { text: '/start BOM12345', chat: { id: 99, first_name: 'Maria' } } },
        { update_id: 6, message: { text: '/start VELHO123', chat: { id: 98 } } },
        { update_id: 7, message: { text: 'oi', chat: { id: 97 } } },
      ] }) };
    }
    enviados.push(JSON.parse(o.body));
    return { ok: true, json: async () => ({}) };
  };
  const proximo = await vincularTelegram({ token: 'TK', supabase, fetch: f, log: {}, agora: Date.parse('2026-11-19T10:00:00Z') });
  assert.equal(proximo, 8);
  assert.deepEqual(atualizados, [['o1', { telegram_chats: [{ id: 99, nome: 'Maria' }], telegram_codigo: null, telegram_codigo_ate: null }]]);
  assert.ok(enviados.some((e) => e.chat_id === 99 && /Pronto/.test(e.text)));
  assert.ok(enviados.some((e) => e.chat_id === 98 && /vencido/.test(e.text)));
});
