/* =============================================================================
   Uso LicitaHub · Motor do Robô de Lances
   Um só arquivo para o navegador (LH.robo) e para o servidor (src/robo/motor.js).

   Regras (pregão com disputa aberta, menor preço):
   - quando um concorrente fica abaixo do nosso lance, o robô cobre por
     "decremento" (ex.: R$ 0,01, ou o intervalo mínimo exigido no edital);
   - TRAVA: nunca envia lance abaixo do piso (min_floor_price). Se cobrir exigir
     ficar abaixo do piso, o robô PARA, muda o status para "stopped_at_floor" e
     dispara um alerta;
   - nunca envia lance acima do teto (max_price);
   - respeita o intervalo mínimo entre os próprios lances (regra do portal).
   Os valores são calculados em centavos inteiros (sem erro de arredondamento).

   A sala de pregão é uma "peça" separada (adaptador) com:
     proximoEvento() -> Promise<{ tipo: 'lance'|'mensagem'|'encerrada', valor?, autor?, texto? }>
     enviarLance(valor) -> Promise<void>
   Aqui há a SalaSimulada (demonstração e testes). Os portais reais
   (Compras.gov.br etc.) não têm API pública de lances: cada um precisa de um
   adaptador próprio, que ainda não existe.
   ============================================================================= */
