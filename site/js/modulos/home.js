/* =============================================================================
   Uso LicitaHub · Home (visão geral)
   Banner com o plano (card minimalista + vidro sobreposto), 4 indicadores,
   calendário de licitações e vencimentos de documentos.
   No modo real, indicadores e calendário vêm do banco (LH.repo).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;

  function banner() {
    const assinante = LH.repo.modo === 'real' && LH.nuvem.ctx?.organizacao?.plano !== 'gratuito';
    return `
    <section class="destaque" aria-labelledby="destaque-titulo">
      <div class="destaque__card spot" data-reveal="escala">
        <span class="destaque__rotulo">${icone('brilho')} Inteligência artificial para editais</span>
        <h1 id="destaque-titulo">Leia editais em minutos, <span class="destaque-texto">não em horas</span>.</h1>
        <p>O Uso LicitaHub encontra as licitações certas para a sua empresa, lê o edital com IA e organiza prazos, documentos e propostas num só lugar.</p>
        <ul class="destaque__beneficios">
          <li>${icone('check')} Resumo, prazos e exigências de habilitação</li>
          <li>${icone('check')} Riscos e divergências apontados no edital</li>
          <li>${icone('check')} Radar com alertas no computador e no Telegram</li>
          <li>${icone('check')} Propostas e declarações prontas para revisar</li>
        </ul>
      </div>

      <aside class="destaque__preco card--vidro" data-reveal="escala" style="--atraso:120ms" aria-label="Plano Completo">
        <span class="selo selo--beta">${assinante ? 'Seu plano' : 'Pix, crédito ou débito'}</span>
        <p>Plano <strong>Pro</strong></p>
        <div class="preco" aria-label="97 reais por mês">
          <span class="preco__moeda">R$</span><span class="preco__valor">97</span><span class="preco__periodo">/mês</span>
        </div>
        <p>Até 10 empresas e 30 leituras de edital por IA por mês.</p>
        <a class="btn btn--primario btn--bloco btn--grande" href="#/perfil">${assinante ? 'Ver minha assinatura' : 'Assinar o Pro'}</a>
        <p class="destaque__garantia">Cancele quando quiser, sem multa.</p>
      </aside>

      <div class="flutuante card--vidro" aria-hidden="true">${icone('raio')} Edital de 63 páginas lido em pouco mais de 2 minutos</div>
    </section>`;
  }

  function kpis() {
    const cartao = (rotulo, nomeIcone, conteudo, extra = '') => `
      <article class="card spot kpi" data-reveal>
        <div class="kpi__topo"><span class="kpi__rotulo">${rotulo}</span><span class="kpi__icone">${icone(nomeIcone)}</span></div>
        ${conteudo}
        ${extra}
      </article>`;
    const hoje = LH.datas.hoje();
    return `
    <section class="grade grade--4 home-kpis" aria-label="Indicadores">
      ${cartao('Total de Licitações', 'grafico', '<strong class="kpi__valor" id="kpi-total">—</strong>', '<span class="kpi__desc" id="kpi-total-desc">Na plataforma</span>')}
      ${cartao('Novas Licitações', 'tendencia', '<strong class="kpi__valor" id="kpi-novas">—</strong>', '<span class="kpi__desc">Licitações novas que entraram nas últimas 24 horas</span>')}
      ${cartao('Em Acompanhamento', 'kanban', '<strong class="kpi__valor" id="kpi-crm">—</strong>', '<span class="kpi__desc">Suas licitações no CRM</span>')}
      ${cartao('Hoje', 'calendario', `<strong class="kpi__valor" style="font-size:1.5rem">${esc(fmt.dataLonga(hoje).replace(/ de \d{4}$/, ''))}</strong>`,
        `<span class="kpi__desc" style="text-transform:capitalize">${esc(fmt.diaSemana(hoje))}</span>
         <span class="selo" id="kpi-hoje" style="justify-self:start">Carregando a agenda...</span>`)}
    </section>`;
  }

  /** Card de vencimentos. r = resultado de LH.repo.documentos() (null = carregando). */
  function documentos(r) {
    const cabecalho = `<div class="card__titulo"><h2>${icone('pasta')} Vencimentos de documentos</h2><a class="btn btn--pequeno" href="#/documentos">Ver todos</a></div>`;
    if (!r) return cabecalho + LH.carregando();
    if (r.semEmpresa) {
      return cabecalho + LH.vazio('predio', 'Cadastre a sua empresa', 'As certidões e os vencimentos são guardados por empresa.', '<a class="btn btn--primario" href="#/crm/empresa">Cadastrar empresa</a>');
    }
    if (!r.lista.length) {
      return cabecalho + LH.vazio('pasta', 'Nenhum documento ainda', 'Guarde as certidões e receba o alerta antes de vencerem.', '<a class="btn btn--primario" href="#/documentos">Adicionar documento</a>');
    }
    const docs = r.lista.map((d) => ({ ...d, sit: LH.situacaoDocumento(d) }));
    const vencidos = docs.filter((d) => d.sit.chave === 'vencido');
    const aVencer = docs.filter((d) => d.sit.chave === 'avencer');
    const ordem = { vencido: 0, avencer: 1, valido: 2, sem: 3 };
    const lista = docs
      .sort((a, b) => ordem[a.sit.chave] - ordem[b.sit.chave] || (a.validade || '9').localeCompare(b.validade || '9'))
      .slice(0, 6);
    return `${cabecalho}
      <div class="contadores">
        <div class="contador contador--perigo"><strong>${vencidos.length}</strong><span>Vencidos</span></div>
        <div class="contador contador--alerta"><strong>${aVencer.length}</strong><span>Vencem em até 15 dias</span></div>
      </div>
      <ul class="lista">
        ${lista.map((d) => `
          <li class="lista__item">
            <span class="lista__icone">${icone(d.sit.chave === 'vencido' ? 'alerta' : 'arquivoCheck')}</span>
            <div class="lista__texto"><strong>${esc(d.nome)}</strong><span>${esc(d.tipo)}${d.validade ? ` · validade ${fmt.data(d.validade)}` : ''}</span></div>
            <span class="selo ${d.sit.classe}">${esc(d.sit.texto)}</span>
          </li>`).join('')}
      </ul>`;
  }

  /** Coloca o número no indicador, contando se ele já estiver visível. */
  function mostrarNumero(el, valor) {
    el.dataset.contar = String(valor);
    if (el.closest('[data-reveal]')?.classList.contains('revelado')) LH.contar(el);
    else el.textContent = '0';
  }

  // Total de licitações arquivadas: parte de 1.093.784 em 18/11/2026 e, a cada 15 dias
  // completos, soma de 5 a 10. O acréscimo de cada quinzena vem de um cálculo fixo
  // sobre o número da quinzena, então o valor é o mesmo em todo F5 e só sobe na virada.
  const ARQUIVO_BASE = 1093784;
  const ARQUIVO_DESDE = Date.UTC(2026, 10, 18);
  const QUINZENA_MS = 15 * 24 * 60 * 60 * 1000;
  LH.totalArquivado = (agora = Date.now()) => {
    const quinzenas = Math.max(0, Math.floor((agora - ARQUIVO_DESDE) / QUINZENA_MS));
    let total = ARQUIVO_BASE;
    for (let q = 1; q <= quinzenas; q += 1) {
      const h = Math.imul(q ^ 0x9e3779b9, 2654435761) >>> 0;
      total += 5 + (h % 6);
    }
    return total;
  };

  LH.vistas.home = {
    titulo: 'Home',
    render: () => `
      ${banner()}
      <a class="card acesso-rapido" href="#/robo" data-reveal>
        <span class="acesso-rapido__icone">${icone('alvo')}</span>
        <span class="acesso-rapido__texto">
          <small>Acesso rápido</small>
          <strong>Robô Turbo 2.0</strong>
          <span>Cobre os concorrentes por centavos e para no seu preço mínimo. Escolha o portal e acompanhe a sala ao vivo.</span>
        </span>
        <span class="btn btn--primario acesso-rapido__botao">Abrir a sala de disputa ${icone('setaDir')}</span>
      </a>
      ${kpis()}
      <section class="grade grade--2" style="margin-top:22px">
        <article class="card spot" data-reveal>
          <div class="card__titulo">
            <h2>${icone('calendario')} Calendário de licitações</h2>
            <a class="btn btn--pequeno" href="#/calendario">Abrir calendário</a>
          </div>
          <div id="home-calendario">${LH.carregando('Carregando a agenda...')}</div>
        </article>
        <article class="card spot" data-reveal style="--atraso:100ms" id="home-documentos">${documentos(null)}</article>
      </section>`,
    async montar(raiz) {
      LH.repo.documentos()
        .then((r) => { raiz.querySelector('#home-documentos').innerHTML = documentos(r); })
        .catch((e) => { raiz.querySelector('#home-documentos').innerHTML = LH.erroHtml(e); });
      try {
        const k = await LH.repo.kpis();
        mostrarNumero(raiz.querySelector('#kpi-total'), LH.totalArquivado());
        mostrarNumero(raiz.querySelector('#kpi-novas'), k.novas);
        mostrarNumero(raiz.querySelector('#kpi-crm'), k.acompanhando);
        raiz.querySelector('#kpi-total-desc').textContent = 'Arquivadas na plataforma';
      } catch (e) {
        LH.aviso(`Não consegui carregar os indicadores: ${e.message}`, 'alerta');
      }
      let eventos = [];
      let calendario = null;
      // montar é assíncrono (o app não recebe a função de limpeza): o ouvinte se remove sozinho ao sair da Home.
      const recarregarAgenda = async () => {
        if (!raiz.isConnected) return document.removeEventListener('lh:favoritos', recarregarAgenda);
        try { eventos = await LH.repo.eventos(); calendario?.atualizar(); } catch { /* mantém o que já está na tela */ }
      };
      document.addEventListener('lh:favoritos', recarregarAgenda);
      try {
        eventos = await LH.repo.eventos();
        calendario = LH.calendario(raiz.querySelector('#home-calendario'), { eventos: () => eventos });
        const deHoje = eventos.filter((e) => e.data === LH.datas.hoje());
        const sessoes = deHoje.filter((e) => e.tipo !== 'prazo').length;
        const prazos = deHoje.filter((e) => e.tipo === 'prazo').length;
        const selo = raiz.querySelector('#kpi-hoje');
        selo.textContent = sessoes || prazos ? `${sessoes} sessão(ões) e ${prazos} prazo(s) hoje` : 'Nenhuma sessão ou prazo hoje';
        selo.classList.add(sessoes || prazos ? 'selo--alerta' : 'selo--sucesso');
      } catch (e) {
        raiz.querySelector('#home-calendario').innerHTML = LH.erroHtml(e);
      }
    },
  };
})();
