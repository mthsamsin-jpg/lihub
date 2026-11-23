import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { middlewareDePlano, nivelDaOrganizacao, nivelDoUsuario, nivelExigido, permite } from '../src/pagamentos/acesso.js';

test('nível pelo plano; organização isenta tem acesso total', () => {
  assert.equal(nivelDaOrganizacao({ plano: 'gratuito' }), 'free');
  assert.equal(nivelDaOrganizacao({ plano: 'starter' }), 'pro');
  assert.equal(nivelDaOrganizacao({ plano: 'max' }), 'max');
  assert.equal(nivelDaOrganizacao({ plano: 'gratuito', isento: true }), 'max');
  assert.equal(nivelDoUsuario([{ plano: 'gratuito' }, { plano: 'starter' }]), 'pro');
  assert.equal(nivelDoUsuario([]), 'free');
});

test('rotas: Prospecção exige Pro; Robô e credenciais exigem a janela do robô (Max)', () => {
  assert.equal(nivelExigido('/api/licitacoes/1/arquivos'), 'pro');
  assert.equal(nivelExigido('/api/pncp/busca'), 'pro');
  assert.equal(nivelExigido('/api/robo/sessoes'), 'robo');
  assert.equal(nivelExigido('/api/portais/credenciais'), 'robo');
  assert.equal(nivelExigido('/api/editais/analisar'), null);
  assert.ok(permite('max', 'pro') && !permite('pro', 'max') && !permite('free', 'pro'));
});

test('middleware: 402 com plano insuficiente, passa com plano certo ou isenção', async () => {
  // robo: janela do robô aberta (Max dentro dos dias do ciclo, ou isenta)
  const montar = (nivel, robo = nivel === 'max') => {
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('db', { nivelDeAcesso: async () => nivel, roboLiberado: async () => robo }); await next(); });
    app.use('/api/*', middlewareDePlano());
    app.get('/api/*', (c) => c.json({ ok: true }));
    return app;
  };
  const r1 = await montar('free').request('/api/licitacoes/1/itens');
  assert.equal(r1.status, 402);
  assert.equal((await r1.json()).exigido, 'pro');
  assert.equal((await montar('pro').request('/api/robo/sessoes')).status, 402);
  assert.equal((await montar('pro').request('/api/pncp/busca')).status, 200);
  assert.equal((await montar('max').request('/api/robo/sessoes')).status, 200); // isenta também chega como max
  // Max com a janela do robô encerrada: robô recusado, plataforma liberada
  const r2 = await montar('max', false).request('/api/robo/sessoes');
  assert.equal(r2.status, 402);
  assert.equal((await r2.json()).codigo, 'robo_janela_encerrada');
  assert.equal((await montar('max', false).request('/api/portais/credenciais')).status, 402);
  assert.equal((await montar('max', false).request('/api/pncp/busca')).status, 200);
  assert.equal((await (await montar('pro').request('/api/robo/sessoes')).json()).codigo, 'plano_insuficiente');
  assert.equal((await montar('free').request('/api/editais/analises/1')).status, 200);
});
