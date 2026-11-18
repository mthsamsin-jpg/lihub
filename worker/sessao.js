// Uma sessão do robô num pregão REAL: adaptador do portal + motor de lances.
//
//   adaptador.watchBids  ->  eventos  ->  gravar (auction_live_bids -> Realtime -> tela)
//                                     ->  SalaReal  ->  Disputa (motor, mesmo do navegador)
//   Disputa decide cobrir  ->  SalaReal.enviarLance  ->  TRAVA de novo  ->  adaptador.placeBid
//
// Modo "monitorar": só lê a sala e transmite (nenhum lance sai).
// Modo "lances": o motor cobre a praça respeitando teto, custo e piso.
// A trava do prejuízo zero é conferida 3 vezes: no motor (decidir), aqui
// (antes do placeBid) e no banco (gatilho robo_conferir_lance em robo_itens).
//
// Alta performance:
//   - a sala chega por MutationObserver (adaptador), em milissegundos;
//   - sniper: com sniperSeg no item, o motor segura o lance até os segundos finais,
//     descontando a latência medida aqui a cada envio;
//   - auto-healing: queda da página, do navegador ou da sessão do portal faz a
//     sessão pausar o motor, reconectar (com espera crescente) e retomar.
//   - preditivo: cada lance alimenta o perfil dos concorrentes e a previsão do
//     fechamento; mudanças relevantes viram alerta no feed e no webhook. No fim,
//     o fechamento e os perfis vão para o histórico (base das próximas previsões).
import { Disputa, centavos } from '../src/robo/motor.js';
import { MonitorPreditivo } from '../src/robo/analise.js';
import { ErroAdaptador } from './adaptadores/base.js';

/** Ponte entre o adaptador (que empurra eventos) e o motor (que puxa com proximoEvento). */
export class SalaReal {
  constructor({ adaptador, piso, teto, modo }) {
    Object.assign(this, { adaptador, piso, teto, modo });
    this.fila = [];
    this.espera = null;
    this.aberta = true;
    this.latenciaMs = 0; // média móvel do tempo que o portal leva para aceitar um lance
  }

  empurrar(ev) {
    if (!this.aberta) return;
    if (this.espera) { const r = this.espera; this.espera = null; r(ev); } else this.fila.push(ev);
  }

  async proximoEvento() {
    if (this.fila.length) return this.fila.shift();
    if (!this.aberta) return { tipo: 'encerrada' };
    return new Promise((r) => { this.espera = r; });
  }

  async enviarLance(valor) {
    if (this.modo !== 'lances') throw new ErroAdaptador('Sessão só de monitoramento: nenhum lance é enviado.', 'somente_monitorar');
    const v = centavos(valor);
    // TRAVA (2ª conferência): nunca abaixo do piso nem acima do teto.
    if (v == null || v < centavos(this.piso) || v > centavos(this.teto)) {
      throw new ErroAdaptador(`Trava: lance de ${valor} fora do intervalo entre o piso (${this.piso}) e o teto (${this.teto}).`, 'trava');
    }
    const inicio = Date.now();
    try {
      await this.adaptador.placeBid(valor);
    } catch (e) {
      // O portal recusou ESTE lance (praça mudou, intervalo mínimo...) ou o botão mudou
      // de lugar: a sessão continua e decide de novo no próximo evento.
      if (e?.codigo === 'lance' || e?.codigo === 'seletor_quebrado') e.recuperavel = true;
      throw e;
    }
    const ms = Date.now() - inicio;
    this.latenciaMs = this.latenciaMs ? Math.round(this.latenciaMs * 0.7 + ms * 0.3) : ms;
  }

  fechar() {
    this.aberta = false;
    if (this.espera) { const r = this.espera; this.espera = null; r({ tipo: 'encerrada' }); }
  }
}

/** Piso efetivo do item (piso informado ou custo + margem mínima, o que for maior). */
function pisoComMargem(item) {
  const m = Number(item.margemMinPct);
  if (item.custo == null || !Number.isFinite(m) || m <= 0) return item.piso;
  return Math.max(item.piso, Math.ceil(item.custo * (100 + m)) / 100);
}

