// Assinaturas pela Stripe: página de pagamento (Checkout), portal do assinante
// e avisos automáticos da Stripe (webhooks).
//
// Regras:
//   - Uma assinatura por organização. O cliente na Stripe também é por organização.
//   - O plano pago fica liberado com a assinatura em teste grátis (trialing),
//     ativa (active) ou com pagamento atrasado que a Stripe ainda está tentando
//     cobrar de novo (past_due). Cancelada, não paga ou pausada: volta ao gratuito.
//   - O servidor nunca vê o número do cartão: o cliente paga na página da Stripe.
//   - Os avisos da Stripe podem chegar repetidos ou fora de ordem. Por isso, a
//     cada aviso o servidor busca o estado atual da assinatura na própria Stripe.
import Stripe from 'stripe';
import { config } from '../config.js';
import { CICLOS, PLANOS, chavePreco, planoDoPreco } from './planos.js';

export class ErroPagamento extends Error {
  /**
   * @param {string} mensagem  texto amigável, pode ir para o usuário
   * @param {{ status?: number, codigo?: string }} [opcoes]
   */
  constructor(mensagem, { status = 400, codigo = 'pagamento_invalido' } = {}) {
    super(mensagem);
    this.name = 'ErroPagamento';
    this.status = status;
    this.codigo = codigo;
  }
}

const LIBERAM_PLANO = new Set(['trialing', 'active', 'past_due']);
const EM_ANDAMENTO = new Set([...LIBERAM_PLANO, 'incomplete']);

/** Avisos (webhooks) que o LicitaHub trata. No painel da Stripe, cadastre exatamente estes. */
export const EVENTOS_STRIPE = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed',
];

const emIso = (segundos) => (segundos ? new Date(segundos * 1000).toISOString() : null);
const idDe = (valor) => (typeof valor === 'string' ? valor : valor?.id ?? null);

/** Cliente da Stripe com a chave secreta do .env (só no servidor, nunca no site). */
export function clienteStripe(chave = config.stripe.chaveSecreta) {
  if (!chave) {
    throw new ErroPagamento('Pagamentos ainda não configurados: falta STRIPE_SECRET_KEY no .env.', {
      status: 503, codigo: 'stripe_sem_chave',
    });
  }
  return new Stripe(chave, { maxNetworkRetries: 2, appInfo: { name: 'LicitaHub' } });
}

/** "teste" (dinheiro de mentira), "real" ou null, conforme o início da chave. */
export function modoDaChave(chave = config.stripe.chaveSecreta) {
  if (/^(sk|rk)_test_/.test(chave ?? '')) return 'teste';
  if (/^(sk|rk)_live_/.test(chave ?? '')) return 'real';
  return null;
}

/** Resume uma assinatura da Stripe no formato da tabela public.assinaturas. */
export function resumirAssinatura(sub) {
  const item = sub.items?.data?.[0];
  const plano = planoDoPreco(item?.price);
  return {
    stripe_cliente_id: idDe(sub.customer),
    stripe_assinatura_id: sub.id,
    plano: plano?.plano ?? null,
    ciclo: plano?.ciclo ?? null,
    status: sub.status,
    periodo_fim: emIso(item?.current_period_end), // na API atual, o período fica no item
    teste_fim: emIso(sub.trial_end),
    cancelar_no_fim: Boolean(sub.cancel_at_period_end || sub.cancel_at),
  };
}

/** Plano que a organização deve ter com esta assinatura. */
export function planoEfetivo({ plano, status }) {
  return plano && LIBERAM_PLANO.has(status) ? plano : 'gratuito';
}

/**
 * Serviço de pagamentos. O cliente da Stripe e o repositório do banco são
 * recebidos de fora, para os testes poderem usar versões falsas.
 * @param {object} deps
 * @param {import('stripe').Stripe} deps.stripe
 * @param {object} deps.repositorio  ver src/api/repositorio.js
 * @param {{ urlSite?: string, diasTeste?: number, formasPagamento?: string[], segredoWebhook?: string }} [deps.opcoes]
 * @param {{ aviso: (msg: string) => void }} [deps.log]
 */
