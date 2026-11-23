// Assinaturas pelo Mercado Pago (src/pagamentos/mercadopago.js) e ciclo com janela do robô
// (src/pagamentos/ciclo.js), sem rede: o fetch do Mercado Pago é trocado por um falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { assinaturaValida, criarPagamentos, frequenciaMp, lerReferencia, referencia } from '../src/pagamentos/mercadopago.js';
import { configCiclo, novoCiclo, roboLiberado, situacaoRobo } from '../src/pagamentos/ciclo.js';
import { nivelDaOrganizacao } from '../src/pagamentos/acesso.js';

const ORG = '11111111-2222-3333-4444-555555555555';
const DIA = 86_400_000;
const AGORA = new Date('2026-11-23T12:00:00Z');
const em = (dias) => new Date(AGORA.getTime() + dias * DIA).toISOString();

function montar(respostas = {}, { ciclo = { cicloDias: 30, roboDias: 7 }, agora = AGORA } = {}) {
  const pedidos = [];
  const banco = { assinatura: null, plano: null };
  const repositorio = {
    organizacaoExiste: async (id) => id === ORG,
    assinatura: async () => banco.assinatura,
    salvarAssinatura: async (_, campos) => { banco.assinatura = { ...banco.assinatura, ...campos }; },
    aplicarPlano: async (_, plano, limites, ate, datas) => { banco.plano = { plano, limites, ate, ...datas }; },
  };
  const fetch = async (url, op) => {
    pedidos.push({ url, metodo: op.method, corpo: op.body ? JSON.parse(op.body) : null });
    const caminho = url.replace('https://api.mercadopago.com', '');
    const r = respostas[caminho];
    return { ok: r !== undefined, status: r === undefined ? 404 : 200, json: async () => r ?? {} };
  };
  const pag = criarPagamentos({ token: 'TEST-123', urlSite: 'https://site.test', repositorio, fetch, ciclo, agora: () => agora });
  return { pag, pedidos, banco };
}

test('referência', () => {
  assert.deepEqual(lerReferencia(referencia(ORG, 'max', 'recorrente')), { organizacaoId: ORG, plano: 'max', forma: 'recorrente' });
  assert.deepEqual(lerReferencia(referencia(ORG, 'max', 'avulso')), { organizacaoId: ORG, plano: 'max', forma: 'avulso' }); // avisos antigos
  assert.equal(lerReferencia(`${ORG}|gratuito|avulso`), null);
  assert.equal(lerReferencia('qualquer|coisa'), null);
});

test('ciclo configurável: padrão 30 dias com 7 de robô; janela nunca passa do ciclo', () => {
  assert.deepEqual(configCiclo({}), { cicloDias: 30, roboDias: 7 });
  assert.deepEqual(configCiclo({ ASSINATURA_CICLO_DIAS: '15', ASSINATURA_ROBO_DIAS: '5' }), { cicloDias: 15, roboDias: 5 });
  assert.deepEqual(configCiclo({ ASSINATURA_CICLO_DIAS: '10', ASSINATURA_ROBO_DIAS: '20' }), { cicloDias: 10, roboDias: 10 });
  assert.deepEqual(configCiclo({ ASSINATURA_CICLO_DIAS: 'x', ASSINATURA_ROBO_DIAS: '-1' }), { cicloDias: 30, roboDias: 7 });
  assert.deepEqual(frequenciaMp(30), { frequency: 1, frequency_type: 'months' });
  assert.deepEqual(frequenciaMp(15), { frequency: 15, frequency_type: 'days' });
});

test('novo ciclo: começa agora; renovação do mesmo plano emenda no fim do atual', () => {
  const config = { cicloDias: 30, roboDias: 7 };
  assert.deepEqual(novoCiclo({ agora: AGORA, config }), { inicio: em(0), fim: em(30), roboDe: em(0), roboAte: em(7) });
  // renovação cobrada 1 dia antes do fim: o ciclo novo começa no fim do atual (não perde dias)
  assert.deepEqual(novoCiclo({ fimAtual: em(1), mesmoPlano: true, agora: AGORA, config }), { inicio: em(1), fim: em(31), roboDe: em(1), roboAte: em(8) });
  // troca de plano ou ciclo vencido: começa agora
  assert.equal(novoCiclo({ fimAtual: em(10), mesmoPlano: false, agora: AGORA, config }).inicio, em(0));
  assert.equal(novoCiclo({ fimAtual: em(-3), mesmoPlano: true, agora: AGORA, config }).inicio, em(0));
});