export class SessaoReal {
  /**
   * @param {object} deps
   * @param {object} deps.sessao       linha de robo_sessoes (id, modo, pregao_ref, lote_ref, ...)
   * @param {object} deps.item         item do robô { teto, custo, piso, decremento, intervaloSeg, nossoPorte, fugirEmpate }
   * @param {import('./adaptadores/base.js').PortalAdapter} deps.adaptador
   * @param {(evento: object) => Promise<void>} deps.gravar          grava em auction_live_bids
   * @param {(campos: object) => Promise<void>} deps.atualizarSessao  status/erro em robo_sessoes
   * @param {(campos: object) => Promise<void>} deps.atualizarItem     bid_status/nosso_lance/melhor_lance/fase em robo_itens
   */
  constructor({
    sessao, item, adaptador, gravar, atualizarSessao, atualizarItem, log = console, maxReconexoes = 5, esperaBaseMs = 1000, esperar,
    historico = [], notificar = null, salvarFechamento = null, salvarPerfis = null, agora = () => Date.now(),
  }) {
    Object.assign(this, { sessao, item, adaptador, gravar, atualizarSessao, atualizarItem, log, maxReconexoes, esperaBaseMs, notificar, salvarFechamento, salvarPerfis });
    this.preditivo = new MonitorPreditivo({
      teto: item.teto, piso: pisoComMargem(item), custo: item.custo ?? null, decremento: item.decremento ?? 0.01, historico, agora,
    });
    this.esperar = esperar || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.disputa = null;
    this.sala = null;
    this.pararLeitura = null;
    this.encerrada = false;
    this.reconectando = false;
    this.reconexoes = 0;
    this.melhor = null;
    this.lancesVistos = new Set(); // não repete no feed o que já apareceu antes de uma reconexão
    adaptador.aoCurar = (campo, de, para) => this.avisar('alerta', { texto: `O portal mudou a tela (${campo}). O robô achou o elemento por outro caminho: ${para}.` });
  }

  async avisar(tipo, campos) {
    try { await this.gravar({ tipo, ...campos }); } catch (e) { this.log.erro?.(`Falha ao gravar evento: ${e.message}`); }
  }

  async iniciar() {
    const { sessao, item, adaptador } = this;
    try {
      await this.atualizarSessao({ status: 'iniciando' });
      await adaptador.abrir();
      await this.avisar('status', { texto: `Entrando no portal ${adaptador.portal}...` });
      await adaptador.login();
      await adaptador.joinAuctionRoom({ pregao: sessao.pregao_ref, lote: sessao.lote_ref });
      const inicial = await adaptador.lerSala();
      await this.atualizarSessao({ status: 'conectado' });
      await this.avisar('status', { texto: `Conectado à sala do pregão ${sessao.pregao_ref}${sessao.lote_ref ? `, lote ${sessao.lote_ref}` : ''}. Modo: ${sessao.modo === 'lances' ? 'robô dando lances' : 'só monitorando'}.` });

      this.sala = new SalaReal({ adaptador, piso: item.piso, teto: item.teto, modo: sessao.modo });
      if (sessao.modo === 'lances') this.criarDisputa(inicial);
      this.pararLeitura = adaptador.watchBids((ev) => this.aoEvento(ev));
      if (this.disputa) this.disputa.iniciar().catch((e) => this.falhar(e));
    } catch (e) {
      await this.falhar(e);
    }
  }

  criarDisputa(inicial) {
    const { item } = this;
    const nossos = inicial.lances.filter((l) => l.nosso).map((l) => l.valor);
    const d = new Disputa({
      sala: this.sala, piso: item.piso, teto: item.teto, custo: item.custo, decremento: item.decremento,
      intervaloMs: Math.max(0, (item.intervaloSeg ?? 20) * 1000),
      nossoLance: nossos.length ? Math.min(...nossos) : null,
      nossoPorte: item.nossoPorte || 'demais', fugirEmpate: !!item.fugirEmpate,
      sniperMs: Math.max(0, (item.sniperSeg ?? 0) * 1000), margemMinPct: item.margemMinPct ?? null,
      aoSniper: (ms, valor) => {
        // Avisa uma vez por espera (não a cada lance da praça).
        if (this.sniperAvisado) return;
        this.sniperAvisado = true;
        this.avisar('status', { texto: `Sniper armado: lance de ${valor} guardado para os últimos ${item.sniperSeg}s (dispara em ${Math.round(ms / 1000)}s).` });
      },
      aoErro: (e) => this.falhar(e),
      aoLance: async (valor, motivo) => {
        this.sniperAvisado = false;
        this.tratarPrevisao(this.preditivo.nosso(valor));
        await this.atualizarItem({ nosso_lance: valor, bid_status: 'running' }).catch((e) => this.log.erro?.(e.message));
        await this.avisar('lance', { autor: 'nos', porte: 'nos', valor, texto: motivo === 'fuga_empate' ? 'Lance para sair da faixa de 5% da ME/EPP' : 'Lance do robô enviado ao portal' });
      },
      aoStatus: (status) => { this.atualizarItem({ bid_status: status }).catch(() => {}); },
      aoAlerta: (texto) => {
        this.atualizarItem({ bid_status: 'stopped_at_floor' }).catch(() => {});
        this.avisar('alerta', { texto: `Preço mínimo atingido. ${texto}` });
      },
      aoAviso: (texto) => this.avisar('alerta', { texto }),
      aoRecusa: (texto) => this.avisar('status', { texto: `${texto} O robô decide de novo no próximo lance da praça.` }),
    });
    // Situação da sala no momento em que o robô entrou.
    if (inicial.fase) d.fase = inicial.fase;
    if (inicial.fimEm != null) d.fimEm = inicial.fimEm;
    for (const l of inicial.lances) if (!l.nosso) d.registrarConcorrente(l.autor, l.valor, l.porte);
    this.disputa = d;
  }

