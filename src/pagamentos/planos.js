// Planos do LicitaHub: nomes, limites e preços.
//
// Decisão do dono (15/11/2026): UM plano pago, de R$ 97 por mês.
// Os limites ainda são provisórios. Depois de mudar um preço aqui, rode
// `npm run stripe:configurar` para atualizar a Stripe.
//
// Os ids são internos e precisam ser aceitos pela coluna organizacoes.plano do
// banco ('gratuito', 'starter', 'prime', 'pro'). O cliente só vê o "nome".
// Preços em centavos de real; só os ciclos listados em "precos" são vendidos.
// Lembrete de custo: no plano pago do Gemini, um edital longo custa uns US$ 0,26.

export const PLANOS = {
  gratuito: { nome: 'Gratuito', limites: { empresas: 3, analisesMes: 10 }, precos: null },
  starter: { nome: 'Completo', limites: { empresas: 10, analisesMes: 30 }, precos: { mensal: 9_700 } },
};

/** Ciclos de cobrança e o intervalo correspondente na Stripe. */
export const CICLOS = { mensal: 'month', anual: 'year' };

/** Chave fixa do preço na Stripe (lookup_key). Ex.: licitahub_starter_mensal */
export const chavePreco = (plano, ciclo) => `licitahub_${plano}_${ciclo}`;

export const planosPagos = () => Object.keys(PLANOS).filter((id) => PLANOS[id].precos);

/** Descobre plano e ciclo a partir de um preço da Stripe (pela chave ou pelos metadados). */
export function planoDoPreco(preco) {
  const pelaChave = /^licitahub_([a-z]+)_(mensal|anual)$/.exec(preco?.lookup_key ?? '');
  const plano = pelaChave?.[1] ?? preco?.metadata?.plano;
  const ciclo = pelaChave?.[2] ?? preco?.metadata?.ciclo;
  return PLANOS[plano]?.precos && CICLOS[ciclo] ? { plano, ciclo } : null;
}