test('robô: só Max, dentro da janela; plataforma segue até o fim do ciclo; isenta sempre', () => {
  const max = { plano: 'max', plano_ate: em(23), robo_de: em(-7), robo_ate: em(0.5) };
  assert.equal(roboLiberado(max, AGORA), true);
  assert.equal(roboLiberado({ ...max, robo_ate: em(-0.1) }, AGORA), false); // janela fechou
  assert.equal(nivelDaOrganizacao({ ...max, robo_ate: em(-0.1) }, AGORA), 'max'); // plataforma Max segue
  assert.equal(roboLiberado({ ...max, robo_de: em(1), robo_ate: em(8) }, AGORA), false); // janela ainda não abriu
  assert.equal(roboLiberado({ ...max, plano_ate: em(-1) }, AGORA), false); // ciclo vencido
  assert.equal(roboLiberado({ plano: 'starter', plano_ate: em(20) }, AGORA), false); // Pro não tem robô
  assert.equal(roboLiberado({ plano: 'gratuito', isento: true }, AGORA), true);
  assert.equal(roboLiberado({ plano: 'max', plano_ate: em(5), robo_ate: null }, AGORA), true); // pago antes da regra
  assert.deepEqual(situacaoRobo({ ...max, robo_ate: em(-1) }, AGORA), { liberado: false, motivo: 'janela_encerrada', volta: em(23) });
});

test('checkout: cartão com cobrança automática a cada ciclo, no valor do plano', async () => {
  const { pag, pedidos, banco } = montar({ '/preapproval': { id: 'sub1', init_point: 'https://mp/assinar' } });
  const r = await pag.criarCheckout({ organizacao: { id: ORG }, usuario: { email: 'a@b.c' }, plano: 'max' });
  assert.equal(r.url, 'https://mp/assinar');
  const { corpo, metodo } = pedidos[0];
  assert.equal(metodo, 'POST');
  assert.deepEqual(corpo.auto_recurring, { frequency: 1, frequency_type: 'months', transaction_amount: 197, currency_id: 'BRL' });
  assert.equal(corpo.external_reference, `${ORG}|max|recorrente`);
  assert.equal(corpo.back_url, 'https://site.test/assinatura/sucesso');
  assert.equal(banco.assinatura.status, 'pending');
});

test('Pix/avulso não é mais vendido; isenta nunca é cobrada; não assina duas vezes', async () => {
  const { pag, pedidos, banco } = montar({});
  await assert.rejects(pag.criarCheckout({ organizacao: { id: ORG }, usuario: { email: 'a@b.c' }, plano: 'starter', forma: 'avulso' }), /cartão de crédito/);
  await assert.rejects(pag.criarCheckout({ organizacao: { id: ORG, isento: true }, usuario: { email: 'a@b.c' }, plano: 'max' }), /isenta/);
  assert.equal(pedidos.length, 0);
  banco.assinatura = { forma: 'recorrente', status: 'authorized', plano: 'max', periodo_fim: em(10) };
  await assert.rejects(pag.criarCheckout({ organizacao: { id: ORG }, usuario: { email: 'a@b.c' }, plano: 'max' }), /já tem/);
});

test('cobrança aprovada abre o ciclo: 30 dias de plataforma, 7 de robô; uma vez só', async () => {
  const pg = { id: 77, status: 'approved', transaction_amount: 197, external_reference: `${ORG}|max|recorrente` };
  const { pag, banco } = montar({ '/v1/payments/77': pg });
  const r = await pag.processarAviso({ tipo: 'payment', id: '77' });
  assert.deepEqual(r, { organizacao_id: ORG, plano: 'max', ate: em(30), robo_ate: em(7) });
  assert.deepEqual(banco.plano, { plano: 'max', limites: { empresas: 20, analisesMes: 60 }, ate: em(30), ciclo_inicio: em(0), robo_de: em(0), robo_ate: em(7) });
  assert.equal(banco.assinatura.status, 'authorized');
  assert.equal(banco.assinatura.status_pagamento, 'approved');
  assert.equal(banco.assinatura.falhas_pagamento, 0);
  assert.deepEqual(await pag.processarAviso({ tipo: 'payment', id: '77' }), { ignorado: 'ja_processado' });
});

