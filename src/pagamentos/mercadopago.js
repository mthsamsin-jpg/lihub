// =============================================================================
// Uso LicitaHub · Assinaturas pelo Mercado Pago (único meio de pagamento)
//
// Duas formas de pagar um plano (Pro R$ 97 ou Max R$ 197):
//   - "avulso": Checkout Pro com Pix, cartão de crédito ou cartão de débito.
//     Cada pagamento aprovado libera o plano por 15 dias.
//   - "recorrente": assinatura no cartão de crédito (preapproval). O Mercado
//     Pago cobra a cada 15 dias; cada cobrança aprovada libera mais 15 dias.
//
// Segurança:
//   - O servidor nunca vê dados de cartão: o cliente paga na página do Mercado Pago.
//   - O aviso (webhook) só diz "algo mudou": o servidor SEMPRE consulta o
//     pagamento na API do Mercado Pago com o token secreto antes de liberar.
//     Um aviso falso não libera nada. Com MP_WEBHOOK_SECRET definido, a
//     assinatura x-signature também é conferida.
//   - Cada pagamento libera os 15 dias uma vez só (avisos repetidos são ignorados).
//   - Conta isenta (organizacoes.isento) nunca é cobrada.
// =============================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLANOS } from './planos.js';

export class ErroPagamento extends Error {
  constructor(mensagem, { status = 400, codigo = 'pagamento_invalido' } = {}) {
    super(mensagem);
    this.name = 'ErroPagamento';
    this.status = status;
    this.codigo = codigo;
  }
}

const API = 'https://api.mercadopago.com';
export const DIAS_POR_PAGAMENTO = 15;
export const FORMAS = ['avulso', 'recorrente'];

/** "teste" (credencial TEST-...) ou "real" (APP_USR-...). */
export const modoDoToken = (token) => (/^TEST-/.test(token ?? '') ? 'teste' : /^APP_USR-/.test(token ?? '') ? 'real' : null);

/** external_reference: "org|plano|forma" (ida e volta). */
export const referencia = (org, plano, forma) => `${org}|${plano}|${forma}`;
export function lerReferencia(ref) {
  const [organizacaoId, plano, forma] = String(ref ?? '').split('|');
  if (!/^[0-9a-f-]{36}$/i.test(organizacaoId || '') || !PLANOS[plano]?.precos || !FORMAS.includes(forma)) return null;
  return { organizacaoId, plano, forma };
}

/** Nova data de fim: soma 15 dias a partir do fim atual (se ainda vale) ou de agora. */
export function novoFim(fimAtual, agora = new Date(), dias = DIAS_POR_PAGAMENTO) {
  const base = fimAtual && new Date(fimAtual) > agora ? new Date(fimAtual) : agora;
  return new Date(base.getTime() + dias * 86_400_000).toISOString();
}

/**
 * Confere o cabeçalho x-signature do Mercado Pago ("ts=...,v1=...").
 * Manifesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com HMAC-SHA256.
 */
