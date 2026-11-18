// Interface base dos adaptadores de portal (Strategy Pattern).
//
// Cada portal (BLL, Compras.gov.br, Licitanet...) tem um adaptador com os
// mesmos métodos. O resto do sistema (sessão, motor de lances, API) só fala com
// esta interface e não sabe nada do HTML de cada portal.
//
//   abrir()                       sobe o navegador (Playwright)
//   login()                       entra com a credencial do cofre (senha ou A1)
//   joinAuctionRoom({ pregao, lote })   abre a sala de disputa do pregão/lote
//   lerSala()                     foto da sala agora: { fase, fimEm, lances[], mensagens[] }
//   watchBids(callback)           acompanha a sala; chama callback(evento) a cada novidade
//                                 e devolve uma função para parar de acompanhar
//   placeBid(valor)               envia UM lance (valor unitário, em reais)
//   close()                       fecha tudo
//
// Eventos do watchBids (mesmo formato da sala simulada do motor):
//   { tipo: 'lance', valor, autor, porte: 'me'|'epp'|'demais', nosso: boolean, hora }
//   { tipo: 'fase', fase: 'aberta'|'prorrogacao'|'desempate'|'negociacao'|'habilitacao'|'encerrada', fimEm? }
//   { tipo: 'mensagem', autor, texto, hora }
//   { tipo: 'erro', texto }

export class ErroAdaptador extends Error {
  /**
   * @param {string} mensagem  texto para o operador
   * @param {string} codigo    login | sala | lance | seletores_pendentes | sem_navegador | somente_monitorar | trava
   */
  constructor(mensagem, codigo = 'adaptador', detalhes = null) {
    super(mensagem);
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export class PortalAdapter {
  /** @param {{ portal: string, credencial: object, log?: object }} deps */
  constructor({ portal, credencial, log = console }) {
    this.portal = portal;
    this.credencial = credencial;
    this.log = log;
  }

  async abrir() {}
  async login() { throw new ErroAdaptador(`login() não implementado para ${this.portal}.`); }
  // eslint-disable-next-line no-unused-vars
  async joinAuctionRoom(ref) { throw new ErroAdaptador(`joinAuctionRoom() não implementado para ${this.portal}.`); }
  async lerSala() { throw new ErroAdaptador(`lerSala() não implementado para ${this.portal}.`); }
  // eslint-disable-next-line no-unused-vars
  watchBids(callback) { throw new ErroAdaptador(`watchBids() não implementado para ${this.portal}.`); }
  // eslint-disable-next-line no-unused-vars
  async placeBid(valor) { throw new ErroAdaptador(`placeBid() não implementado para ${this.portal}.`); }
  async close() {}
}
