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
  // Fases do pregão (modo de disputa aberto). O robô só dá lances em ABERTA e PRORROGACAO.
  const FASES = Object.freeze({
    ABERTA: 'aberta', PRORROGACAO: 'prorrogacao', DESEMPATE: 'desempate',
    NEGOCIACAO: 'negociacao', HABILITACAO: 'habilitacao', ENCERRADA: 'encerrada',
  });
  const FASES_DE_LANCE = [FASES.ABERTA, FASES.PRORROGACAO];
  const ehFaseDeLance = (fase) => fase == null || FASES_DE_LANCE.includes(fase);
  // LC 123/2006, art. 44 §2º: no pregão, há empate ficto quando a ME/EPP fica até 5% acima
  // do melhor lance de uma empresa que não é ME/EPP. A ME/EPP pode então cobrir (art. 45).
  const MARGEM_LC123 = 5; // %
  const ehMeEpp = (porte) => porte === 'me' || porte === 'epp';
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
  function decidir({ melhorConcorrente, nossoLance, piso, teto, decremento = 0.01, fase = null, nossoPorte = 'demais', melhorMeEpp = null, fugirEmpate = false }) {
    const m = centavos(melhorConcorrente); const n = centavos(nossoLance);
    const p = centavos(piso); const t = centavos(teto); const d = centavos(decremento);
    if (!p || !t || !d || p > t) return { acao: 'parar', motivo: 'limites' };
    // Fora da etapa de lances (desempate, negociação, habilitação): o robô só acompanha.
    if (!ehFaseDeLance(fase)) return { acao: 'aguardar', motivo: 'fase' };
    // Na frente, mas uma ME/EPP está na faixa de 5%: ela poderá cobrir no desempate.
    // Com "fugirEmpate", o robô desce só o necessário para sair da faixa, se o piso permitir.
    if (n != null && (m == null || n < m) && fugirEmpate && !ehMeEpp(nossoPorte)) {
      const me = centavos(melhorMeEpp);
      if (me != null && me * 100 <= n * (100 + MARGEM_LC123)) {
        const fora = Math.ceil((me * 100) / (100 + MARGEM_LC123)) - 1; // fora * 1,05 < me
        if (fora >= p && fora < n) return { acao: 'lance', valor: reais(fora), motivo: 'fuga_empate' };
        return { acao: 'aguardar', motivo: 'empate_inevitavel' };
      }
    }
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

  /** Ordena os lances do menor para o maior: [{ autor, valor, porte, posicao }]. */
  function ordenarRanking(lances) {
    return [...lances].filter((l) => l.valor != null)
      .sort((a, b) => centavos(a.valor) - centavos(b.valor))
      .map((l, i) => ({ ...l, posicao: i + 1 }));
  }

  /**
   * Situação da LC 123 no ranking: quem lidera, se há empate ficto e qual ME/EPP pode cobrir.
   * @returns {{ empate:boolean, lider?:object, beneficiada?:object, limite?:number, faixa:Set<string> }}
   */
  function preferenciaLC123(ranking) {
    const r = ordenarRanking(ranking);
    const lider = r[0];
    if (!lider || ehMeEpp(lider.porte)) return { empate: false, lider, faixa: new Set() };
    const limiteC = Math.floor((centavos(lider.valor) * (100 + MARGEM_LC123)) / 100);
    const naFaixa = r.slice(1).filter((x) => ehMeEpp(x.porte) && centavos(x.valor) <= limiteC);
    return { empate: naFaixa.length > 0, lider, beneficiada: naFaixa[0], limite: reais(limiteC), faixa: new Set(naFaixa.map((x) => x.autor)) };
  }

  /**
   * Uma disputa de um item. Use iniciar(), pausar(), retomar(), parar() e
   * atualizarLimites({ piso, teto }) a qualquer momento.
   * eventos: aoLance(valor), aoConcorrente(valor, autor), aoStatus(status, motivo),
   *          aoAlerta(texto), aoMensagem({ autor, texto, hora })
   */
  class Disputa {
    constructor({ sala, piso, teto, custo = null, decremento = 0.01, intervaloMs = 0, nossoLance = null, nossoPorte = 'demais', fugirEmpate = false, agora = () => Date.now(), esperar, ...eventos }) {
      const erros = validarLimites({ teto, custo, piso, decremento });
      if (erros.length) throw new Error(erros[0]);
      Object.assign(this, { sala, piso, teto, custo, decremento, intervaloMs, nossoLance, nossoPorte, fugirEmpate, agora, eventos });
      this.esperar = esperar || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
      this.melhorConcorrente = null;
      this.melhorMeEpp = null;
      this.fase = FASES.ABERTA;
      this.lances = new Map(); // autor -> { autor, valor, porte } (o menor lance de cada um)
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

    /** Ranking da praça, com o nosso lance como autor "nos". */
    ranking() {
      const todos = [...this.lances.values()];
      if (this.nossoLance != null) todos.push({ autor: 'nos', valor: this.nossoLance, porte: this.nossoPorte });
      return ordenarRanking(todos);
    }

    registrarConcorrente(autor, valor, porte = 'demais') {
      const atual = this.lances.get(autor);
      if (!atual || valor < atual.valor) this.lances.set(autor, { autor, valor, porte });
      if (this.melhorConcorrente == null || valor < this.melhorConcorrente) this.melhorConcorrente = valor;
      if (ehMeEpp(porte) && (this.melhorMeEpp == null || valor < this.melhorMeEpp)) this.melhorMeEpp = valor;
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
      if (d.acao !== 'lance') {
        if (d.motivo === 'empate_inevitavel' && this.avisoEmpate !== this.melhorMeEpp) {
          this.avisoEmpate = this.melhorMeEpp;
          this.eventos.aoAviso?.(`Uma ME/EPP está a até ${MARGEM_LC123}% do nosso lance e o piso não permite sair da faixa: ela poderá cobrir no desempate.`);
        }
        return;
      }
      const falta = this.ultimoLanceEm + this.intervaloMs - this.agora();
      if (falta > 0) await this.esperar(falta);
      if (this.status !== STATUS.ATIVO) return;
      const nova = decidir(this); // a praça pode ter mudado durante a espera
      if (nova.acao !== 'lance') return this.avaliar();
      if (centavos(nova.valor) < centavos(this.piso)) throw new Error('Trava: lance abaixo do piso bloqueado.');
      try {
        await this.sala.enviarLance(nova.valor);
      } catch (e) {
        // Recusa normal do portal (ex.: a praça mudou entre a decisão e o envio): não muda
        // o nosso lance e espera o próximo evento da sala para decidir de novo.
        if (!e?.recuperavel) throw e;
        this.ultimoLanceEm = this.agora();
        this.eventos.aoRecusa?.(e.message, nova.valor);
        return;
      }
      this.nossoLance = nova.valor;
      this.ultimoLanceEm = this.agora();
      this.eventos.aoLance?.(nova.valor, nova.motivo);
      // Depois de cobrir, confere na hora se ficamos na faixa de 5% de uma ME/EPP
      // (sem esperar o próximo lance da praça). O intervalo mínimo continua valendo.
      if (this.fugirEmpate && nova.motivo !== 'fuga_empate') {
        const prox = decidir(this);
        if (prox.acao === 'lance' && prox.motivo === 'fuga_empate') await this.avaliar();
      }
    }

    async iniciar() {
      if (this.status === STATUS.ATIVO) return;
      this.mudarStatus(STATUS.ATIVO);
      await this.avaliar();
      if (this.rodando) return;
      this.rodando = true;
      try {
        // Parado no piso, o robô não dá mais lances, mas continua acompanhando a sala
        // (desempate, negociação, habilitação) até ela encerrar.
        while (this.status !== STATUS.PARADO) {
          const ev = await this.sala.proximoEvento();
          if (!ev || ev.tipo === 'encerrada') {
            if (this.status === STATUS.PISO) this.eventos.aoEncerrada?.();
            else this.mudarStatus(STATUS.PARADO, 'encerrada');
            break;
          }
          if (ev.tipo === 'mensagem') { this.eventos.aoMensagem?.(ev); continue; }
          if (ev.tipo === 'fase') {
            this.fase = ev.fase;
            this.eventos.aoFase?.(ev.fase, ev);
            if (ehFaseDeLance(ev.fase)) await this.avaliar();
            continue;
          }
          if (ev.tipo === 'lance') {
            if (ev.autor === 'nos') continue;
            this.registrarConcorrente(ev.autor, ev.valor, ev.porte);
            this.eventos.aoConcorrente?.(ev.valor, ev.autor, ev.porte);
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

  /**
   * Sala de pregão de mentira, no modo de disputa ABERTO:
   *   aberta (tempo fixo) -> prorrogação automática (cada lance nos últimos instantes
   *   estende o prazo) -> desempate ME/EPP (LC 123) -> negociação -> habilitação -> encerrada.
   * Os tempos são acelerados. Com "eventos" (lista fixa), só devolve a lista (testes).
   */
  const CONCORRENTES_PADRAO = [
    { autor: 'Fornecedor 2', porte: 'demais' },
    { autor: 'Fornecedor 5', porte: 'me' },
    { autor: 'Fornecedor 9', porte: 'epp' },
    { autor: 'Fornecedor 12', porte: 'demais' },
  ];

  class SalaSimulada {
    constructor({
      inicial, minimoConcorrentes, passoMs = 2500, passoMinMs = null, passoMaxMs = null, aleatorio = Math.random, eventos = null,
      concorrentes = CONCORRENTES_PADRAO, abertaMs = 45000, prorrogacaoMs = 12000, etapaMs = 4000, agora = () => Date.now(),
    } = {}) {
      Object.assign(this, { passoMs, passoMinMs, passoMaxMs, aleatorio, abertaMs, prorrogacaoMs, etapaMs, agora, fila: eventos ? [...eventos] : null });
      // Cada concorrente tem o próprio mínimo, perto do mínimo geral da simulação.
      this.concorrentes = concorrentes.map((c) => (typeof c === 'string' ? { autor: c, porte: 'demais' } : { ...c }))
        .map((c) => ({ ...c, minimo: Math.round(minimoConcorrentes * (1 + aleatorio() * 0.035) * 100) / 100 }));
      this.praca = inicial;
      this.melhores = new Map(); // autor -> { autor, valor, porte }
      this.aberta = true;
      this.fase = null;
      this.fimEm = null;
      this.pendentes = [];
      this.mensagens = [
        'Senhores licitantes, a etapa de lances está aberta.',
        'Lembramos que o intervalo mínimo entre lances é o definido no edital.',
      ];
    }

    fechar() { this.aberta = false; }

    async enviarLance(valor) {
      if (!this.emLances()) return;
      this.praca = Math.min(this.praca, valor);
      this.registrar('nos', valor, 'nos');
      this.prorrogarSeNoFim();
    }

    emLances() { return this.fase === FASES.ABERTA || this.fase === FASES.PRORROGACAO; }
    hora() { return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
    registrar(autor, valor, porte) {
      const atual = this.melhores.get(autor);
      if (!atual || valor < atual.valor) this.melhores.set(autor, { autor, valor, porte });
    }
    // Lance nos últimos instantes: o prazo é estendido (prorrogação automática).
    prorrogarSeNoFim() {
      if (this.fimEm - this.agora() > this.prorrogacaoMs) return;
      this.fimEm = this.agora() + this.prorrogacaoMs;
      const mudou = this.fase !== FASES.PRORROGACAO;
      this.fase = FASES.PRORROGACAO;
      this.pendentes.push({ tipo: 'fase', fase: FASES.PRORROGACAO, fimEm: this.fimEm, hora: this.hora() });
      if (mudou) this.pendentes.push({ tipo: 'mensagem', autor: 'Sistema', texto: 'Lance nos últimos instantes: prorrogação automática iniciada.', hora: this.hora() });
    }
    fase_(fase, texto, extra = {}) {
      this.fase = fase;
      this.pendentes.push({ tipo: 'fase', fase, hora: this.hora(), ...extra });
      if (texto) this.pendentes.push({ tipo: 'mensagem', autor: 'Pregoeiro', texto, hora: this.hora() });
    }

    /** Fim da etapa de lances: aplica a LC 123 e segue para negociação e habilitação. */
    encerrarLances() {
      const ranking = ordenarRanking([...this.melhores.values()].map((x) => ({ ...x, porte: x.porte === 'nos' ? 'demais' : x.porte })));
      const pref = preferenciaLC123(ranking);
      this.fase_(FASES.DESEMPATE, pref.empate
        ? `Etapa de lances encerrada. Empate ficto (LC 123): ${pref.beneficiada.autor} pode cobrir o melhor lance.`
        : 'Etapa de lances encerrada. Não há empate ficto de ME/EPP.');
      if (pref.empate && pref.beneficiada.autor !== 'nos') {
        const me = this.concorrentes.find((c) => c.autor === pref.beneficiada.autor);
        const valor = Math.round((pref.lider.valor - 0.01) * 100) / 100;
        // A ME/EPP só cobre se o preço ainda vale a pena para ela (até ~3% abaixo do mínimo dela).
        if (me && valor >= me.minimo * 0.97) {
          this.registrar(me.autor, valor, me.porte);
          this.pendentes.push({ tipo: 'lance', valor, autor: me.autor, porte: me.porte, hora: this.hora(), desempate: true });
          this.pendentes.push({ tipo: 'mensagem', autor: 'Sistema', texto: `${me.autor} exerceu o direito de preferência e cobriu o melhor lance.`, hora: this.hora() });
        } else {
          this.pendentes.push({ tipo: 'mensagem', autor: 'Sistema', texto: `${pref.beneficiada.autor} não exerceu o direito de preferência.`, hora: this.hora() });
        }
      }
      this.depois = [
        () => {
          const lider = ordenarRanking([...this.melhores.values()])[0];
          this.fase_(FASES.NEGOCIACAO, lider?.autor === 'nos'
            ? 'Senhor fornecedor arrematante, é possível reduzir o valor ofertado? Envie a contraproposta pelo chat.'
            : `Negociação aberta com ${lider?.autor ?? 'o arrematante'}.`);
        },
        () => this.fase_(FASES.HABILITACAO, 'Convoco o arrematante a enviar os documentos de habilitação e a proposta ajustada no prazo do edital.'),
        () => { this.fase_(FASES.ENCERRADA, 'Sessão encerrada para este item.'); this.aberta = false; },
      ];
    }

    async proximoEvento() {
      if (this.fila) return this.fila.shift() || { tipo: 'encerrada' };
      if (this.pendentes.length) return this.pendentes.shift();
      if (!this.aberta) return { tipo: 'encerrada' };
      if (this.fase == null) {
        this.fimEm = this.agora() + this.abertaMs;
        this.fase_(FASES.ABERTA, this.mensagens.shift(), { fimEm: this.fimEm });
        return this.pendentes.shift();
      }
      if (!this.emLances()) {
        await new Promise((ok) => setTimeout(ok, this.etapaMs));
        if (!this.aberta) return { tipo: 'encerrada' };
        this.depois?.shift()?.();
        return this.pendentes.shift() || { tipo: 'tique' };
      }
      const falta = this.fimEm - this.agora();
      if (falta <= 0) { this.encerrarLances(); return this.pendentes.shift(); }
      const passo = this.passoMinMs != null
        ? this.passoMinMs + this.aleatorio() * ((this.passoMaxMs ?? this.passoMinMs) - this.passoMinMs)
        : this.passoMs * (0.6 + this.aleatorio() * 0.8);
      await new Promise((ok) => setTimeout(ok, Math.min(falta, passo)));
      if (!this.aberta) return { tipo: 'encerrada' };
      if (this.pendentes.length) return this.pendentes.shift();
      if (this.agora() >= this.fimEm) return { tipo: 'tique' };
      if (this.aleatorio() < 0.12 && this.mensagens.length) {
        return { tipo: 'mensagem', autor: 'Pregoeiro', texto: this.mensagens.shift(), hora: this.hora() };
      }
      // Um concorrente que ainda tem margem cobre a praça por um valor pequeno.
      const reducao = Math.max(0.01, Math.round(this.praca * (0.002 + this.aleatorio() * 0.01) * 100) / 100);
      const valor = Math.round((this.praca - reducao) * 100) / 100;
      const podem = this.concorrentes.filter((c) => valor >= c.minimo);
      if (!podem.length) return { tipo: 'tique' }; // ninguém desce mais: o tempo corre
      const c = podem[Math.floor(this.aleatorio() * podem.length)];
      this.praca = valor;
      this.registrar(c.autor, valor, c.porte);
      this.prorrogarSeNoFim();
      return { tipo: 'lance', valor, autor: c.autor, porte: c.porte, hora: this.hora() };
    }
  }

  const api = { STATUS, FASES, FASES_DE_LANCE, MARGEM_LC123, ehMeEpp, validarLimites, decidir, ordenarRanking, preferenciaLC123, Disputa, SalaSimulada, centavos };
  raiz.LHRobo = api;
  if (raiz.LH) raiz.LH.robo = api;
}(typeof window !== 'undefined' ? window : globalThis));
