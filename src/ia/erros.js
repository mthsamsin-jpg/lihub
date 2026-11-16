// Erro com mensagem amigável (em português) e status HTTP sugerido.
export class ErroAnalise extends Error {
  /**
   * @param {string} mensagem
   * @param {{ codigo?: string, status?: number, detalhes?: any, causa?: unknown }} [opcoes]
   */
  constructor(mensagem, { codigo = 'erro', status = 500, detalhes = null, causa } = {}) {
    super(mensagem, causa ? { cause: causa } : undefined);
    this.name = 'ErroAnalise';
    this.codigo = codigo;
    this.status = status;
    this.detalhes = detalhes;
  }
}
