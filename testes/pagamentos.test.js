// Testa as assinaturas (src/pagamentos) com uma Stripe falsa e um banco em
// memória. Não usa internet nem chave da Stripe. A assinatura digital dos
// avisos usa a biblioteca oficial da Stripe de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { criarApp } from '../src/api/app.js';
import { PLANOS, planoDoPreco } from '../src/pagamentos/planos.js';
import { ErroPagamento, criarPagamentos, modoDaChave, planoEfetivo, resumirAssinatura } from '../src/pagamentos/stripe.js';

const ORG = randomUUID();
const OUTRA_ORG = randomUUID();
const USUARIO = { id: randomUUID(), email: 'ana@exemplo.com' };
const SEGREDO = 'whsec_teste_licitahub';
const silencioso = { info() {}, aviso() {}, erro() {} };
const ferramentasStripe = new Stripe('sk_test_falsa');

const PRECOS = { licitahub_starter_mensal: 'price_starter_m' };

function assinaturaStripe(campos = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    trial_end: null,
    metadata: { organizacao_id: ORG },
    items: { data: [{ current_period_end: 1_797_000_000, price: { id: 'price_starter_m', lookup_key: 'licitahub_starter_mensal', metadata: {} } }] },
    ...campos,
  };
}

function stripeFalsa(assinaturas = {}, precos = PRECOS) {
  const chamadas = { clientes: [], sessoes: [], portais: [] };
  return {
    chamadas,
    webhooks: ferramentasStripe.webhooks,
    prices: {
      list: async ({ lookup_keys }) => ({
        data: lookup_keys.filter((k) => precos[k]).map((k) => ({ id: precos[k], lookup_key: k })),
      }),
    },
    customers: {
      create: async (dados, opcoes) => {
        chamadas.clientes.push({ dados, opcoes });
        return { id: 'cus_1' };
      },
    },
    checkout: {
      sessions: {
        create: async (dados) => {
          chamadas.sessoes.push(dados);
          return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (dados) => {
          chamadas.portais.push(dados);
          return { url: 'https://billing.stripe.com/p/session/1' };
        },
      },
    },
    subscriptions: {
      retrieve: async (id) => {
        if (!assinaturas[id]) throw new Error(`assinatura ${id} não existe`);
        return assinaturas[id];
      },
    },
  };
}

function bancoFalso({ organizacoes = [ORG, OUTRA_ORG] } = {}) {
  const assinaturas = new Map();
  const planos = new Map();
  return {
    assinaturas,
    planos,
    assinatura: async (org) => assinaturas.get(org) ?? null,
    salvarAssinatura: async (org, campos) => {
      assinaturas.set(org, { organizacao_id: org, teste_usado: false, ...assinaturas.get(org), ...campos });
    },
    organizacaoDoClienteStripe: async (cliente) =>
      [...assinaturas.values()].find((a) => a.stripe_cliente_id === cliente)?.organizacao_id ?? null,
    organizacaoExiste: async (org) => organizacoes.includes(org),
    aplicarPlano: async (org, plano, limites) => planos.set(org, { plano, limites }),
  };
}

function montar({ assinaturas = {}, precos = PRECOS, opcoes = {} } = {}) {
  const stripe = stripeFalsa(assinaturas, precos);
  const banco = bancoFalso();
  const pagamentos = criarPagamentos({
    stripe,
    repositorio: banco,
    opcoes: { urlSite: 'https://licitahub.test/', diasTeste: 30, formasPagamento: [], segredoWebhook: SEGREDO, ...opcoes },
    log: silencioso,
  });
  return { stripe, banco, pagamentos };
}

const organizacao = { id: ORG, nome: 'Consultoria Ana' };
const evento = (type, object) => ({ id: `evt_${randomUUID()}`, type, data: { object } });

test('planos: preço da Stripe vira plano, e a situação decide se o plano fica liberado', () => {
  assert.deepEqual(planoDoPreco({ lookup_key: 'licitahub_starter_mensal' }), { plano: 'starter', ciclo: 'mensal' });
  assert.deepEqual(planoDoPreco({ lookup_key: null, metadata: { plano: 'starter', ciclo: 'anual' } }), { plano: 'starter', ciclo: 'anual' });
  assert.equal(planoDoPreco({ lookup_key: 'licitahub_gratuito_mensal' }), null, 'plano gratuito não tem preço');
  assert.equal(planoDoPreco({ lookup_key: 'licitahub_prime_mensal' }), null, 'plano que não é vendido');
  assert.equal(planoDoPreco({ lookup_key: 'outra_coisa' }), null);
  assert.equal(PLANOS.starter.precos.mensal, 9_700, 'plano único de R$ 97 por mês');

  for (const status of ['trialing', 'active', 'past_due']) assert.equal(planoEfetivo({ plano: 'starter', status }), 'starter', status);
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.equal(planoEfetivo({ plano: 'starter', status }), 'gratuito', status);
  }

  const resumo = resumirAssinatura(assinaturaStripe({ cancel_at_period_end: true, trial_end: 1_796_000_000 }));
  assert.equal(resumo.periodo_fim, new Date(1_797_000_000 * 1000).toISOString(), 'o fim do período vem do item da assinatura');
  assert.equal(resumo.cancelar_no_fim, true);
  assert.equal(resumo.plano, 'starter');
  assert.equal(modoDaChave('sk_test_123'), 'teste');
  assert.equal(modoDaChave('sk_live_123'), 'real');
  assert.equal(modoDaChave('pk_test_123'), null, 'chave pública não serve no servidor');
});

