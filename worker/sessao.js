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
import { Disputa, centavos } from '../src/robo/motor.js';
import { ErroAdaptador } from './adaptadores/base.js';

/** Ponte entre o adaptador (que empurra eventos) e o motor (que puxa com proximoEvento). */
export class SalaReal {
  constructor({ adaptador, piso, teto, modo }) {
    Object.assign(this, { adaptador, piso, teto, modo });
    this.fila = [];
    this.espera = null;
    this.aberta = true;
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
    try {
      await this.adaptador.placeBid(valor);
    } catch (e) {
      // O portal recusou ESTE lance (praça mudou, intervalo mínimo...): a sessão continua.
      if (e?.codigo === 'lance') e.recuperavel = true;
      throw e;
    }
  }

  fechar() {
    this.aberta = false;
    if (this.espera) { const r = this.espera; this.espera = null; r({ tipo: 'encerrada' }); }
  }
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
  constructor({ sessao, item, adaptador, gravar, atualizarSessao, atualizarItem, log = console }) {
    Object.assign(this, { sessao, item, adaptador, gravar, atualizarSessao, atualizarItem, log });
    this.disputa = null;
    this.sala = null;
    this.pararLeitura = null;
    this.encerrada = false;
    this.melhor = null;
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
      aoLance: async (valor, motivo) => {
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
    for (const l of inicial.lances) if (!l.nosso) d.registrarConcorrente(l.autor, l.valor, l.porte);
    this.disputa = d;
  }

  aoEvento(ev) {
    if (this.encerrada) return;
    if (ev.tipo === 'erro') { this.avisar('alerta', { texto: `Leitura da sala: ${ev.texto}` }); return; }
    if (ev.tipo === 'fase') {
      this.atualizarItem({ fase: ev.fase }).catch(() => {});
      this.avisar('fase', { fase: ev.fase, texto: null });
      if (ev.fase === 'encerrada') { this.sala?.empurrar(ev); this.encerrar('Sessão encerrada pelo portal.'); return; }
    }
    if (ev.tipo === 'lance') {
      if (!ev.nosso && (this.melhor == null || ev.valor < this.melhor)) {
        this.melhor = ev.valor;
        this.atualizarItem({ melhor_lance: ev.valor }).catch(() => {});
      }
      // Os nossos lances já são gravados pelo aoLance; os lidos da sala só entram se vieram de fora do robô.
      if (!ev.nosso || !this.disputa) this.avisar('lance', { autor: ev.nosso ? 'nos' : ev.autor, porte: ev.nosso ? 'nos' : ev.porte, valor: ev.valor });
      if (ev.inicial) return; // a foto inicial já entrou na disputa
    }
    if (ev.tipo === 'mensagem') this.avisar('mensagem', { autor: ev.autor || 'Pregoeiro', texto: ev.texto });
    this.sala?.empurrar(ev.nosso ? { ...ev, autor: 'nos' } : ev);
  }

  pausar() { this.disputa?.pausar(); return this.atualizarSessao({ status: 'pausado' }); }
  async retomar() { await this.atualizarSessao({ status: 'conectado' }); await this.disputa?.retomar(); }
  atualizarLimites({ piso, teto }) {
    this.disputa?.atualizarLimites({ piso, teto });
    if (this.sala) Object.assign(this.sala, { piso: piso ?? this.sala.piso, teto: teto ?? this.sala.teto });
    Object.assign(this.item, { piso: piso ?? this.item.piso, teto: teto ?? this.item.teto });
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
    this.pararLeitura?.();
    this.disputa?.parar();
    this.sala?.fechar();
    await this.adaptador.close().catch(() => {});
    if (texto) await this.avisar('status', { texto });
    await this.atualizarSessao(erro ? { status: 'erro', erro: erro.slice(0, 1000), encerrado_em: new Date().toISOString() } : { status: 'encerrada', encerrado_em: new Date().toISOString() }).catch(() => {});
    await this.atualizarItem({ bid_status: parouNoPiso ? 'stopped_at_floor' : 'idle' }).catch(() => {});
  }
}
