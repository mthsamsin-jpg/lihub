// Registro dos adaptadores: portal -> classe. Portais sem classe própria usam o
// adaptador genérico com os seletores do mapa (que ainda precisam ser preenchidos).
import { BllAdapter } from './BllAdapter.js';
import { AdaptadorPorSeletores } from './playwright.js';
import { SELETORES, camposPendentes } from './seletores.js';

const CLASSES = { bll: BllAdapter };

export function criarAdaptador(portal, deps) {
  const Classe = CLASSES[portal];
  if (Classe) return new Classe(deps);
  return new AdaptadorPorSeletores({ ...deps, portal, seletores: SELETORES[portal] || SELETORES.comprasnet });
}

/** Situação de cada portal para a tela: implementado, validado e o que falta mapear. */
export function situacaoDosPortais() {
  return Object.fromEntries(Object.entries(SELETORES).map(([portal, sel]) => [portal, {
    adaptador: CLASSES[portal] ? CLASSES[portal].name : 'AdaptadorPorSeletores',
    validado: !!sel.validado,
    pendentes: camposPendentes(sel),
  }]));
}