test('página de pagamento: cliente criado uma vez, preço vindo da Stripe e teste grátis só na primeira vez', async () => {
  const { stripe, banco, pagamentos } = montar();

  const r = await pagamentos.criarCheckout({ organizacao, usuario: USUARIO, plano: 'starter', ciclo: 'mensal' });
  assert.equal(r.url, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.equal(r.dias_teste, 30);
  assert.equal(stripe.chamadas.clientes.length, 1);
  assert.equal(stripe.chamadas.clientes[0].dados.metadata.organizacao_id, ORG);
  assert.equal(stripe.chamadas.clientes[0].opcoes.idempotencyKey, `licitahub-cliente-${ORG}`);

  const sessao = stripe.chamadas.sessoes[0];
  assert.equal(sessao.mode, 'subscription');
  assert.equal(sessao.customer, 'cus_1');
  assert.equal(sessao.client_reference_id, ORG);
  assert.deepEqual(sessao.line_items, [{ price: 'price_starter_m', quantity: 1 }]);
  assert.equal(sessao.subscription_data.trial_period_days, 7);
  assert.equal(sessao.subscription_data.metadata.organizacao_id, ORG);
  assert.equal(sessao.locale, 'pt-BR');
  assert.equal(sessao.payment_method_types, undefined, 'sem lista fixa: usa as formas ativadas no painel');
  assert.equal(sessao.success_url, 'https://licitahub.test/assinatura/sucesso?sessao={CHECKOUT_SESSION_ID}');
  assert.equal(sessao.cancel_url, 'https://licitahub.test/precos');

  // Já usou o teste grátis e a assinatura anterior foi cancelada: assina de novo sem teste.
  banco.assinaturas.set(ORG, { organizacao_id: ORG, stripe_cliente_id: 'cus_1', stripe_assinatura_id: 'sub_velha', status: 'canceled', teste_usado: true });
  const de_novo = await pagamentos.criarCheckout({ organizacao, usuario: USUARIO, plano: 'starter', ciclo: 'mensal' });
  assert.equal(de_novo.dias_teste, 0);
  assert.equal(stripe.chamadas.clientes.length, 1, 'reaproveita o mesmo cliente');
  assert.equal(stripe.chamadas.sessoes[1].subscription_data.trial_period_days, undefined);
  assert.deepEqual(stripe.chamadas.sessoes[1].line_items, [{ price: 'price_starter_m', quantity: 1 }]);
});

test('página de pagamento: recusa plano ou ciclo inválido, preço ausente e quem já assina', async () => {
  const { banco, pagamentos } = montar();
  const tentar = (plano, ciclo) => pagamentos.criarCheckout({ organizacao, usuario: USUARIO, plano, ciclo });
  const codigo = (c) => (e) => e instanceof ErroPagamento && e.codigo === c;

  await assert.rejects(tentar('gratuito', 'mensal'), codigo('plano_invalido'));
  await assert.rejects(tentar('vip', 'mensal'), codigo('plano_invalido'));
  await assert.rejects(tentar('prime', 'mensal'), codigo('plano_invalido'), 'plano que não é mais vendido');
  await assert.rejects(tentar('starter', 'semanal'), codigo('ciclo_invalido'));
  await assert.rejects(tentar('starter', 'anual'), codigo('ciclo_indisponivel'), 'o plano único é só mensal');

  const semPreco = montar({ precos: {} }).pagamentos;
  await assert.rejects(
    semPreco.criarCheckout({ organizacao, usuario: USUARIO, plano: 'starter', ciclo: 'mensal' }),
    codigo('stripe_sem_preco'),
    'preço ainda não criado na Stripe',
  );

  banco.assinaturas.set(ORG, { organizacao_id: ORG, stripe_cliente_id: 'cus_1', stripe_assinatura_id: 'sub_1', status: 'active' });
  await assert.rejects(tentar('starter', 'mensal'), codigo('ja_assinante'));
  await assert.rejects(pagamentos.criarPortal({ organizacao: { id: OUTRA_ORG } }), codigo('sem_assinatura'));
  assert.deepEqual(await pagamentos.criarPortal({ organizacao }), { url: 'https://billing.stripe.com/p/session/1' });
});

test('avisos da Stripe: pagou libera o plano, cancelou volta ao gratuito, aviso velho não derruba o atual', async () => {
  const assinaturas = {
    sub_1: assinaturaStripe({ status: 'trialing', trial_end: 1_796_000_000 }),
    sub_velha: assinaturaStripe({ id: 'sub_velha', status: 'canceled' }),
  };
  const { banco, pagamentos } = montar({ assinaturas });

  const pago = await pagamentos.processarEvento(evento('checkout.session.completed', {
    mode: 'subscription', subscription: 'sub_1', client_reference_id: ORG,
  }));
  assert.deepEqual(pago, { organizacao_id: ORG, plano: 'starter', status: 'trialing' });
  assert.deepEqual(banco.planos.get(ORG), { plano: 'starter', limites: PLANOS.starter.limites });
  assert.equal(banco.assinaturas.get(ORG).teste_usado, true);
  assert.equal(banco.assinaturas.get(ORG).stripe_cliente_id, 'cus_1');

  // Fatura paga: a assinatura vem em parent.subscription_details (API atual da Stripe).
  assinaturas.sub_1 = assinaturaStripe({ status: 'active' });
  const fatura = await pagamentos.processarEvento(evento('invoice.paid', {
    parent: { subscription_details: { subscription: 'sub_1', metadata: { organizacao_id: ORG } } },
  }));
  assert.equal(fatura.status, 'active');
  assert.equal(banco.assinaturas.get(ORG).teste_usado, true, 'continua marcado: o teste grátis já foi usado');

  // Aviso atrasado de uma assinatura antiga e cancelada: ignorado.
  const velho = await pagamentos.processarEvento(evento('customer.subscription.deleted', { id: 'sub_velha', metadata: { organizacao_id: ORG } }));
  assert.deepEqual(velho, { ignorado: 'assinatura_substituida' });
  assert.equal(banco.planos.get(ORG).plano, 'starter');

  // Pagamento falhou e a Stripe ainda está tentando: mantém o plano.
  assinaturas.sub_1 = assinaturaStripe({ status: 'past_due' });
  await pagamentos.processarEvento(evento('customer.subscription.updated', { id: 'sub_1' }));
  assert.equal(banco.planos.get(ORG).plano, 'starter');

  // Cancelada de vez: volta ao gratuito.
  assinaturas.sub_1 = assinaturaStripe({ status: 'canceled' });
  const cancelado = await pagamentos.processarEvento(evento('customer.subscription.deleted', { id: 'sub_1' }));
  assert.equal(cancelado.plano, 'gratuito');
  assert.deepEqual(banco.planos.get(ORG), { plano: 'gratuito', limites: PLANOS.gratuito.limites });

  // Outros casos ignorados sem erro.
  assert.deepEqual(await pagamentos.processarEvento(evento('payment_intent.created', {})), { ignorado: 'tipo_nao_tratado' });
  assert.deepEqual(await pagamentos.processarEvento(evento('checkout.session.completed', { mode: 'payment' })), { ignorado: 'nao_e_assinatura' });
  assinaturas.sub_orfa = assinaturaStripe({ id: 'sub_orfa', customer: 'cus_x', metadata: { organizacao_id: randomUUID() } });
  assert.deepEqual(await pagamentos.processarEvento(evento('customer.subscription.updated', { id: 'sub_orfa' })), { ignorado: 'sem_organizacao' });
});

// --- Rotas HTTP ---------------------------------------------------------------

function montarApp(pagamentos) {
  const repositorio = {
    usuarioDoToken: async (token) => (token === 'token-dono' || token === 'token-membro' ? USUARIO : null),
    comoUsuario: (token) => ({
      temPapel: async (org) => token === 'token-dono' && org === ORG,
      organizacao: async (id) => (id === ORG ? organizacao : null),
    }),
  };
  return criarApp({
    repositorio,
    analisar: async () => { throw new Error('não usado'); },
    obterEdital: async () => { throw new Error('não usado'); },
    pagamentos,
    log: silencioso,
  });
}

const enviar = (app, caminho, { corpo, token, cabecalhos = {} } = {}) =>
  app.request(caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...cabecalhos },
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? {}),
  });