export function assinaturaValida({ segredo, xSignature, xRequestId, dataId }) {
  const partes = Object.fromEntries(String(xSignature ?? '').split(',').map((p) => p.trim().split('=')));
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(String(dataId ?? '')) ? String(dataId).toLowerCase() : String(dataId ?? '');
  let manifesto = '';
  if (id) manifesto += `id:${id};`;
  if (xRequestId) manifesto += `request-id:${xRequestId};`;
  manifesto += `ts:${partes.ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest('hex');
  const a = Buffer.from(esperado);
  const b = Buffer.from(String(partes.v1));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ token: string, segredoWebhook?: string|null, urlSite: string, repositorio: object,
 *   log?: object, fetch?: typeof fetch }} deps
 */
export function criarPagamentos({ token, segredoWebhook = null, urlSite, repositorio, log, fetch: buscar = fetch }) {
  if (!token) throw new ErroPagamento('Falta MP_ACCESS_TOKEN no .env.', { status: 503, codigo: 'mp_sem_token' });
  const site = urlSite.replace(/\/$/, '');

  async function mp(caminho, { metodo = 'GET', corpo, idempotencia } = {}) {
    const r = await buscar(`${API}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      log?.erro?.(`Mercado Pago ${metodo} ${caminho}: HTTP ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
      throw new ErroPagamento('O Mercado Pago não respondeu como esperado. Tente de novo em instantes.', { status: 502, codigo: 'mp_falhou' });
    }
    return json;
  }

  /** Libera (ou estende) o plano por 15 dias, uma vez por pagamento. */
  async function liberar({ organizacaoId, plano, forma, pagamentoId, valor }) {
    if (!(await repositorio.organizacaoExiste(organizacaoId))) return { ignorado: 'sem_organizacao' };
    const atual = await repositorio.assinatura(organizacaoId);
    const vistos = String(atual?.mp_pagamentos ?? '').split(',').filter(Boolean);
    if (vistos.includes(String(pagamentoId))) return { ignorado: 'ja_processado' };
    // Trocou de plano (ex.: Pro -> Max): os dias começam agora; mesmo plano: soma.
    const fim = novoFim(atual?.plano === plano ? atual?.periodo_fim : null);
    await repositorio.salvarAssinatura(organizacaoId, {
      plano, ciclo: 'mensal', status: 'active', periodo_fim: fim, forma,
      mp_pagamentos: [String(pagamentoId), ...vistos].slice(0, 50).join(','),
    });
    await repositorio.aplicarPlano(organizacaoId, plano, PLANOS[plano].limites, fim);
    log?.info?.(`Mercado Pago: pagamento ${pagamentoId} aprovado (R$ ${valor}) -> ${plano} até ${fim.slice(0, 10)}.`);
    return { organizacao_id: organizacaoId, plano, ate: fim };
  }

  return {
    /** Página de pagamento do Mercado Pago. forma: avulso (Pix/crédito/débito) | recorrente (crédito a cada 15 dias). */
    async criarCheckout({ organizacao, usuario, plano, forma = 'avulso' }) {
      const p = PLANOS[plano];
      if (!p?.precos?.mensal) throw new ErroPagamento('Plano inválido.', { codigo: 'plano_invalido' });
      // Crédito automático desativado: novas assinaturas só no avulso. Avisos de
      // assinaturas antigas (recorrente) continuam sendo processados.
      if (forma !== 'avulso') throw new ErroPagamento('Forma de pagamento indisponível.', { codigo: 'forma_invalida' });
      if (!FORMAS.includes(forma)) throw new ErroPagamento('Forma de pagamento inválida.', { codigo: 'forma_invalida' });
      if (organizacao.isento === true) throw new ErroPagamento('Conta isenta: nada a pagar.', { status: 409, codigo: 'conta_isenta' });
      const valor = p.precos.mensal / 100;
      const ref = referencia(organizacao.id, plano, forma);
      const titulo = `Uso LicitaHub ${p.nome} - ${DIAS_POR_PAGAMENTO} dias`;

      if (forma === 'recorrente') {
        const r = await mp('/preapproval', {
          metodo: 'POST',
          corpo: {
            reason: `Uso LicitaHub ${p.nome} (a cada ${DIAS_POR_PAGAMENTO} dias)`,
            external_reference: ref,
            payer_email: usuario.email,
            back_url: `${site}/assinatura/sucesso`,
            auto_recurring: { frequency: DIAS_POR_PAGAMENTO, frequency_type: 'days', transaction_amount: valor, currency_id: 'BRL' },
            status: 'pending',
          },
        });
        await repositorio.salvarAssinatura(organizacao.id, { mp_assinatura_id: r.id, forma, status: 'pending' }).catch(() => {});
        return { url: r.init_point, id: r.id };
      }

      const r = await mp('/checkout/preferences', {
        metodo: 'POST',
        idempotencia: `${ref}|${Date.now()}`,
        corpo: {
          items: [{ id: `licitahub_${plano}`, title: titulo, quantity: 1, unit_price: valor, currency_id: 'BRL' }],
          payer: { email: usuario.email },
          external_reference: ref,
          // Pix (bank_transfer), crédito e débito. Boleto e lotérica ficam de fora.
          payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 },
          back_urls: { success: `${site}/assinatura/sucesso`, pending: `${site}/assinatura/sucesso`, failure: `${site}/precos` },
          auto_return: 'approved',
          notification_url: `${site}/mercadopago/webhook`,
          statement_descriptor: 'LICITAHUB',
        },
      });
      return { url: r.init_point, id: r.id };
    },

    /** Cancela a cobrança automática no cartão (o acesso vale até o fim dos dias já pagos). */
    async cancelar({ organizacao }) {
      const atual = await repositorio.assinatura(organizacao.id);
      if (!atual?.mp_assinatura_id) throw new ErroPagamento('Não há cobrança automática ativa para cancelar.', { status: 404, codigo: 'sem_assinatura' });
      await mp(`/preapproval/${atual.mp_assinatura_id}`, { metodo: 'PUT', corpo: { status: 'cancelled' } });
      await repositorio.salvarAssinatura(organizacao.id, { status: 'cancelled', cancelar_no_fim: true });
      return { cancelado: true, ate: atual.periodo_fim ?? null };
    },

    /** Confere a origem do aviso (quando há segredo configurado). */
    verificarAviso({ xSignature, xRequestId, dataId }) {
      if (!segredoWebhook) return true; // sem segredo: segue, pois tudo é reconsultado na API
      if (!assinaturaValida({ segredo: segredoWebhook, xSignature, xRequestId, dataId })) {
        throw new ErroPagamento('Aviso do Mercado Pago com assinatura inválida.', { status: 400, codigo: 'webhook_invalido' });
      }
      return true;
    },

    /** Trata um aviso: payment (Pix/débito/crédito e cobranças da assinatura) ou preapproval. */
    async processarAviso({ tipo, id }) {
      if (!id) return { ignorado: 'sem_id' };
      if (tipo === 'payment') {
        const pg = await mp(`/v1/payments/${encodeURIComponent(id)}`);
        if (pg.status !== 'approved') return { ignorado: `pagamento_${pg.status}` };
        let ref = lerReferencia(pg.external_reference);
        // Cobrança da assinatura sem referência própria: busca a da assinatura.
        const assinaturaId = pg.metadata?.preapproval_id || pg.point_of_interaction?.transaction_data?.subscription_id;
        if (!ref && assinaturaId) ref = lerReferencia((await mp(`/preapproval/${encodeURIComponent(assinaturaId)}`)).external_reference);
        if (!ref) return { ignorado: 'sem_referencia' };
        const esperado = PLANOS[ref.plano].precos.mensal / 100;
        if (Number(pg.transaction_amount) + 0.001 < esperado) {
          log?.aviso?.(`Mercado Pago: pagamento ${id} com valor menor que o plano (${pg.transaction_amount} < ${esperado}). Ignorado.`);
          return { ignorado: 'valor_menor' };
        }
        return liberar({ ...ref, pagamentoId: pg.id, valor: pg.transaction_amount });
      }
      if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
        const sub = await mp(`/preapproval/${encodeURIComponent(id)}`);
        const ref = lerReferencia(sub.external_reference);
        if (!ref || !(await repositorio.organizacaoExiste(ref.organizacaoId))) return { ignorado: 'sem_organizacao' };
        await repositorio.salvarAssinatura(ref.organizacaoId, {
          mp_assinatura_id: sub.id, forma: 'recorrente', status: sub.status, cancelar_no_fim: sub.status === 'cancelled',
        });
        return { organizacao_id: ref.organizacaoId, status: sub.status };
      }
      return { ignorado: 'tipo_nao_tratado' };
    },
  };
}
