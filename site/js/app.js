/* =============================================================================
   Uso LicitaHub · app.js
   Menu lateral (com acordeão), navegação entre os módulos (SPA por #rota),
   menu de celular, busca rápida, notificações, menu do usuário e inicialização
   (modo real com login, ou modo demonstração).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone, fmt } = LH;

  // --- Menu: as etapas do trabalho, numeradas na ordem em que acontecem ---------
  // "id" é a rota (#/id) e o nome do módulo em LH.vistas. "etapa" numera o grupo
  // (1 a 6) e os filhos viram 1.1, 1.2... Home, Perfil e Ajuda ficam fora da sequência.
  LH.menu = [
    { id: 'home', rotulo: 'Home', icone: 'home' },
    { etapa: 1, rotulo: 'Prospecção', icone: 'busca', filhos: [
      { id: 'buscar', rotulo: 'Buscar Licitações' },
      { id: 'radar', rotulo: 'Radar de Licitações' },
      { id: 'petronect', rotulo: 'Petronect', tag: 'Beta' },
      { id: 'favoritas', rotulo: 'Licitações favoritas' },
    ] },
    { etapa: 2, id: 'robo', rotulo: 'Robô Turbo 2.0', icone: 'alvo' },
    { etapa: 3, rotulo: 'Análise do edital', icone: 'brilho', filhos: [
      { id: 'ia/leitor', rotulo: 'Leitor de Edital IA' },
      { id: 'ia/dossie', rotulo: 'Dossiê Jurídico IA' },
    ] },
    { etapa: 4, rotulo: 'Acompanhamento', icone: 'kanban', filhos: [
      { id: 'crm', rotulo: 'CRM do Licitante' },
      { id: 'calendario', rotulo: 'Calendário' },
    ] },
    { etapa: 5, rotulo: 'Documentos e habilitação', icone: 'pasta', filhos: [
      { id: 'empresa', rotulo: 'Sua empresa' },
      { id: 'crm/empresa', rotulo: 'Cadastrar Empresa' },
      { id: 'documentos', rotulo: 'Gestor de documentos' },
      { id: 'declaracoes', rotulo: 'Gerador de declarações' },
    ] },
    { etapa: 6, rotulo: 'Preço e proposta', icone: 'arquivo', filhos: [
      { id: 'inteligencia', rotulo: 'Inteligência de Mercado', tag: 'Novo' },
      { id: 'pesquisa-precos', rotulo: 'Pesquisa de Preço' },
      { id: 'ia/cotacao', rotulo: 'Cotação Online IA', tag: 'Beta' },
      { id: 'proposta/criar', rotulo: 'Gerador de proposta' },
      { id: 'proposta/minhas', rotulo: 'Minhas propostas' },
    ] },
    { etapa: 7, rotulo: 'Disputa', icone: 'chat', filhos: [
      { id: 'comprasnet', rotulo: 'Cadastro Comprasnet' },
      { id: 'chat', rotulo: 'Monitoramento de Chat' },
    ] },
    { rotulo: 'Meu Perfil', icone: 'usuario', filhos: [
      { id: 'perfil', rotulo: 'Dados da conta e assinatura' },
    ] },
    { id: 'ajuda', rotulo: 'Ajuda', icone: 'ajuda' },
  ];

  const sidebar = document.getElementById('sidebar');
  const menu = document.getElementById('menu');
  const conteudo = document.getElementById('conteudo');
  const botaoMenu = document.querySelector('.topo__menu');
  const real = () => LH.repo.modo === 'real';

  function montarMenu() {
    const tag = (t) => (t ? `<span class="menu__tag">${esc(t)}</span>` : '');
    // Nome editável pelo modo ADM (data-cms): chave estável por rota ou etapa.
    const chaveMenu = (item) => `menu.${String(item.id || (item.etapa ? `etapa-${item.etapa}` : item.rotulo)).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`;
    const nome = (item) => `<span class="menu__rotulo" data-cms="${chaveMenu(item)}">${esc(item.rotulo)}</span>`;
    menu.innerHTML = `<ul>${LH.menu.map((item, i) => {
      if (!item.filhos) {
        // Etapa com acesso direto (ex.: "2 Robô Turbo 2.0"): número da etapa, sem submenu.
        const marcaDireta = item.etapa ? `<span class="menu__num" aria-hidden="true">${item.etapa}</span>` : icone(item.icone);
        const rotuloDireto = item.etapa ? `<span class="sr-only">Etapa ${item.etapa}: </span>${nome(item)}` : nome(item);
        return `<li class="menu__item${item.etapa ? ' menu__item--etapa' : ''}"><a class="menu__link" href="#/${item.id}" data-rota="${item.id}">
          ${marcaDireta}<span class="menu__texto">${rotuloDireto}</span>${tag(item.tag)}</a></li>`;
      }
      const marca = item.etapa ? `<span class="menu__num" aria-hidden="true">${item.etapa}</span>` : icone(item.icone);
      const rotulo = item.etapa ? `<span class="sr-only">Etapa ${item.etapa}: </span>${nome(item)}` : nome(item);
      return `<li class="menu__item${item.etapa ? ' menu__item--etapa' : ''}">
        <button type="button" class="menu__link" aria-expanded="false" aria-controls="sub-${i}" data-grupo="${i}">
          ${marca}<span class="menu__texto">${rotulo}</span>${icone('setaBaixo', 'menu__seta')}
        </button>
        <div class="menu__sub" id="sub-${i}"><ul>${item.filhos.map((f, j) => `
          <li><a class="menu__link" href="#/${f.id}" data-rota="${f.id}">${item.etapa ? `<span class="menu__subnum">${item.etapa}.${j + 1}</span>` : ''}<span class="menu__texto">${nome(f)}</span>${tag(f.tag)}</a></li>`).join('')}
        </ul></div>
      </li>`;
    }).join('')}</ul>`;
  }

  /** Abre/fecha um grupo do acordeão (abrir um fecha os outros). */
  function alternarGrupo(botao, abrir = botao.getAttribute('aria-expanded') !== 'true') {
    if (abrir) {
      menu.querySelectorAll('[data-grupo][aria-expanded="true"]').forEach((b) => b !== botao && alternarGrupo(b, false));
    }
    botao.setAttribute('aria-expanded', String(abrir));
    document.getElementById(botao.getAttribute('aria-controls')).classList.toggle('aberto', abrir);
  }

  function marcarAtivo(caminho) {
    menu.querySelectorAll('.menu__link.ativo').forEach((a) => { a.classList.remove('ativo'); a.removeAttribute('aria-current'); });
    const link = menu.querySelector(`[data-rota="${CSS.escape(caminho)}"]`);
    if (!link) return;
    link.classList.add('ativo');
    link.setAttribute('aria-current', 'page');
    const sub = link.closest('.menu__sub');
    if (sub) {
      const botao = menu.querySelector(`[aria-controls="${sub.id}"]`);
      botao.classList.add('ativo');
      alternarGrupo(botao, true);
    }
  }

  // --- Menu no celular ----------------------------------------------------------------
  function abrirMenu() {
    sidebar.classList.add('aberta');
    document.body.classList.add('menu-aberto');
    botaoMenu.setAttribute('aria-expanded', 'true');
    menu.querySelector('.menu__link')?.focus();
  }
  function fecharMenu() {
    if (!sidebar.classList.contains('aberta')) return;
    sidebar.classList.remove('aberta');
    document.body.classList.remove('menu-aberto');
    botaoMenu.setAttribute('aria-expanded', 'false');
  }

  // --- Navegação (rotas por #) ----------------------------------------------------------
  let desmontarAtual = null;
  let primeiraVez = true;
  let appIniciado = false;

  function lerRota() {
    const [caminho, consulta] = location.hash.replace(/^#\/?/, '').split('?');
    return { caminho: caminho || 'home', params: Object.fromEntries(new URLSearchParams(consulta || '')) };
  }

  function navegar() {
    if (!appIniciado) return; // ainda na tela de login
    const { caminho, params } = lerRota();
    const vista = LH.vistas[caminho];
    if (!vista) { location.replace('#/home'); return; }

    if (desmontarAtual) { desmontarAtual(); desmontarAtual = null; }
    const textoLocal = typeof vista.local === 'string' ? vista.local : 'Este módulo ainda está em demonstração: os dados ficam só neste navegador.';
    const aviso = real() && vista.local ? `<p class="nota" style="margin-bottom:18px">${icone('info')} ${esc(textoLocal)}</p>` : '';
    // Paywall: módulo fora do plano -> tela bloqueada + convite para o upgrade.
    const liberado = LH.plano.permite(caminho);
    conteudo.innerHTML = `<div class="vista">${liberado ? `${aviso}${vista.render(params)}` : LH.plano.telaBloqueada(caminho, vista.titulo)}</div>`;
    const raiz = conteudo.firstElementChild;
    const limpeza = liberado ? vista.montar?.(raiz, params) : LH.plano.pedirUpgrade(LH.plano.exigido(caminho));
    if (!liberado) LH.tutorialRobo?.ligar(raiz); // tela de bloqueio do robô também mostra o tutorial
    if (typeof limpeza === 'function') desmontarAtual = limpeza;
    LH.revelar(raiz);

    marcarAtivo(caminho);
    LH.plano.marcarMenu();
    document.title = `${vista.titulo} · Uso LicitaHub`;
    document.getElementById('titulo-pagina').textContent = vista.titulo;
    document.getElementById('trilha').textContent = vista.trilha ? `Uso LicitaHub / ${vista.trilha}` : 'Uso LicitaHub';
    fecharMenu();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!primeiraVez) conteudo.focus({ preventScroll: true });
    primeiraVez = false;
  }

  /** Vai para uma rota (ex.: LH.ir('ia/leitor?id=1001')). */
  LH.ir = (rota) => {
    const destino = `#/${rota}`;
    if (location.hash === destino) navegar();
    else location.hash = destino;
  };

  // --- Usuário, plano e menu do usuário ----------------------------------------------
  LH.atualizarUsuario = () => {
    setTimeout(() => LH.plano?.marcarMenu());
    let nome;
    let pessoa;
    if (real() && LH.nuvem.ctx) {
      nome = LH.nuvem.ctx.organizacao.nome;
      pessoa = LH.nuvem.ctx.perfil.nome || LH.nuvem.usuario.email;
    } else {
      const e = LH.repo.empresaPerfil();
      nome = e.fantasia || e.razao || 'Minha empresa';
      pessoa = nome;
    }
    document.getElementById('usuario-nome').textContent = nome;
    const iniciais = pessoa.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    document.getElementById('avatar').textContent = iniciais || 'LH';

    // Cartão do plano no menu lateral
    const plano = document.querySelector('.sidebar__plano');
    if (real() && LH.nuvem.ctx) {
      const org = LH.nuvem.ctx.organizacao;
      const nivel = LH.plano.nivel();
      const isento = LH.plano.isento();
      const pago = !isento && nivel !== 'free';
      const status = isento ? 'Conta isenta · acesso total' : pago && LH.nuvem.ctx.organizacao.plano_ate ? `Liberado até ${fmt.data(LH.datas.paraIso(new Date(LH.nuvem.ctx.organizacao.plano_ate)))}` : pago ? 'Assinatura ativa' : 'Plano Free';
      plano.innerHTML = `<span class="selo ${isento || pago ? 'selo--sucesso' : 'selo--info'}">${esc(status)}</span>
        <p>Plano <strong>${esc(LH.plano.nomeAtual())}</strong>${pago ? ` · R$ ${LH.plano.PRECOS[nivel]}/mês` : ''}</p>
        ${isento ? '' : `<a class="btn btn--primario btn--bloco btn--pequeno" href="#/perfil">${nivel === 'max' ? 'Ver assinatura' : nivel === 'pro' ? 'Fazer upgrade para o Max' : 'Assinar · Pix, crédito ou débito'}</a>`}`;
    } else {
      plano.innerHTML = `<span class="selo">Modo demonstração</span>
        <p>Dados de exemplo. Plano <strong>Max</strong> · tudo liberado</p>
        <a class="btn btn--primario btn--bloco btn--pequeno" href="#/perfil">Ver assinatura</a>`;
    }
  };

  function menuUsuario(ancora) {
    document.querySelector('.menu-usuario')?.remove();
    const caixa = document.createElement('div');
    caixa.className = 'menu-usuario card--vidro';
    caixa.setAttribute('role', 'menu');
    const r = ancora.getBoundingClientRect();
    caixa.style.top = `${r.bottom + 8}px`;
    caixa.style.right = `${Math.max(12, innerWidth - r.right)}px`;
    caixa.innerHTML = `
      <div class="menu-usuario__cabecalho"><strong>${esc(LH.nuvem.ctx?.perfil?.nome || 'Você')}</strong><span>${esc(LH.nuvem.usuario?.email || '')}</span></div>
      <a href="#/perfil" role="menuitem">${icone('usuario')} Meu perfil e assinatura</a>
      <a href="#/empresa" role="menuitem">${icone('predio')} Sua empresa</a>
      <button type="button" role="menuitem" data-sair>${icone('sair')} Sair</button>`;
    document.body.append(caixa);
    const fechar = (e) => {
      if (e && caixa.contains(e.target) && !e.target.closest('a, button')) return;
      caixa.remove();
      document.removeEventListener('click', fechar, true);
    };
    setTimeout(() => document.addEventListener('click', fechar, true));
    caixa.querySelector('[data-sair]').addEventListener('click', () => LH.nuvem.sair());
  }

  // --- Notificações (sino do topo) -----------------------------------------------------
  async function mostrarNotificacoes() {
    const docs = ((await LH.repo.documentos().catch(() => null))?.lista ?? []).map(LH.situacaoDocumento);
    const vencidos = docs.filter((s) => s.chave === 'vencido').length;
    const aVencer = docs.filter((s) => s.chave === 'avencer').length;
    let hoje = [];
    let novas = null;
    try {
      hoje = (await LH.repo.eventos()).filter((e) => e.data === LH.datas.hoje());
      novas = (await LH.repo.kpis()).novas;
    } catch { /* mostra o que der */ }
    const itens = [
      vencidos && ['alerta', `${vencidos} documento(s) vencido(s)`, 'documentos'],
      aVencer && ['relogio', `${aVencer} documento(s) vencem em até 15 dias`, 'documentos'],
      hoje.length && ['calendario', `${hoje.length} prazo(s) ou compromisso(s) hoje`, 'calendario'],
      novas != null && ['radar', `${fmt.numero(novas)} licitações novas nas últimas 24 horas`, 'buscar'],
    ].filter(Boolean);
    const fechar = LH.modal({
      titulo: 'Notificações',
      html: itens.length ? `<ul class="lista">${itens.map(([i, t, rota]) => `
        <li><a class="lista__item" href="#/${rota}" style="color:inherit"><span class="lista__icone">${icone(i)}</span><span class="lista__texto"><strong style="white-space:normal">${esc(t)}</strong></span></a></li>`).join('')}</ul>`
        : '<p>Nada novo por aqui.</p>',
    });
    document.querySelector('.modal-fundo:last-of-type')?.addEventListener('click', (e) => { if (e.target.closest('a')) fechar(); });
    document.querySelector('.ponto-aviso')?.remove();
  }

  // --- Inicialização ----------------------------------------------------------------------
  /** Liga os ouvintes da página (uma vez só). */
  function preparar() {
    montarMenu();
    botaoMenu.insertAdjacentHTML('afterbegin', icone('menu'));
    document.querySelector('.sidebar__fechar').innerHTML = icone('fechar');
    document.querySelector('.topo__sino').insertAdjacentHTML('afterbegin', icone('sino'));

    menu.addEventListener('click', (e) => {
      const grupo = e.target.closest('[data-grupo]');
      if (grupo) alternarGrupo(grupo);
    });
    document.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-acao]');
      if (alvo?.dataset.acao === 'abrir-menu') abrirMenu();
      if (alvo?.dataset.acao === 'fechar-menu') fecharMenu();
      if (alvo?.dataset.acao === 'notificacoes') mostrarNotificacoes();
      const legal = e.target.closest('[data-legal]');
      if (legal) { e.preventDefault(); LH.abrirLegal(legal.dataset.legal); }
      const usuario = e.target.closest('.topo__usuario');
      if (usuario && real()) { e.preventDefault(); menuUsuario(usuario); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });

    const busca = document.getElementById('busca-rapida');
    busca.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      LH.ir(`buscar?q=${encodeURIComponent(busca.value.trim())}`);
      busca.value = '';
    });
    window.addEventListener('hashchange', navegar);
  }

  // --- Pedido vindo da página de apresentação (index.html) --------------------------
  //   app.html?acesso=cadastrar&destino=perfil?assinar=1
  // O destino fica guardado (até 1 dia) para valer também depois de confirmar o
  // e-mail, que costuma abrir noutra aba.
  const CHAVE_DESTINO = 'licitahub:destino';
  function lerPedidoDaApresentacao() {
    const q = new URLSearchParams(location.search);
    const destino = q.get('destino');
    if (destino && /^[a-z/-]+(\?[\w=&-]*)?$/.test(destino) && LH.vistas[destino.split('?')[0]]) {
      try { localStorage.setItem(CHAVE_DESTINO, JSON.stringify({ destino, em: Date.now() })); } catch { /* sem armazenamento */ }
    }
    if (q.has('acesso') || q.has('destino')) history.replaceState(null, '', `${location.pathname}${location.hash}`);
    return { aba: q.get('acesso') };
  }
  function destinoGuardado() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_DESTINO) || 'null');
      localStorage.removeItem(CHAVE_DESTINO);
      if (salvo && Date.now() - salvo.em < 86400000) return salvo.destino;
    } catch { /* sem armazenamento */ }
    return null;
  }

  /** Mostra o sistema (depois do login, ou direto na demonstração). */
  LH.iniciarApp = () => {
    appIniciado = true;
    LH.atualizarUsuario();
    const destino = destinoGuardado();
    if (destino) history.replaceState(null, '', `#/${destino}`);
    else if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/home');
    navegar();
  };

  async function iniciar() {
    preparar();
    const pedido = lerPedidoDaApresentacao();
    let ligado = false;
    try {
      ligado = await LH.nuvem.iniciar();
    } catch (e) {
      // Ligou ao servidor, mas não conseguiu ler os dados da conta.
      ligado = true;
      LH.repo = LH.repos.real;
      LH.acesso.mostrar();
      LH.aviso(e.message, 'perigo', 9000);
      return;
    }
    // Modo ADM sem cliente logado: abre o app com os dados de DEMONSTRAÇÃO para o ADM
    // navegar pelos módulos e editar os textos fixos (que valem para todos).
    const admSemCliente = ligado && !LH.nuvem.usuario && /(?:^|;\s*)lh_adm_on=1/.test(document.cookie)
      && await fetch('/api/adm/sessao', { credentials: 'same-origin' }).then((r) => r.ok).catch(() => false);
    if (admSemCliente) ligado = false;
    LH.repo = ligado ? LH.repos.real : LH.repos.demo;
    document.body.classList.toggle('modo-demo', !ligado);
    if (ligado && !LH.nuvem.usuario) LH.acesso.mostrar('', pedido.aba);
    else LH.iniciarApp();
    // Volta do link do e-mail (confirmação de cadastro ou senha nova).
    if (LH.nuvem.erroLink) LH.aviso(LH.nuvem.erroLink, 'perigo', 9000);
    else if (LH.nuvem.linkConfirmado) LH.aviso('E-mail confirmado. Bem-vindo ao Uso LicitaHub!', 'sucesso', 6000);
  }

  iniciar();
})();
