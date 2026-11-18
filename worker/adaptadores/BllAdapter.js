// Adaptador da BLL Compras (primeiro portal do modo real).
// Usa o adaptador genérico de Playwright com o mapa de seletores da BLL
// (worker/adaptadores/seletores.js -> SELETORES.bll). O fluxo completo de login,
// entrada na sala, leitura dos lances/fases/chat e envio de lance está pronto;
// falta conferir os seletores da sala numa sessão real e marcar validado: true.
import { AdaptadorPorSeletores } from './playwright.js';
import { SELETORES } from './seletores.js';

export class BllAdapter extends AdaptadorPorSeletores {
  constructor(deps) {
    super({ ...deps, portal: 'bll', seletores: deps.seletores || SELETORES.bll });
  }

  // Na BLL o lote costuma ser escolhido dentro da sala do processo: depois de
  // entrar, seleciona o lote (se o seletor estiver mapeado).
  async joinAuctionRoom({ pregao, lote }) {
    await super.joinAuctionRoom({ pregao, lote });
    const seletorLote = this.sel.sala.lote;
    if (lote && seletorLote) await this.pagina.click(typeof seletorLote === 'function' ? seletorLote(lote) : seletorLote);
  }
}
