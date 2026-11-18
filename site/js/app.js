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
    { etapa: 2, rotulo: 'Análise do edital', icone: 'brilho', filhos: [
      { id: 'ia/leitor', rotulo: 'Leitor de Edital IA' },
      { id: 'ia/dossie', rotulo: 'Dossiê Jurídico IA' },
    ] },
    { etapa: 3, rotulo: 'Acompanhamento', icone: 'kanban', filhos: [
      { id: 'crm', rotulo: 'CRM do Licitante' },
      { id: 'calendario', rotulo: 'Calendário' },
    ] },
    { etapa: 4, rotulo: 'Documentos e habilitação', icone: 'pasta', filhos: [
      { id: 'empresa', rotulo: 'Sua empresa' },
      { id: 'crm/empresa', rotulo: 'Cadastrar Empresa' },
      { id: 'documentos', rotulo: 'Gestor de documentos' },
      { id: 'declaracoes', rotulo: 'Gerador de declarações' },
    ] },
    { etapa: 5, rotulo: 'Preço e proposta', icone: 'arquivo', filhos: [
      { id: 'pesquisa-precos', rotulo: 'Pesquisa de Preço' },
      { id: 'ia/cotacao', rotulo: 'Cotação Online IA', tag: 'Beta' },
      { id: 'proposta/criar', rotulo: 'Criar proposta' },
      { id: 'proposta/minhas', rotulo: 'Minhas propostas' },
    ] },
    { etapa: 6, rotulo: 'Disputa', icone: 'chat', filhos: [
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
    menu.innerHTML = `<ul>${LH.menu.map((item, i) => {
      if (!item.filhos) {
        return `<li class="menu__item"><a class="menu__link" href="#/${item.id}" data-rota="${item.id}">
          ${icone(item.icone)}<span class="menu__texto">${esc(item.rotulo)}</span>${tag(item.tag)}</a></li>`;
      }
      const marca = item.etapa ? `<span class="menu__num" aria-hidden="true">${item.etapa}</span>` : icone(item.icone);
      const rotulo = item.etapa ? `<span class="sr-only">Etapa ${item.etapa}: </span>${esc(item.rotulo)}` : esc(item.rotulo);
      return `<li class="menu__item${item.etapa ? ' menu__item--etapa' : ''}">
        <button type="button" class="menu__link" aria-expanded="false" aria-controls="sub-${i}" data-grupo="${i}">
          ${marca}<span class="menu__texto">${rotulo}</span>${icone('setaBaixo', 'menu__seta')}
        </button>
        <div class="menu__sub" id="sub-${i}"><ul>${item.filhos.map((f, j) => `
          <li><a class="menu__link" href="#/${f.id}" data-rota="${f.id}">${item.etapa ? `<span class="menu__subnum">${item.etapa}.${j + 1}</span>` : ''}<span class="menu__texto">${esc(f.rotulo)}</span>${tag(f.tag)}</a></li>`).join('')}
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
    conteudo.innerHTML = `<div class="vista">${aviso}${vista.render(params)}</div>`;
    const raiz = conteudo.firstElementChild;
    const limpeza = vista.montar?.(raiz, params);
    if (typeof limpeza === 'function') desmontarAtual = limpeza;
    LH.revelar(raiz);

    marcarAtivo(caminho);
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
      const a = LH.nuvem.ctx.assinatura;
      const pago = org.plano !== 'gratuito';
      const status = a?.status === 'trialing' && a.teste_fim ? `Teste grátis até ${fmt.data(LH.datas.paraIso(new Date(a.teste_fim)))}` : pago ? 'Assinatura ativa' : 'Plano gratuito';
      plano.innerHTML = `<span class="selo ${pago ? 'selo--sucesso' : 'selo--info'}">${esc(status)}</span>
        <p>Plano <strong>${pago ? 'Completo' : 'Gratuito'}</strong>${pago ? ' · R$ 97/mês' : ''}</p>
        <a class="btn btn--primario btn--bloco btn--pequeno" href="#/perfil">${pago ? 'Ver assinatura' : 'Assinar · 30 dias grátis'}</a>`;
    } else {
      plano.innerHTML = `<span class="selo">Modo demonstração</span>
        <p>Dados de exemplo. Plano <strong>Completo</strong> · R$ 97/mês</p>
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
    LH.repo = ligado ? LH.repos.real : LH.repos.demo;
    document.body.classList.toggle('modo-demo', !ligado);
    if (ligado && !LH.nuvem.usuario) LH.acesso.mostrar('', pedido.aba);
    else LH.iniciarApp();
  }

  iniciar();
})();
