// =============================================================================
// Uso LicitaHub · Assinaturas pelo Mercado Pago (único meio de pagamento)
//
// Assinatura NO CARTÃO DE CRÉDITO com cobrança automática (preapproval do MP):
//   - o cliente cadastra o cartão na página do Mercado Pago (o servidor nunca vê o cartão);
//   - o MP cobra sozinho a cada ciclo (ASSINATURA_CICLO_DIAS, padrão 30 dias);
//   - cada cobrança aprovada abre um ciclo novo (src/pagamentos/ciclo.js):
//     plataforma o ciclo inteiro + Robô Turbo 2.0 (Max) nos primeiros ASSINATURA_ROBO_DIAS dias;
//   - cobrança recusada: fica registrada (status_pagamento, falhas_pagamento); o MP tenta de
//     novo sozinho; sem pagamento, o acesso termina no fim do ciclo pago (plano_ate);
//   - cancelamento: para as cobranças; o acesso vale até o fim do ciclo já pago.
// O pagamento avulso (Pix/débito) não é mais vendido. Avisos de pagamentos avulsos
// antigos continuam sendo honrados (quem pagou recebe o que pagou).
//
// Segurança:
//   - O aviso (webhook) só diz "algo mudou": o servidor SEMPRE consulta o pagamento na
//     API do Mercado Pago com o token secreto antes de liberar. Com MP_WEBHOOK_SECRET
//     definido, a assinatura x-signature também é conferida.
//   - Cada pagamento é processado uma vez só (avisos repetidos são ignorados).
//   - Conta isenta (organizacoes.isento) nunca é cobrada.
// =============================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PLANOS } from './planos.js';
import { configCiclo, novoCiclo } from './ciclo.js';

export class ErroPagamento extends Error {
  constructor(mensagem, { status = 400, codigo = 'pagamento_invalido' } = {}) {
    super(mensagem);
    this.name = 'ErroPagamento';
    this.status = status;
    this.codigo = codigo;
  }
}

const API = 'https://api.mercadopago.com';
export const FORMAS = ['avulso', 'recorrente'];
/** Formas vendidas hoje (novas assinaturas). 'avulso' só é aceito nos avisos antigos. */
export const FORMAS_A_VENDA = ['recorrente'];

/** "teste" (credencial TEST-...) ou "real" (APP_USR-...). */
export const modoDoToken = (token) => (/^TEST-/.test(token ?? '') ? 'teste' : /^APP_USR-/.test(token ?? '') ? 'real' : null);

/** external_reference: "org|plano|forma" (ida e volta). */
export const referencia = (org, plano, forma) => `${org}|${plano}|${forma}`;
export function lerReferencia(ref) {
  const [organizacaoId, plano, forma] = String(ref ?? '').split('|');
  if (!/^[0-9a-f-]{36}$/i.test(organizacaoId || '') || !PLANOS[plano]?.precos || !FORMAS.includes(forma)) return null;
  return { organizacaoId, plano, forma };
}

