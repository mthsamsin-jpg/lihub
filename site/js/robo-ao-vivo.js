/* =============================================================================
   Uso LicitaHub · Robô de Lances ao vivo (estado global + mini player)
   Guarda as disputas, os itens e o chat da sala FORA da tela do robô, para os
   robôs continuarem rodando quando o operador navega para outros módulos.
   A tela (js/modulos/robo.js) e o mini player flutuante só "ouvem" este estado.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const INTERVALO_SIMULACAO_MS = 1500; // na sala simulada o intervalo é acelerado
  const MAX_MSGS = 200;
  const VIVOS = ['running', 'paused', 'stopped_at_floor'];

  const ouvintes = new Set();
  const disputas = new Map(); // id -> LH.robo.Disputa
  const chat = [];
  let itens = null;
  let carregando = null;
  // Modo da sala: "simulada" (concorrentes fictícios) ou "real" (portal de verdade).
  // É uma preferência deste navegador.
  const CHAVE_MODO = 'lh-robo-modo';
  let modo = 'simulada';
  try { if (localStorage.getItem(CHAVE_MODO) === 'real') modo = 'real'; } catch { /* sem armazenamento */ }
  // Lances dos concorrentes na sala simulada: a cada 3 a 7 segundos.
  const PASSO_SIMULACAO = { passoMinMs: 3000, passoMaxMs: 7000 };

  const moeda = (v) => (v == null ? '—' : LH.fmt.moeda(v));
  const item = (id) => (itens || []).find((i) => i.id === id);
  const emitir = (tipo, dado) => {
    ouvintes.forEach((fn) => { try { fn(tipo, dado); } catch (e) { console.error(e); } });
    mini.atualizar();
  };

  const gravar = (() => {
    const pendentes = new Map();
    return (id) => {
      clearTimeout(pendentes.get(id));
      pendentes.set(id, setTimeout(() => {
        pendentes.delete(id);
        const i = item(id);
        if (i) LH.repo.roboEstado(id, { status: i.status, nossoLance: i.nossoLance, melhorLance: i.melhorLance, fase: i.fase ?? null }).catch((e) => LH.aviso(e.message, 'perigo'));
      }, 300));
    };
  })();

  const mudar = (id, campos, salvar = true) => {
    const i = item(id);
    if (!i) return;
    Object.assign(i, campos);
    emitir('item', id);
    if (salvar) gravar(id);
  };

  /** extra (lances): { porte, posicao, valor, quantidade, itemId } para o feed mostrar posição, ME/EPP e unitário x total. */
  const falar = (autor, texto, tipo = '', extra = null) => {
    const msg = { autor, texto, tipo, hora: new Date().toLocaleTimeString('pt-BR'), ...(extra || {}) };
    chat.push(msg);
    if (chat.length > MAX_MSGS) chat.shift();
    emitir('chat', msg);
  };

  const api = {
    INTERVALO_SIMULACAO_MS,
    ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    modo: () => modo,
    /** Troca o modo da sala. Só com todos os robôs parados. */
    mudarModo(novo) {
      if (novo === modo) return true;
      if (api.vivos().some((i) => i.status === 'running' || i.status === 'paused')) return false;
      modo = novo === 'real' ? 'real' : 'simulada';
      try { localStorage.setItem(CHAVE_MODO, modo); } catch { /* sem armazenamento */ }
      emitir('modo', modo);
      return true;
    },
    lista: () => itens || [],
    item,
    mensagens: () => chat,
    disputa: (id) => disputas.get(id),
    /** Ranking da praça do item: [{ autor, valor, porte, posicao }] ("nos" = nós). */
    ranking: (id) => disputas.get(id)?.ranking() || [],
    /** Situação da LC 123 no ranking atual do item. */
    preferencia: (id) => LH.robo.preferenciaLC123(api.ranking(id)),
    falar,

    /** Carrega os itens uma vez por sessão. "Ativo" de outra visita vira "pausado". */
    carregar() {
      if (itens) return Promise.resolve(itens);
      carregando ??= LH.repo.roboItens()
        .then((lista) => { itens = lista.map((i) => (i.status === 'running' ? { ...i, status: 'paused' } : i)); emitir('lista'); return itens; })
        .finally(() => { carregando = null; });
      return carregando;
    },
    adicionar(salvo) { (itens ||= []).push(salvo); emitir('lista'); },
    atualizar(id, campos) { mudar(id, campos, false); },
    async remover(id) {
      await LH.repo.excluirRoboItem(id);
      disputas.get(id)?.parar();
      disputas.delete(id);
      itens = (itens || []).filter((x) => x.id !== id);
      emitir('lista');
    },
    atualizarLimites(id, limites) { disputas.get(id)?.atualizarLimites(limites); },

    /** opcoes.pedido (modo real): { pregao, lote, modo } para conectar sem perguntar. */
    iniciar(id, portal = '', opcoes = {}) {
      const i = item(id);
      if (!i) return;
      const existente = disputas.get(id);
      if (existente && existente.status === 'paused') { existente.retomar(); return; }
      if (modo === 'real') {
        // Modo real: o worker do servidor abre o portal; os eventos chegam pelo Realtime.
        LH.roboReal?.iniciar(i, {
          mudar, falar,
          prender: (itemId, d) => disputas.set(itemId, d),
          soltar: (itemId, d) => { if (disputas.get(itemId) === d) disputas.delete(itemId); },
        }, opcoes.pedido || null);
        return;
      }
      const nome = i.descricao;
      // Concorrentes da simulação: param entre ~95% do custo e ~5% acima do piso.
      const custo = i.custo ?? i.piso * 0.9;
      const minimo = custo * 0.95 + Math.random() * (i.piso * 1.05 - custo * 0.95);
      const sala = new LH.robo.SalaSimulada({ inicial: i.teto * 1.03, minimoConcorrentes: Math.round(minimo * 100) / 100, abertaMs: 60000, prorrogacaoMs: 15000, ...PASSO_SIMULACAO });
      const qtd = i.quantidade || 1;
      const monitorando = opcoes.pedido?.modo === 'monitorar' || (i.piso != null && i.piso === i.teto);
      const posicaoDe = (autor) => d.ranking().find((x) => x.autor === autor)?.posicao ?? null;
      const d = new LH.robo.Disputa({
        sala, piso: i.piso, teto: i.teto, custo: i.custo, decremento: i.decremento,
        intervaloMs: Math.min(i.intervaloSeg * 1000, INTERVALO_SIMULACAO_MS), nossoLance: null,
        nossoPorte: i.nossoPorte || 'demais', fugirEmpate: !!i.fugirEmpate,
        // "Monitorar" (feed) ou piso = teto: a sala simulada roda, mas o robô não dá lances.
        observar: monitorando,
        aoFase: (fase, ev) => {
          mudar(id, { fase, fimEm: ev.fimEm ?? null });
          if (fase === 'negociacao' && d.ranking()[0]?.autor === 'nos') {
            LH.aviso(`Negociação aberta: o pregoeiro pede contraproposta · ${nome}`, 'alerta');
            LH.notificar?.('Negociação com o pregoeiro', nome);
          }
        },
        aoEncerrada: () => falar('Sistema', `Disputa encerrada · ${nome}. O robô tinha parado no preço mínimo de segurança.`, 'robo-chat__msg--sistema', { itemId: id }),
        aoAviso: (texto) => falar('Robô (nós)', texto, 'robo-chat__msg--alerta', { itemId: id }),
        aoStatus: (status, motivo) => {
          mudar(id, { status });
          if (motivo === 'encerrada') {
            const x = item(id);
            const venceu = x && x.nossoLance != null && x.nossoLance <= (x.melhorLance ?? Infinity);
            falar('Sistema', `Disputa encerrada · ${nome}. ${venceu ? 'Terminamos na frente.' : 'Não ficamos com o melhor lance.'}`, 'robo-chat__msg--sistema', { itemId: id });
          }
        },
        aoLance: (v, motivo) => {
          mudar(id, { nossoLance: v });
          falar('Robô (nós)', motivo === 'fuga_empate' ? `Lance para sair da faixa de 5% da ME/EPP · ${nome}` : nome, 'robo-chat__msg--nos',
            { porte: i.nossoPorte || 'demais', posicao: posicaoDe('nos'), valor: v, quantidade: qtd, itemId: id });
        },
        aoConcorrente: (v, autor, porte) => {
          mudar(id, { melhorLance: d.melhorConcorrente });
          falar(autor, nome, '', { porte: porte || 'demais', posicao: posicaoDe(autor), valor: v, quantidade: qtd, itemId: id });
        },
        aoMensagem: (m) => falar(m.autor, m.texto, m.autor === 'Sistema' ? 'robo-chat__msg--sistema' : 'robo-chat__msg--oficial', { itemId: id }),
        aoAlerta: (texto) => {
          mudar(id, { alertaPiso: texto }, false);
          falar('Preço mínimo atingido', texto, 'robo-chat__msg--alerta', { itemId: id });
          LH.aviso(`Preço mínimo atingido · ${nome}`, 'perigo', 7000);
          LH.notificar?.('Preço mínimo atingido', texto);
        },
      });
      disputas.set(id, d);
      mudar(id, { nossoLance: null, melhorLance: null, fase: 'aberta', fimEm: null, alertaPiso: null, monitorando });
      falar('Sistema', `Robô ligado · ${portal ? `${portal} · ` : ''}${nome}. Piso ${moeda(i.piso)}, teto ${moeda(i.teto)}.`, 'robo-chat__msg--sistema', { itemId: id });
      d.iniciar().catch((e) => { LH.aviso(e.message, 'perigo'); mudar(id, { status: 'stopped_at_floor' }); });
    },
    pausar(id) {
      const d = disputas.get(id);
      if (d?.status !== 'running') return;
      d.pausar();
      falar('Sistema', `Robô pausado · ${item(id)?.descricao}`, 'robo-chat__msg--sistema', { itemId: id });
    },
    /** Pausa de emergência: pausa todos os robôs ativos. */
    pausarTodos() {
      const ativos = [...disputas].filter(([, d]) => d.status === 'running');
      ativos.forEach(([id]) => api.pausar(id));
      return ativos.length;
    },
    parar(id) {
      const d = disputas.get(id);
      if (d) d.parar(); else mudar(id, { status: 'idle' });
      disputas.delete(id);
    },
    /** Item mais importante para o mini player: ativo > parado no piso > pausado. */
    destaque() {
      const ordem = { running: 0, stopped_at_floor: 1, paused: 2 };
      return [...disputas.keys()].map(item).filter((i) => i && VIVOS.includes(i.status))
        .sort((a, b) => ordem[a.status] - ordem[b.status])[0] || null;
    },
    /** Ao sair da conta: para tudo e esquece os itens e o chat. */
    encerrar() {
      disputas.forEach((d) => d.status !== 'idle' && d.parar());
      disputas.clear();
      chat.length = 0;
      itens = null;
      emitir('lista');
    },
    vivos: () => [...disputas.keys()].map(item).filter((i) => i && VIVOS.includes(i.status)),
  };
  LH.roboAoVivo = api;

  // ---------------------------------------------------------------------------
  // Mini player flutuante: aparece fora da tela do robô enquanto houver disputa.
  // ---------------------------------------------------------------------------
  const ROTULO = { running: 'Ativo', paused: 'Pausado', stopped_at_floor: 'Preço mínimo atingido' };
  const CLASSE = { running: 'ativo', paused: 'pausado', stopped_at_floor: 'piso' };
  let el = null;
  let dispensadoEm = null; // assinatura do estado quando o operador fechou o balão

  const naTelaDoRobo = () => location.hash.replace(/^#\/?/, '').split('?')[0] === 'robo';
  const assinatura = (vivos) => vivos.map((i) => `${i.id}:${i.status}`).join('|');

  function criar() {
    const { icone } = LH;
    el = document.createElement('aside');
    el.className = 'robo-mini';
    el.hidden = true;
    el.setAttribute('aria-label', 'Robô de lances em segundo plano');
    el.innerHTML = `
      <header class="robo-mini__topo">
        <span class="robo-mini__status" data-m="status"><i aria-hidden="true"></i><b></b></span>
        <span class="robo-mini__mais" data-m="mais"></span>
        <button type="button" class="robo-mini__x" data-m-acao="fechar" aria-label="Esconder o mini player">${icone('fechar')}</button>
      </header>
      <div class="robo-mini__portal" data-m="portal"></div>
      <p class="robo-mini__item" data-m="item"></p>
      <div class="robo-mini__placar">
        <div><span>Praça</span><strong data-m="praca"></strong></div>
        <div data-m="nos-caixa"><span>Nosso lance</span><strong data-m="nos"></strong></div>
      </div>
      <p class="robo-mini__ultima" data-m="ultima" aria-live="polite"></p>
      <div class="robo-mini__acoes">
        <button type="button" class="btn btn--pequeno btn--perigo" data-m-acao="pausar">${icone('relogio')} <span>Pausar</span></button>
        <button type="button" class="btn btn--pequeno btn--primario" data-m-acao="abrir">${icone('externo')} Tela completa</button>
      </div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m-acao]');
      if (!b) return;
      if (b.dataset.mAcao === 'abrir') LH.ir('robo');
      if (b.dataset.mAcao === 'fechar') { dispensadoEm = assinatura(api.vivos()); mini.atualizar(); }
      if (b.dataset.mAcao === 'pausar') {
        const n = api.pausarTodos();
        if (n) LH.aviso(n > 1 ? `${n} robôs pausados.` : 'Robô pausado.', 'sucesso');
      }
    });
    document.body.append(el);
  }

  const mini = {
    atualizar() {
      const vivos = itens ? api.vivos() : [];
      const sinal = assinatura(vivos);
      if (dispensadoEm != null && sinal !== dispensadoEm) dispensadoEm = null; // mudou algo: volta a aparecer
      const mostrar = vivos.length > 0 && !naTelaDoRobo() && !document.body.classList.contains('sem-login') && dispensadoEm == null;
      if (!mostrar) { if (el) el.hidden = true; return; }
      if (!el) criar();
      const i = api.destaque();
      const q = (k) => el.querySelector(`[data-m="${k}"]`);
      el.hidden = false;
      el.className = `robo-mini robo-mini--${CLASSE[i.status]}`;
      q('status').querySelector('b').textContent = ROTULO[i.status];
      q('mais').textContent = vivos.length > 1 ? `+${vivos.length - 1} robô${vivos.length > 2 ? 's' : ''}` : '';
      const FASE = { aberta: 'Fase aberta', prorrogacao: 'Prorrogação', desempate: 'Desempate ME/EPP', negociacao: 'Negociação', habilitacao: 'Habilitação', encerrada: 'Encerrada' };
      q('portal').innerHTML = `${LH.portaisRobo?.selo(i.plataforma) || ''}<span>${FASE[i.fase] || ''}</span>`;
      if (i.status === 'running' && i.fase && !['aberta', 'prorrogacao'].includes(i.fase)) q('status').querySelector('b').textContent = 'Acompanhando';
      q('item').textContent = i.descricao;
      q('item').title = i.descricao;
      q('praca').textContent = moeda(i.melhorLance);
      q('nos').textContent = moeda(i.nossoLance);
      const vencendo = i.nossoLance != null && (i.melhorLance == null || i.nossoLance < i.melhorLance);
      q('nos-caixa').className = i.nossoLance == null ? '' : vencendo ? 'robo-mini--vencendo' : 'robo-mini--coberto';
      const ultima = chat[chat.length - 1];
      q('ultima').textContent = ultima ? `${ultima.autor}: ${ultima.texto}` : '';
      const algumAtivo = vivos.some((x) => x.status === 'running');
      const pausar = el.querySelector('[data-m-acao="pausar"]');
      pausar.disabled = !algumAtivo;
      pausar.querySelector('span').textContent = vivos.filter((x) => x.status === 'running').length > 1 ? 'Pausar todos' : 'Pausar';
    },
  };

  window.addEventListener('hashchange', () => mini.atualizar());
  // Fechar ou recarregar a aba encerra a sala simulada: avisa se houver robô ativo.
  window.addEventListener('beforeunload', (e) => {
    if ([...disputas.values()].some((d) => d.status === 'running')) { e.preventDefault(); e.returnValue = ''; }
  });
}());
