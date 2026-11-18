// Planos do Uso LicitaHub: nomes, limites e preços.
//
// Free, Pro (R$ 97/mês) e Max (R$ 197/mês, com o Robô Turbo 2.0).
// Cobrança pelo Mercado Pago (src/pagamentos/mercadopago.js): o preço sai daqui.
//
// Os ids são internos e precisam ser aceitos pela coluna organizacoes.plano do
// banco ('gratuito', 'starter', 'prime', 'pro', 'max'). O cliente só vê o "nome".
// Preços em centavos de real; só os ciclos listados em "precos" são vendidos.
// Lembrete de custo: no plano pago do Gemini, um edital longo custa uns US$ 0,26.

export const PLANOS = {
  gratuito: { nome: 'Gratuito', limites: { empresas: 3, analisesMes: 10 }, precos: null },
  // Pro: Prospecção + todo o resto, menos o Robô Turbo 2.0 (id 'starter' mantido: quem já assina continua).
  starter: { nome: 'Pro', limites: { empresas: 10, analisesMes: 30 }, precos: { mensal: 9_700 } },
  // Max: tudo, incluindo o Robô Turbo 2.0.
  max: { nome: 'Max', limites: { empresas: 20, analisesMes: 60 }, precos: { mensal: 19_700 } },
};

export const planosPagos = () => Object.keys(PLANOS).filter((id) => PLANOS[id].precos);
