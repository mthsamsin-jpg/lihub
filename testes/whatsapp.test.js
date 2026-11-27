// Botão de suporte no WhatsApp: mensagens prontas por assunto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function site() {
  const ctx = { document: { readyState: 'loading', addEventListener() {} }, location: { hash: '' } };
  ctx.window = ctx;
  ctx.LH = { SUPORTE: { whatsappNumero: "5548991454256" } };
  vm.runInNewContext(readFileSync(new URL('../site/js/suporte.js', import.meta.url), 'utf8'), ctx);
  return ctx.LH.suporteWhatsapp;
}

test('cada assunto gera uma mensagem com o título', () => {
  const s = site();
  assert.equal(s.ASSUNTOS.length, 11);
  for (const [titulo, campos] of s.ASSUNTOS) assert.ok(s.mensagem(titulo, campos, {}).includes(`*Assunto:* ${titulo}
`), titulo);
});

test('mensagem do site: só os dados da tela, sem senha nem ids', () => {
  const s = site();
  const m = s.mensagem('Robô Turbo 2.0', ['Portal'], { email: 'a@exemplo.invalid', plano: 'Max', tela: '#/robo' });
  assert.match(m, /\*Assunto:\* Robô Turbo 2\.0\n\*Conta:\* a@exemplo\.invalid\n\*Plano:\* Max\n\*Tela:\* #\/robo\n\n\*Portal:\* $/);
  assert.ok(!/Conta/.test(s.mensagem('X', [], {})), 'sem login, sem conta');
  const link = s.link('Olá & tudo?');
  assert.ok(link.startsWith('https://wa.me/5548991454256?'));
  assert.equal(new URL(link).searchParams.get('text'), 'Olá & tudo?');
});