/** Frequência da cobrança no Mercado Pago: 30 dias = 1 mês (fatura mais clara); senão, em dias. */
export function frequenciaMp(cicloDias) {
  return cicloDias === 30 ? { frequency: 1, frequency_type: 'months' } : { frequency: cicloDias, frequency_type: 'days' };
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
export function criarPagamentos({ token, segredoWebhook = null, urlSite, repositorio, log, fetch: buscar = fetch, ciclo = configCiclo(), agora = () => new Date() }) {
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

  /** Abre um ciclo novo (plataforma + janela do robô), uma vez por pagamento. */
  async function liberar({ organizacaoId, plano, forma, pagamentoId, valor }) {
    if (!(await repositorio.organizacaoExiste(organizacaoId))) return { ignorado: 'sem_organizacao' };
    const atual = await repositorio.assinatura(organizacaoId);
    const vistos = String(atual?.mp_pagamentos ?? '').split(',').filter(Boolean);
    if (vistos.includes(String(pagamentoId))) return { ignorado: 'ja_processado' };
    // Renovação do mesmo plano antes do fim: emenda no ciclo atual. Troca de plano: começa agora.
    const c = novoCiclo({ fimAtual: atual?.periodo_fim, mesmoPlano: atual?.plano === plano, agora: agora(), config: ciclo });
    await repositorio.salvarAssinatura(organizacaoId, {
      plano, ciclo: 'mensal', status: forma === 'recorrente' ? 'authorized' : 'active', periodo_fim: c.fim, forma,
      ciclo_inicio: c.inicio, robo_de: c.roboDe, robo_ate: c.roboAte,
      status_pagamento: 'approved', ultimo_pagamento_em: agora().toISOString(), falhas_pagamento: 0,
      mp_pagamentos: [String(pagamentoId), ...vistos].slice(0, 50).join(','),
    });
    await repositorio.aplicarPlano(organizacaoId, plano, PLANOS[plano].limites, c.fim, { ciclo_inicio: c.inicio, robo_de: c.roboDe, robo_ate: c.roboAte });
    log?.info?.(`Mercado Pago: pagamento ${pagamentoId} aprovado (R$ ${valor}) -> ${plano}: ciclo até ${c.fim.slice(0, 10)}, robô até ${c.roboAte.slice(0, 10)}.`);
    return { organizacao_id: organizacaoId, plano, ate: c.fim, robo_ate: c.roboAte };
  }

  /** Cobrança recusada/cancelada: registra (o acesso segue até o fim do ciclo já pago). */
  async function registrarFalha({ organizacaoId, pagamentoId, status }) {
    if (!(await repositorio.organizacaoExiste(organizacaoId))) return { ignorado: 'sem_organizacao' };
    const atual = await repositorio.assinatura(organizacaoId);
    const vistos = String(atual?.mp_pagamentos ?? '').split(',').filter(Boolean);
    const chave = `x${pagamentoId}`; // falhas também só contam uma vez
    if (vistos.includes(chave)) return { ignorado: 'ja_processado' };
    await repositorio.salvarAssinatura(organizacaoId, {
      status_pagamento: status, falhas_pagamento: Number(atual?.falhas_pagamento || 0) + 1,
      mp_pagamentos: [chave, ...vistos].slice(0, 50).join(','),
    });
    log?.aviso?.(`Mercado Pago: cobrança ${pagamentoId} ${status} (organização ${organizacaoId}).`);
    return { organizacao_id: organizacaoId, falha: status };
  }

  /** Referência (org|plano|forma) de um pagamento: a própria ou a da assinatura dele. */
  async function referenciaDoPagamento(pg) {
    let ref = lerReferencia(pg.external_reference);
    const assinaturaId = pg.metadata?.preapproval_id || pg.point_of_interaction?.transaction_data?.subscription_id;
    if (!ref && assinaturaId) ref = lerReferencia((await mp(`/preapproval/${encodeURIComponent(assinaturaId)}`)).external_reference);
    return ref;
  }

  async function tratarPagamento(id) {
    const pg = await mp(`/v1/payments/${encodeURIComponent(id)}`);
    const ref = await referenciaDoPagamento(pg);
    if (!ref) return { ignorado: 'sem_referencia' };
    if (['rejected', 'cancelled'].includes(pg.status) && ref.forma === 'recorrente') {
      return registrarFalha({ organizacaoId: ref.organizacaoId, pagamentoId: pg.id, status: pg.status });
    }
    if (pg.status !== 'approved') return { ignorado: `pagamento_${pg.status}` };
    const esperado = PLANOS[ref.plano].precos.mensal / 100;
    if (Number(pg.transaction_amount) + 0.001 < esperado) {
      log?.aviso?.(`Mercado Pago: pagamento ${id} com valor menor que o plano (${pg.transaction_amount} < ${esperado}). Ignorado.`);
      return { ignorado: 'valor_menor' };
    }
    return liberar({ ...ref, pagamentoId: pg.id, valor: pg.transaction_amount });
  }

  return {
    ciclo,

    /** Página do Mercado Pago para cadastrar o cartão e assinar (cobrança automática a cada ciclo). */
    async criarCheckout({ organizacao, usuario, plano, forma = 'recorrente' }) {
      const p = PLANOS[plano];
      if (!p?.precos?.mensal) throw new ErroPagamento('Plano inválido.', { codigo: 'plano_invalido' });
      if (!FORMAS_A_VENDA.includes(forma)) throw new ErroPagamento('A assinatura é só no cartão de crédito, com renovação automática.', { codigo: 'forma_invalida' });
      if (organizacao.isento === true) throw new ErroPagamento('Conta isenta: nada a pagar.', { status: 409, codigo: 'conta_isenta' });
      const atual = await repositorio.assinatura(organizacao.id).catch(() => null);
      if (atual?.forma === 'recorrente' && atual?.status === 'authorized' && atual?.plano === plano
        && atual?.periodo_fim && new Date(atual.periodo_fim) > agora()) {
        throw new ErroPagamento('Você já tem esta assinatura ativa no cartão.', { status: 409, codigo: 'ja_assinante' });
      }
      const valor = p.precos.mensal / 100;
      const r = await mp('/preapproval', {
        metodo: 'POST',
        corpo: {
          reason: `Uso LicitaHub ${p.nome} (renova a cada ${ciclo.cicloDias} dias)`,
          external_reference: referencia(organizacao.id, plano, 'recorrente'),
          payer_email: usuario.email,
          back_url: `${site}/assinatura/sucesso`,
          auto_recurring: { ...frequenciaMp(ciclo.cicloDias), transaction_amount: valor, currency_id: 'BRL' },
          status: 'pending',
        },
      });
      await repositorio.salvarAssinatura(organizacao.id, { mp_assinatura_id: r.id, forma: 'recorrente', status: 'pending' }).catch(() => {});
      return { url: r.init_point, id: r.id };
    },

    /** Cancela a cobrança automática no cartão (o acesso vale até o fim do ciclo já pago). */
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

    /**
     * Trata um aviso do Mercado Pago:
     *   payment                           pagamento (aprovado abre ciclo; recusado registra falha)
     *   subscription_authorized_payment   cobrança da assinatura (aponta para o pagamento)
     *   subscription_preapproval          a assinatura mudou (authorized, paused, cancelled)
     */
    async processarAviso({ tipo, id }) {
      if (!id) return { ignorado: 'sem_id' };
      if (tipo === 'payment') return tratarPagamento(id);
      if (tipo === 'subscription_authorized_payment' || tipo === 'authorized_payment') {
        const cobranca = await mp(`/authorized_payments/${encodeURIComponent(id)}`);
        const pagamentoId = cobranca.payment?.id;
        if (pagamentoId) return tratarPagamento(pagamentoId);
        if (['rejected', 'cancelled', 'recycling'].includes(cobranca.status) && cobranca.preapproval_id) {
          const ref = lerReferencia((await mp(`/preapproval/${encodeURIComponent(cobranca.preapproval_id)}`)).external_reference);
          if (ref) return registrarFalha({ organizacaoId: ref.organizacaoId, pagamentoId: `c${cobranca.id}`, status: cobranca.status === 'recycling' ? 'rejected' : cobranca.status });
        }
        return { ignorado: `cobranca_${cobranca.status}` };
      }
      if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
        const sub = await mp(`/preapproval/${encodeURIComponent(id)}`);
        const ref = lerReferencia(sub.external_reference);
        if (!ref || !(await repositorio.organizacaoExiste(ref.organizacaoId))) return { ignorado: 'sem_organizacao' };
        await repositorio.salvarAssinatura(ref.organizacaoId, {
          mp_assinatura_id: sub.id, forma: 'recorrente', status: sub.status, cancelar_no_fim: sub.status === 'cancelled',
          ...(sub.next_payment_date ? { proxima_cobranca: sub.next_payment_date } : {}),
        });
        return { organizacao_id: ref.organizacaoId, status: sub.status };
      }
      return { ignorado: 'tipo_nao_tratado' };
    },
  };
}
