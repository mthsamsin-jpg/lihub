// Compras.gov.br (Comprasnet): cadastro/ajuste de proposta do fornecedor.
// SELETORES AINDA NÃO CONFERIDOS numa sessão real: o adaptador usa a leitura genérica
// com as pistas dos rótulos que o portal costuma usar ("Valor unitário", "Marca",
// "Fabricante", "Modelo / Versão", "Descrição detalhada do objeto ofertado").
// Para validar: abra a tela de itens da proposta, use "Mapear campos" no popup e ajuste
// seletorLinha/pistas abaixo com o que aparecer no console.
(function (raiz) {
  const LHX = raiz.LHX;

  class AdaptadorComprasnet extends LHX.AdaptadorBase {
    id = 'comprasnet';
    nome = 'Compras.gov.br';
    validado = false;
    casas = 4; // o portal aceita até 4 casas no valor unitário
    seletorLinha = 'tr, [role="row"], app-item-proposta, .item-proposta, .card, .p-card';
    pistas = {
      ...this.pistas,
      unitario: /valor\s*unit|unit[aá]rio|valorunitario|vlunitario|valor\s*ofertado/i,
      descricao: /descri[cç][aã]o\s*detalhada|especifica|objeto\s*ofertado/i,
    };

    reconhece(url) {
      return /(^|\.)compras\.gov\.br$|(^|\.)comprasnet\.gov\.br$|cnetmobile\.estaleiro\.serpro\.gov\.br$/i.test(new URL(url).hostname);
    }
  }

  LHX.adaptadores = LHX.adaptadores || [];
  if (!LHX.adaptadores.some((a) => a.id === 'comprasnet')) LHX.adaptadores.push(new AdaptadorComprasnet()); // injeção repetida não duplica
}(globalThis));
