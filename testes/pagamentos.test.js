// Assinaturas pelo Mercado Pago (src/pagamentos/mercadopago.js), sem rede: o
// fetch do Mercado Pago é trocado por um falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assinaturaValida, criarPagamentos, lerReferencia, novoFim, referencia } from '../src/pagamentos/mercadopago.js';
import { nivelDaOrganizacao } from '../src/pagamentos/acesso.js';

const ORG = '11111111-2222-3333-4444-555555555555';

function montar(respostas = {}) {
  const pedidos = [];
  const banco = { assinatura: null, plano: null };
  const repositorio = {
    organizacaoExiste: async (id) => id === ORG,
    assinatura: async () => banco.assinatura,
    salvarAssinatura: async (_, campos) => { banco.assinatura = { ...banco.assinatura, ...campos }; },
    aplicarPlano: async (_, plano, limites, ate) => { banco.plano = { plano, limites, ate }; },
  };
  const fetch = async (url, op) => {
    pedidos.push({ url, metodo: op.method, corpo: op.body ? JSON.parse(op.body) : null });
    const caminho = url.replace('https://api.mercadopago.com', '');
    const r = respostas[caminho];
    return { ok: r !== undefined, status: r === undefined ? 404 : 200, json: async () => r ?? {} };
  };
  const pag = criarPagamentos({ token: 'TEST-123', urlSite: 'https://site.test', repositorio, fetch });
  return { pag, pedidos, banco };
}

test('referência e datas', () => {
  assert.deepEqual(lerReferencia(referencia(ORG, 'max', 'avulso')), { organizacaoId: ORG, plano: 'max', forma: 'avulso' });
  assert.equal(lerReferencia(`${ORG}|gratuito|avulso`), null);
  assert.equal(lerReferencia('qualquer|coisa'), null);
  const agora = new Date('2026-11-18T00:00:00Z');
  assert.equal(novoFim(null, agora), '2026-12-18T00:00:00.000Z');
  assert.equal(novoFim('2026-11-28T00:00:00Z', agora), '2026-12-28T00:00:00.000Z'); // soma ao que ainda vale
  assert.equal(novoFim('2026-11-01T00:00:00Z', agora), '2026-12-18T00:00:00.000Z'); // vencido: conta de agora
});

test('checkout avulso: Pix, crédito e débito (sem boleto), valor do plano e aviso de volta', async () => {
  const { pag, pedidos } = montar({ '/checkout/preferences': { id: 'pref1', init_point: 'https://mp/checkout' } });
  const r = await pag.criarCheckout({ organizacao: { id: ORG }, usuario: { email: 'a@b.c' }, plano: 'max', forma: 'avulso' });
  assert.equal(r.url, 'https://mp/checkout');
  const corpo = pedidos[0].corpo;
  assert.equal(corpo.items[0].unit_price, 197);
  assert.equal(corpo.external_reference, `${ORG}|max|avulso`);
  assert.deepEqual(corpo.payment_methods.excluded_payment_types.map((t) => t.id).sort(), ['atm', 'ticket']);
  assert.equal(corpo.notification_url, 'https://site.test/mercadopago/webhook');
});

test('checkout recorrente: assinatura mensal no crédito; conta isenta nunca é cobrada', async () => {
  const { pag, pedidos } = montar({ '/preapproval': { id: 'sub1', init_point: 'https://mp/sub' } });
  const r = await pag.criarCheckout({ organizacao: { id: ORG }, usuario: { email: 'a@b.c' }, plano: 'starter', forma: 'recorrente' });
  assert.equal(r.url, 'https://mp/sub');
  assert.equal(pedidos[0].corpo.auto_recurring.transaction_amount, 97);
  assert.equal(pedidos[0].corpo.auto_recurring.frequency_type, 'months');
  await assert.rejects(pag.criarCheckout({ organizacao: { id: ORG, isento: true }, usuario: { email: 'a@b.c' }, plano: 'max' }), /isenta/);
});

test('aviso de pagamento aprovado libera 30 dias, uma vez só', async () => {
  const pg = { id: 77, status: 'approved', transaction_amount: 97, external_reference: `${ORG}|starter|avulso` };
  const { pag, banco } = montar({ '/v1/payments/77': pg });
  const r = await pag.processarAviso({ tipo: 'payment', id: '77' });
  assert.equal(r.plano, 'starter');
  assert.equal(banco.plano.plano, 'starter');
  assert.ok(new Date(banco.plano.ate) > new Date(Date.now() + 29 * 86_400_000));
  assert.deepEqual(await pag.processarAviso({ tipo: 'payment', id: '77' }), { ignorado: 'ja_processado' });
});

test('aviso não libera pagamento pendente, de valor menor ou de organização desconhecida', async () => {
  const { pag, banco } = montar({
    '/v1/payments/1': { id: 1, status: 'pending', transaction_amount: 97, external_reference: `${ORG}|starter|avulso` },
    '/v1/payments/2': { id: 2, status: 'approved', transaction_amount: 1, external_reference: `${ORG}|max|avulso` },
    '/v1/payments/3': { id: 3, status: 'approved', transaction_amount: 197, external_reference: '99999999-2222-3333-4444-555555555555|max|avulso' },
  });
  assert.equal((await pag.processarAviso({ tipo: 'payment', id: '1' })).ignorado, 'pagamento_pending');
  assert.equal((await pag.processarAviso({ tipo: 'payment', id: '2' })).ignorado, 'valor_menor');
  assert.equal((await pag.processarAviso({ tipo: 'payment', id: '3' })).ignorado, 'sem_organizacao');
  assert.equal(banco.plano, null);
});

test('assinatura x-signature do Mercado Pago', () => {
  const segredo = 'seg';
  const ts = '1700000000';
  const v1 = createHmac('sha256', segredo).update(`id:123;request-id:req-1;ts:${ts};`).digest('hex');
  assert.equal(assinaturaValida({ segredo, xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: '123' }), true);
  assert.equal(assinaturaValida({ segredo, xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: '124' }), false);
  assert.equal(assinaturaValida({ segredo, xSignature: '', xRequestId: 'req-1', dataId: '123' }), false);
});

test('prazo pago vencido volta ao Free; isenta nunca', () => {
  const ontem = new Date(Date.now() - 86_400_000).toISOString();
  const amanha = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(nivelDaOrganizacao({ plano: 'max', plano_ate: amanha }), 'max');
  assert.equal(nivelDaOrganizacao({ plano: 'max', plano_ate: ontem }), 'free');
  assert.equal(nivelDaOrganizacao({ plano: 'gratuito', plano_ate: ontem, isento: true }), 'max');
});