test('cobrança da assinatura (authorized_payment) e renovação reabrem a janela do robô', async () => {
  const resp = {
    '/authorized_payments/900': { id: 900, status: 'processed', preapproval_id: 'sub1', payment: { id: 501 } },
    '/v1/payments/501': { id: 501, status: 'approved', transaction_amount: 197, metadata: { preapproval_id: 'sub1' } },
    '/preapproval/sub1': { id: 'sub1', external_reference: `${ORG}|max|recorrente`, status: 'authorized' },
  };
  const { pag, banco } = montar(resp);
  banco.assinatura = { plano: 'max', periodo_fim: em(0.5), mp_pagamentos: '400' }; // ciclo anterior acabando
  const r = await pag.processarAviso({ tipo: 'subscription_authorized_payment', id: '900' });
  assert.equal(r.plano, 'max');
  assert.equal(banco.plano.robo_de, em(0.5)); // emenda: janela nova começa no fim do ciclo anterior
  assert.equal(banco.plano.robo_ate, em(7.5));
  assert.equal(banco.plano.ate, em(30.5));
});

test('cobrança recusada: registra a falha (uma vez), não muda o plano', async () => {
  const resp = {
    '/v1/payments/600': { id: 600, status: 'rejected', transaction_amount: 197, external_reference: `${ORG}|max|recorrente` },
    '/v1/payments/601': { id: 601, status: 'rejected', transaction_amount: 97, external_reference: `${ORG}|starter|avulso` },
  };
  const { pag, banco } = montar(resp);
  assert.deepEqual(await pag.processarAviso({ tipo: 'payment', id: '600' }), { organizacao_id: ORG, falha: 'rejected' });
  assert.equal(banco.assinatura.status_pagamento, 'rejected');
  assert.equal(banco.assinatura.falhas_pagamento, 1);
  assert.deepEqual(await pag.processarAviso({ tipo: 'payment', id: '600' }), { ignorado: 'ja_processado' });
  assert.equal(banco.assinatura.falhas_pagamento, 1);
  assert.equal((await pag.processarAviso({ tipo: 'payment', id: '601' })).ignorado, 'pagamento_rejected'); // Pix antigo recusado: nada a fazer
  assert.equal(banco.plano, null);
});

test('assinatura cancelada/pausada fica registrada (acesso até o fim do ciclo)', async () => {
  const { pag, banco } = montar({ '/preapproval/sub9': { id: 'sub9', external_reference: `${ORG}|max|recorrente`, status: 'cancelled', next_payment_date: '2026-12-23T12:00:00Z' } });
  const r = await pag.processarAviso({ tipo: 'subscription_preapproval', id: 'sub9' });
  assert.deepEqual(r, { organizacao_id: ORG, status: 'cancelled' });
  assert.equal(banco.assinatura.cancelar_no_fim, true);
  assert.equal(banco.plano, null);
});

test('aviso não libera pagamento pendente, de valor menor ou de organização desconhecida', async () => {
  const { pag, banco } = montar({
    '/v1/payments/1': { id: 1, status: 'pending', transaction_amount: 97, external_reference: `${ORG}|starter|recorrente` },
    '/v1/payments/2': { id: 2, status: 'approved', transaction_amount: 1, external_reference: `${ORG}|max|recorrente` },
    '/v1/payments/3': { id: 3, status: 'approved', transaction_amount: 197, external_reference: '99999999-2222-3333-4444-555555555555|max|recorrente' },
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
  const ontem = new Date(Date.now() - DIA).toISOString();
  const amanha = new Date(Date.now() + DIA).toISOString();
  assert.equal(nivelDaOrganizacao({ plano: 'max', plano_ate: amanha }), 'max');
  assert.equal(nivelDaOrganizacao({ plano: 'max', plano_ate: ontem }), 'free');
  assert.equal(nivelDaOrganizacao({ plano: 'gratuito', plano_ate: ontem, isento: true }), 'max');
});