export function criarPagamentos({ stripe, repositorio, opcoes = {}, log }) {
  const {
    urlSite = config.stripe.urlSite,
    diasTeste = config.stripe.diasTeste,
    formasPagamento = config.stripe.formasPagamento,
    segredoWebhook = config.stripe.segredoWebhook,
  } = opcoes;
  const site = urlSite.replace(/\/$/, '');

  async function precoAtivo(plano, ciclo) {
    const { data } = await stripe.prices.list({ lookup_keys: [chavePreco(plano, ciclo)], active: true, limit: 1 });
    if (!data.length) {
      throw new ErroPagamento('Preço não encontrado na Stripe. Rode: npm run stripe:configurar', {
        status: 503, codigo: 'stripe_sem_preco',
      });
    }
    return data[0];
  }

  return {
    /** Cria a página de pagamento da Stripe para a organização assinar um plano. */
    async criarCheckout({ organizacao, usuario, plano, ciclo }) {
      if (!PLANOS[plano]?.precos) throw new ErroPagamento('Plano inválido.', { codigo: 'plano_invalido' });
      if (!CICLOS[ciclo]) throw new ErroPagamento('Ciclo inválido: use "mensal" ou "anual".', { codigo: 'ciclo_invalido' });
      if (!PLANOS[plano].precos[ciclo]) {
        throw new ErroPagamento(`O plano ${PLANOS[plano].nome} não tem cobrança ${ciclo}.`, { codigo: 'ciclo_indisponivel' });
      }

      const atual = await repositorio.assinatura(organizacao.id);
      if (atual?.stripe_assinatura_id && EM_ANDAMENTO.has(atual.status)) {
        throw new ErroPagamento(
          'Esta organização já tem uma assinatura. Para trocar de plano ou cancelar, use o portal da assinatura.',
          { status: 409, codigo: 'ja_assinante' },
        );
      }
      const preco = await precoAtivo(plano, ciclo);

      let clienteId = atual?.stripe_cliente_id;
      if (!clienteId) {
        const cliente = await stripe.customers.create(
          { name: organizacao.nome, email: usuario.email, metadata: { organizacao_id: organizacao.id } },
          { idempotencyKey: `licitahub-cliente-${organizacao.id}` },
        );
        clienteId = cliente.id;
        await repositorio.salvarAssinatura(organizacao.id, { stripe_cliente_id: clienteId });
      }

      // Teste grátis só uma vez por organização.
      const teste = diasTeste > 0 && !atual?.teste_usado ? { trial_period_days: diasTeste } : {};
      const sessao = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: clienteId,
        client_reference_id: organizacao.id,
        line_items: [{ price: preco.id, quantity: 1 }],
        subscription_data: { ...teste, metadata: { organizacao_id: organizacao.id } },
        metadata: { organizacao_id: organizacao.id },
        allow_promotion_codes: true,
        locale: 'pt-BR',
        // Vazio = usa as formas de pagamento ativadas no painel da Stripe.
        ...(formasPagamento.length ? { payment_method_types: formasPagamento } : {}),
        success_url: `${site}/assinatura/sucesso?sessao={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/precos`,
      });
      return { url: sessao.url, id: sessao.id, dias_teste: teste.trial_period_days ?? 0 };
    },

    /** Portal da Stripe: trocar cartão, ver faturas, mudar de plano ou cancelar. */
    async criarPortal({ organizacao }) {
      const atual = await repositorio.assinatura(organizacao.id);
      if (!atual?.stripe_cliente_id) {
        throw new ErroPagamento('Esta organização ainda não tem assinatura.', { status: 404, codigo: 'sem_assinatura' });
      }
      const sessao = await stripe.billingPortal.sessions.create({
        customer: atual.stripe_cliente_id,
        return_url: `${site}/painel`,
        locale: 'pt-BR',
      });
      return { url: sessao.url };
    },

    /** Confere a assinatura digital do aviso: prova de que ele veio mesmo da Stripe. */
    verificarEvento(corpo, cabecalho) {
      if (!segredoWebhook) {
        throw new ErroPagamento('Falta STRIPE_WEBHOOK_SECRET no .env.', { status: 503, codigo: 'stripe_sem_webhook' });
      }
      try {
        return stripe.webhooks.constructEvent(corpo, cabecalho ?? '', segredoWebhook);
      } catch {
        throw new ErroPagamento('Aviso da Stripe com assinatura inválida.', { status: 400, codigo: 'webhook_invalido' });
      }
    },

    /** Atualiza a assinatura e o plano da organização a partir de um aviso da Stripe. */
    async processarEvento(evento) {
      const obj = evento.data?.object ?? {};
      let assinaturaId;
      let organizacaoId;
      if (evento.type === 'checkout.session.completed' || evento.type === 'checkout.session.async_payment_succeeded') {
        if (obj.mode !== 'subscription' || !obj.subscription) return { ignorado: 'nao_e_assinatura' };
        assinaturaId = idDe(obj.subscription);
        organizacaoId = obj.client_reference_id ?? obj.metadata?.organizacao_id;
      } else if (evento.type.startsWith('customer.subscription.')) {
        assinaturaId = obj.id;
        organizacaoId = obj.metadata?.organizacao_id;
      } else if (evento.type.startsWith('invoice.')) {
        const detalhes = obj.parent?.subscription_details; // na API atual, a fatura aponta a assinatura aqui
        assinaturaId = idDe(detalhes?.subscription);
        organizacaoId = detalhes?.metadata?.organizacao_id;
        if (!assinaturaId) return { ignorado: 'fatura_sem_assinatura' };
      } else {
        return { ignorado: 'tipo_nao_tratado' };
      }

      const sub = await stripe.subscriptions.retrieve(assinaturaId);
      const resumo = resumirAssinatura(sub);
      organizacaoId ??= sub.metadata?.organizacao_id
        ?? (await repositorio.organizacaoDoClienteStripe(resumo.stripe_cliente_id));
      if (!organizacaoId || !(await repositorio.organizacaoExiste(organizacaoId))) {
        log?.aviso(`Stripe: assinatura ${sub.id} sem organização no LicitaHub (${evento.type}).`);
        return { ignorado: 'sem_organizacao' };
      }

      const atual = await repositorio.assinatura(organizacaoId);
      if (atual?.stripe_assinatura_id && atual.stripe_assinatura_id !== sub.id && LIBERAM_PLANO.has(atual.status)) {
        // Aviso atrasado de uma assinatura antiga: não derruba a que está valendo.
        if (!LIBERAM_PLANO.has(resumo.status)) return { ignorado: 'assinatura_substituida' };
        log?.aviso(`Stripe: a organização ${organizacaoId} tem duas assinaturas ativas `
          + `(${atual.stripe_assinatura_id} e ${sub.id}). Cancele uma no painel da Stripe.`);
      }

      const plano = planoEfetivo(resumo);
      await repositorio.salvarAssinatura(organizacaoId, { ...resumo, teste_usado: Boolean(atual?.teste_usado || sub.trial_end) });
      await repositorio.aplicarPlano(organizacaoId, plano, PLANOS[plano].limites);
      return { organizacao_id: organizacaoId, plano, status: resumo.status };
    },
  };
}