  chaveLance(l) { return `${l.nosso ? 'nos' : l.autor}|${l.valor}|${l.hora ?? ''}`; }

  aoEvento(ev) {
    if (this.encerrada) return;
    if (ev.tipo === 'queda') { this.reconectar(ev.motivo); return; }
    if (ev.tipo === 'erro') { this.avisar('alerta', { texto: `Leitura da sala: ${ev.texto}` }); return; }
    if (ev.tipo === 'tempo') { if (this.disputa) this.sala?.empurrar(ev); return; }
    if (ev.tipo === 'fase') {
      this.atualizarItem({ fase: ev.fase }).catch(() => {});
      this.avisar('fase', { fase: ev.fase, texto: null });
      if (ev.fase === 'encerrada') { this.sala?.empurrar(ev); this.encerrar('Sessão encerrada pelo portal.'); return; }
    }
    if (ev.tipo === 'lance') {
      const k = this.chaveLance(ev);
      if (this.lancesVistos.has(k)) return; // já registrado (foto inicial ou antes da reconexão)
      this.lancesVistos.add(k);
      if (!ev.nosso) this.tratarPrevisao(this.preditivo.concorrente(ev.autor, ev.valor, ev.porte));
      if (!ev.nosso && (this.melhor == null || ev.valor < this.melhor)) {
        this.melhor = ev.valor;
        this.atualizarItem({ melhor_lance: ev.valor }).catch(() => {});
      }
      // Os nossos lances já são gravados pelo aoLance; os lidos da sala só entram se vieram de fora do robô.
      if (!ev.nosso || !this.disputa) this.avisar('lance', { autor: ev.nosso ? 'nos' : ev.autor, porte: ev.nosso ? 'nos' : ev.porte, valor: ev.valor });
      if (ev.inicial) return; // a foto inicial já entrou na disputa
    }
    if (ev.tipo === 'mensagem') this.avisar('mensagem', { autor: ev.autor || 'Pregoeiro', texto: ev.texto });
    // Só o motor consome a fila (no modo monitorar não há quem leia).
    if (this.disputa) this.sala?.empurrar(ev.nosso ? { ...ev, autor: 'nos' } : ev);
  }

  /**
   * Auto-healing: a sala caiu (página, navegador, sessão do portal). Pausa o motor
   * (nenhum lance sai sem a sala à vista), reabre tudo com espera crescente
   * (1s, 2s, 4s, 8s, 16s) e retoma de onde parou. Esgotadas as tentativas, encerra com erro.
   */
  async reconectar(motivo) {
    if (this.encerrada || this.reconectando) return;
    this.reconectando = true;
    const { adaptador, sessao } = this;
    const estavaAtiva = this.disputa?.status === 'running';
    this.disputa?.pausar();
    this.pararLeitura?.();
    this.pararLeitura = null;
    await this.avisar('alerta', { texto: `Conexão com o portal perdida: ${motivo} Reconectando...` });
    let ultimoErro = null;
    for (let t = 1; t <= this.maxReconexoes && !this.encerrada; t += 1) {
      await this.esperar(this.esperaBaseMs * 2 ** (t - 1));
      if (this.encerrada) break;
      try {
        await adaptador.close().catch(() => {});
        await adaptador.abrir();
        await adaptador.login();
        await adaptador.joinAuctionRoom({ pregao: sessao.pregao_ref, lote: sessao.lote_ref });
        const sala = await adaptador.lerSala();
        // O que aconteceu na sala enquanto o robô estava fora entra na disputa agora.
        if (this.disputa) {
          if (sala.fase) this.disputa.fase = sala.fase;
          if (sala.fimEm != null) this.disputa.fimEm = sala.fimEm;
          for (const l of sala.lances) if (!l.nosso) this.disputa.registrarConcorrente(l.autor, l.valor, l.porte);
        }
        this.pararLeitura = adaptador.watchBids((ev) => this.aoEvento(ev));
        this.reconexoes += 1;
        this.reconectando = false;
        await this.avisar('status', { texto: `Reconectado à sala (tentativa ${t}).` });
        if (estavaAtiva && !this.encerrada) await this.disputa.retomar();
        return;
      } catch (e) {
        ultimoErro = e;
        await this.avisar('status', { texto: `Tentativa ${t} de ${this.maxReconexoes} de reconectar falhou: ${e.message}` });
      }
    }
    this.reconectando = false;
    if (!this.encerrada) await this.falhar(new Error(`Não consegui reconectar ao portal depois de ${this.maxReconexoes} tentativas${ultimoErro ? ` (${ultimoErro.message})` : ''}.`));
  }