(function (raiz) {
  const STATUS = Object.freeze({ PARADO: 'idle', ATIVO: 'running', PAUSADO: 'paused', PISO: 'stopped_at_floor' });
  const centavos = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const reais = (c) => c / 100;

  /** Confere os limites do item. Devolve a lista de problemas (vazia = ok). */
  function validarLimites({ teto, custo, piso, decremento = 0.01 }) {
    const t = centavos(teto); const c = centavos(custo); const p = centavos(piso); const d = centavos(decremento);
    const erros = [];
    if (!t || t <= 0) erros.push('Informe o preço teto (maior que zero).');
    if (!p || p <= 0) erros.push('Informe o preço mínimo de segurança (maior que zero).');
    if (t && p && p > t) erros.push('O preço mínimo não pode ser maior que o preço teto.');
    if (c != null && p && p < c) erros.push('O preço mínimo não pode ficar abaixo do custo do fornecedor.');
    if (!d || d <= 0) erros.push('O decremento precisa ser de pelo menos R$ 0,01.');
    return erros;
  }

  /**
   * Decide o próximo passo. Não envia nada: só calcula.
   * @returns {{acao:'lance', valor:number} | {acao:'aguardar', motivo:string} | {acao:'parar', motivo:'piso'}}
   */
  function decidir({ melhorConcorrente, nossoLance, piso, teto, decremento = 0.01 }) {
    const m = centavos(melhorConcorrente); const n = centavos(nossoLance);
    const p = centavos(piso); const t = centavos(teto); const d = centavos(decremento);
    if (!p || !t || !d || p > t) return { acao: 'parar', motivo: 'limites' };
    // Ninguém deu lance ainda: entra com o teto (o valor da administração).
    if (m == null) return n == null ? { acao: 'lance', valor: reais(t) } : { acao: 'aguardar', motivo: 'sem_concorrente' };
    // Já estamos na frente: não mexe.
    if (n != null && n < m) return { acao: 'aguardar', motivo: 'vencendo' };
    let alvo = Math.min(m - d, t);
    // Não dá para cobrir sem passar do piso: tenta o próprio piso (se ainda cobre), senão para.
    if (alvo < p) {
      if (p < m && (n == null || p < n)) alvo = p;
      else return { acao: 'parar', motivo: 'piso' };
    }
    if (alvo < p) return { acao: 'parar', motivo: 'piso' }; // segunda conferência (nunca abaixo do piso)
    return { acao: 'lance', valor: reais(alvo) };
  }

  /**
   * Uma disputa de um item. Use iniciar(), pausar(), retomar(), parar() e
   * atualizarLimites({ piso, teto }) a qualquer momento.
   * eventos: aoLance(valor), aoConcorrente(valor, autor), aoStatus(status, motivo),
   *          aoAlerta(texto), aoMensagem({ autor, texto, hora })
   */
  class Disputa {
    constructor({ sala, piso, teto, custo = null, decremento = 0.01, intervaloMs = 0, nossoLance = null, agora = () => Date.now(), esperar, ...eventos }) {
      const erros = validarLimites({ teto, custo, piso, decremento });
      if (erros.length) throw new Error(erros[0]);
      Object.assign(this, { sala, piso, teto, custo, decremento, intervaloMs, nossoLance, agora, eventos });
      this.esperar = esperar || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
      this.melhorConcorrente = null;
      this.status = STATUS.PARADO;
      this.ultimoLanceEm = -Infinity;
    }

    mudarStatus(status, motivo) {
      this.status = status;
      this.eventos.aoStatus?.(status, motivo);
    }

    atualizarLimites({ piso = this.piso, teto = this.teto }) {
      const erros = validarLimites({ teto, custo: this.custo, piso, decremento: this.decremento });
      if (erros.length) throw new Error(erros[0]);
      this.piso = piso;
      this.teto = teto;
    }

    async avaliar() {
      if (this.status !== STATUS.ATIVO) return;
      const d = decidir(this);
      if (d.acao === 'parar') {
        this.mudarStatus(STATUS.PISO, d.motivo);
        this.eventos.aoAlerta?.(d.motivo === 'piso'
          ? `Robô parado por segurança: cobrir o lance de ${moeda(this.melhorConcorrente)} exigiria ficar abaixo do piso de ${moeda(this.piso)}.`
          : 'Robô parado: confira o preço teto e o preço mínimo.');
        return;
      }
      if (d.acao !== 'lance') return;
      const falta = this.ultimoLanceEm + this.intervaloMs - this.agora();
      if (falta > 0) await this.esperar(falta);
      if (this.status !== STATUS.ATIVO) return;
      const nova = decidir(this); // a praça pode ter mudado durante a espera
      if (nova.acao !== 'lance') return this.avaliar();
      if (centavos(nova.valor) < centavos(this.piso)) throw new Error('Trava: lance abaixo do piso bloqueado.');
      await this.sala.enviarLance(nova.valor);
      this.nossoLance = nova.valor;
      this.ultimoLanceEm = this.agora();
      this.eventos.aoLance?.(nova.valor);
    }

    async iniciar() {
      if (this.status === STATUS.ATIVO) return;
      this.mudarStatus(STATUS.ATIVO);
      await this.avaliar();
      if (this.rodando) return;
      this.rodando = true;
      try {
        while (this.status !== STATUS.PARADO && this.status !== STATUS.PISO) {
          const ev = await this.sala.proximoEvento();
          if (!ev || ev.tipo === 'encerrada') { if (this.status !== STATUS.PARADO) this.mudarStatus(STATUS.PARADO, 'encerrada'); break; }
          if (ev.tipo === 'mensagem') { this.eventos.aoMensagem?.(ev); continue; }
          if (ev.tipo === 'lance') {
            if (ev.autor === 'nos') continue;
            if (this.melhorConcorrente == null || ev.valor < this.melhorConcorrente) this.melhorConcorrente = ev.valor;
            this.eventos.aoConcorrente?.(ev.valor, ev.autor);
            await this.avaliar();
          }
        }
      } finally {
        this.rodando = false;
      }
    }

    pausar() { if (this.status === STATUS.ATIVO) this.mudarStatus(STATUS.PAUSADO); }
    async retomar() { if (this.status === STATUS.PAUSADO) { this.mudarStatus(STATUS.ATIVO); await this.avaliar(); } }
    parar() { this.mudarStatus(STATUS.PARADO, 'usuario'); this.sala.fechar?.(); }
  }

  const moeda = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

  /** Sala de pregão de mentira: concorrentes dão lances e o pregoeiro manda mensagens. */
  class SalaSimulada {
    constructor({ inicial, minimoConcorrentes, passoMs = 2500, concorrentes = ['Fornecedor 2', 'Fornecedor 5', 'Fornecedor 9'], aleatorio = Math.random, eventos = null } = {}) {
      Object.assign(this, { minimo: minimoConcorrentes, passoMs, concorrentes, aleatorio, fila: eventos ? [...eventos] : null });
      this.praca = inicial;
      this.aberta = true;
      this.mensagens = [
        'Senhores licitantes, a etapa de lances está aberta.',
        'Lembramos que o intervalo mínimo entre lances é o definido no edital.',
        'Item em disputa. Aguardem o encerramento do tempo aleatório.',
      ];
    }

    fechar() { this.aberta = false; }

    async enviarLance(valor) { this.praca = Math.min(this.praca, valor); }

    async proximoEvento() {
      if (!this.aberta) return { tipo: 'encerrada' };
      if (this.fila) return this.fila.shift() || { tipo: 'encerrada' };
      await new Promise((ok) => setTimeout(ok, this.passoMs * (0.6 + this.aleatorio() * 0.8)));
      if (!this.aberta) return { tipo: 'encerrada' };
      const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (this.aleatorio() < 0.2 && this.mensagens.length) {
        return { tipo: 'mensagem', autor: 'Pregoeiro', texto: this.mensagens.shift(), hora };
      }
      // Concorrente cobre a praça por um valor pequeno, até o mínimo dele.
      const reducao = Math.max(0.01, Math.round(this.praca * (0.002 + this.aleatorio() * 0.01) * 100) / 100);
      const valor = Math.round((this.praca - reducao) * 100) / 100;
      if (valor < this.minimo) {
        this.aberta = false;
        return { tipo: 'mensagem', autor: 'Pregoeiro', texto: 'Etapa de lances encerrada para este item.', hora };
      }
      this.praca = valor;
      return { tipo: 'lance', valor, autor: this.concorrentes[Math.floor(this.aleatorio() * this.concorrentes.length)], hora };
    }
  }

  const api = { STATUS, validarLimites, decidir, Disputa, SalaSimulada, centavos };
  raiz.LHRobo = api;
  if (raiz.LH) raiz.LH.robo = api;
}(typeof window !== 'undefined' ? window : globalThis));