test('rotas de assinatura: exigem login e papel de dono ou administrador', async () => {
  const { pagamentos } = montar();
  const app = montarApp(pagamentos);
  const pedido = { organizacao_id: ORG, plano: 'starter', ciclo: 'mensal' };

  assert.equal((await enviar(app, '/api/assinaturas/checkout', { corpo: pedido })).status, 401);
  assert.equal((await enviar(app, '/api/assinaturas/checkout', { corpo: pedido, token: 'token-membro' })).status, 403);
  assert.equal((await enviar(app, '/api/assinaturas/checkout', { corpo: { ...pedido, ciclo: 'semanal' }, token: 'token-dono' })).status, 400);
  assert.equal((await enviar(app, '/api/assinaturas/checkout', { corpo: { ...pedido, plano: 'vip' }, token: 'token-dono' })).status, 400);

  const portalAntes = await enviar(app, '/api/assinaturas/portal', { corpo: { organizacao_id: ORG }, token: 'token-dono' });
  assert.equal(portalAntes.status, 404, 'sem cadastro na Stripe ainda');

  const ok = await enviar(app, '/api/assinaturas/checkout', { corpo: pedido, token: 'token-dono' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).url, 'https://checkout.stripe.com/c/pay/cs_1');

  const portal = await enviar(app, '/api/assinaturas/portal', { corpo: { organizacao_id: ORG }, token: 'token-dono' });
  assert.equal(portal.status, 200, 'com cadastro na Stripe, o portal abre');
  assert.equal((await enviar(app, '/api/assinaturas/portal', { corpo: { organizacao_id: ORG }, token: 'token-membro' })).status, 403);

  const desligado = montarApp(null);
  assert.equal((await enviar(desligado, '/api/assinaturas/checkout', { corpo: pedido, token: 'token-dono' })).status, 503);
});

test('webhook: aceita só avisos com a assinatura digital da Stripe e não pede login', async () => {
  const { banco, pagamentos } = montar({ assinaturas: { sub_1: assinaturaStripe() } });
  const app = montarApp(pagamentos);
  const corpo = JSON.stringify(evento('customer.subscription.created', { id: 'sub_1', metadata: { organizacao_id: ORG } }));

  const falso = await enviar(app, '/stripe/webhook', { corpo, cabecalhos: { 'stripe-signature': 't=1,v1=falsificado' } });
  assert.equal(falso.status, 400);
  assert.equal(banco.planos.size, 0, 'aviso falso não muda nada');

  const semAssinatura = await enviar(app, '/stripe/webhook', { corpo });
  assert.equal(semAssinatura.status, 400);

  const assinatura = ferramentasStripe.webhooks.generateTestHeaderString({ payload: corpo, secret: SEGREDO });
  const verdadeiro = await enviar(app, '/stripe/webhook', { corpo, cabecalhos: { 'stripe-signature': assinatura } });
  assert.equal(verdadeiro.status, 200);
  assert.deepEqual(await verdadeiro.json(), { recebido: true });
  assert.equal(banco.planos.get(ORG).plano, 'starter');
});