  pausar() { this.disputa?.pausar(); return this.atualizarSessao({ status: 'pausado' }); }
  async retomar() { await this.atualizarSessao({ status: 'conectado' }); await this.disputa?.retomar(); }
  /** Alerta preditivo: vai para o feed (tela) e para o webhook da organização. */
  tratarPrevisao({ alerta }) {
    if (!alerta || this.encerrada) return;
    this.avisar('alerta', { texto: alerta.texto });
    const p = this.preditivo.previsao;
    this.notificar?.({
      tipo: 'previsao', motivo: alerta.motivo, texto: `Robô Turbo 2.0 · pregão ${this.sessao.pregao_ref}${this.sessao.lote_ref ? `, lote ${this.sessao.lote_ref}` : ''}: ${alerta.texto}`,
      pregao: this.sessao.pregao_ref, lote: this.sessao.lote_ref, portal: this.adaptador.portal,
      probabilidadeVitoria: p.probabilidadeVitoria, margemEstimadaPct: p.margemEstimadaPct, fechamentoPrevisto: p.previsto,
      faixa: [p.minimo, p.maximo], confianca: p.confianca,
    }).catch?.((e) => this.log.erro?.(`Webhook: ${e.message}`));
  }

  /** Fim da disputa: fechamento e perfis entram no histórico (base das próximas previsões). */
  async registrarHistorico() {
    const concorrentes = this.preditivo.perfil.resumo();
    const nosso = this.disputa?.nossoLance ?? null;
    const precos = [...concorrentes.map((c) => c.menor), nosso].filter((v) => v != null);
    if (!precos.length) return;
    const fechamento = Math.min(...precos);
    await this.salvarFechamento?.({
      preco: fechamento, vencemos: nosso != null ? nosso <= fechamento : null, lances: this.preditivo.lances.length,
    }).catch((e) => this.log.erro?.(`Histórico: ${e.message}`));
    await this.salvarPerfis?.(concorrentes).catch((e) => this.log.erro?.(`Perfis: ${e.message}`));
  }

  atualizarLimites({ piso, teto }) {
    this.disputa?.atualizarLimites({ piso, teto });
    if (this.sala) Object.assign(this.sala, { piso: piso ?? this.sala.piso, teto: teto ?? this.sala.teto });
    Object.assign(this.item, { piso: piso ?? this.item.piso, teto: teto ?? this.item.teto });
    this.preditivo.limites({ piso: pisoComMargem(this.item), teto: this.item.teto });
  }

  async falhar(e) {
    this.log.erro?.(`Sessão ${this.sessao.id}: ${e.message}`);
    await this.avisar('alerta', { texto: e.message });
    await this.encerrar(null, e.message);
  }

  async encerrar(texto = 'Robô desconectado da sala.', erro = null) {
    if (this.encerrada) return;
    this.encerrada = true;
    const parouNoPiso = this.disputa?.status === 'stopped_at_floor';
    // Só grava no histórico disputa que terminou de verdade (não queda nem erro).
    const terminou = !erro && (texto === 'Sessão encerrada pelo portal.');
    this.pararLeitura?.();
    this.disputa?.parar();
    this.sala?.fechar();
    await this.adaptador.close().catch(() => {});
    if (terminou) await this.registrarHistorico();
    if (texto) await this.avisar('status', { texto });
    await this.atualizarSessao(erro ? { status: 'erro', erro: erro.slice(0, 1000), encerrado_em: new Date().toISOString() } : { status: 'encerrada', encerrado_em: new Date().toISOString() }).catch(() => {});
    await this.atualizarItem({ bid_status: parouNoPiso ? 'stopped_at_floor' : 'idle' }).catch(() => {});
  }
}
