// Contrato de todo coletor de licitações.
//
// Um coletor é uma classe que estende BaseCollector e implementa `paginas()`, um
// gerador assíncrono que entrega UMA página por vez. O orquestrador (index.js) grava
// cada página no Supabase antes de pedir a próxima, então a memória usada é sempre a
// de uma página (~50 registros), seja qual for o tamanho da coleta.
//
// Cada item entregue por `paginas()` é um destes dois:
//   { rotulo, pagina, totalPaginas?, registros: RegistroPadrao[] }   página lida
//   { rotulo, pagina, erro: Error }                                  página que falhou
//                                                                    (o orquestrador registra e segue)
// RegistroPadrao está em esquema.js; use registroPadrao() para montar.
//
// Para plugar uma fonte nova:
//   1. copie diarioOficialTemplate.js para src/services/collectors/<fonte>.js;
//   2. implemente paginas() e normalizar();
//   3. registre a classe em index.js (COLETORES) e marque `validado = true`
//      só depois de conferir uma coleta real em modo --simular.

export class BaseCollector {
  /** Identificador gravado em licitacoes.fonte (minúsculas, números e _). */
  static fonte = 'base';
  /** Nome legível nos logs. */
  static nome = 'Coletor base';
  /** Só coletores validados rodam no agendamento (os outros só pelo CLI, com --permitir-nao-validado). */
  static validado = false;

  /**
   * @param {{ log: ReturnType<typeof import('./log.js').criarLogEstruturado>, config?: object }} deps
   */
  constructor({ log, config = {} } = {}) {
    this.log = log;
    this.config = config;
  }

  get fonte() { return this.constructor.fonte; }
  get nome() { return this.constructor.nome; }

  /**
   * @param {{ desde: string, ate: string, ufs: string[]|null, modalidades?: number[]|null,
   *   modo?: string, maxPaginas?: number }} opcoes  datas em AAAA-MM-DD
   * @param {{ sinal?: AbortSignal }} ctx
   * @returns {AsyncGenerator<{ rotulo: string, pagina: number, totalPaginas?: number, registros?: object[], erro?: Error }>}
   */
  // eslint-disable-next-line require-yield
  async *paginas(opcoes, ctx) {
    throw new Error(`${this.nome}: paginas() não implementado.`);
  }

  /** Converte um registro bruto da fonte em RegistroPadrao (ou null para descartar). */
  normalizar(_bruto) {
    throw new Error(`${this.nome}: normalizar() não implementado.`);
  }
}
