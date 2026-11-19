// BLL Compras (e BNC, mesma plataforma): cadastro de proposta do fornecedor.
// SELETORES AINDA NÃO CONFERIDOS numa sessão real (ver o comentário do comprasnet.js).
(function (raiz) {
  const LHX = raiz.LHX;

  class AdaptadorBll extends LHX.AdaptadorBase {
    id = 'bll';
    nome = 'BLL Compras';
    validado = false;
    casas = 2;
    seletorLinha = 'tr, .item-lote, .itemProposta, .card, .panel';
    pistas = {
      ...this.pistas,
      unitario: /valor\s*unit|unit[aá]rio|vlunit|valorunit|pre[cç]o\s*unit/i,
      marca: /marca|fabricante/i,
      modelo: /modelo/i,
    };

    reconhece(url) {
      return /(^|\.)bllcompras\.com$|(^|\.)bll\.org\.br$|(^|\.)bnccompras\.com$/i.test(new URL(url).hostname);
    }
  }

  LHX.adaptadores = LHX.adaptadores || [];
  if (!LHX.adaptadores.some((a) => a.id === 'bll')) LHX.adaptadores.push(new AdaptadorBll()); // injeção repetida não duplica
}(globalThis));
