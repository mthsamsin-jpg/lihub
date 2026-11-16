/* =============================================================================
   LicitaHub · componentes.js
   Peças de interface usadas por vários módulos: cabeçalho de página, estado
   vazio, card de licitação (com favoritar / IA / CRM), situação de documentos
   e o calendário interativo.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone, fmt } = LH;

  /** Cabeçalho padrão das páginas (textos fixos do sistema, não do usuário). */
  LH.cabecalho = ({ titulo, texto = '', acoes = '' }) => `
    <header class="pagina__cabecalho" data-reveal>
      <div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
      ${acoes ? `<div class="pagina__acoes">${acoes}</div>` : ''}
    </header>`;

  LH.vazio = (nomeIcone, titulo, texto = '', acao = '') => `
    <div class="vazio">${icone(nomeIcone)}<strong>${titulo}</strong>${texto ? `<p>${texto}</p>` : ''}${acao}</div>`;

  LH.carregando = (texto = 'Carregando...') => `<div class="carregando">${icone('atualizar', 'girando')} ${texto}</div>`;
  LH.erroHtml = (e) => `<p class="nota nota--alerta">${icone('alerta')} ${esc(e?.message || e)}</p>`;

  LH.opcoesUf = (selecionada, vazio = 'Todas') => LH.opcoes(LH.dados.UFS, selecionada, vazio);
  LH.opcoesMunicipio = (uf, selecionado) =>
    LH.opcoes(LH.dados.MUNICIPIOS[uf] || [], selecionado, uf ? 'Todos os municípios' : 'Escolha a UF primeiro');

  // --- Situação de um documento pela data de validade ---------------------------
  LH.situacaoDocumento = (doc) => {
    if (!doc.validade) return { chave: 'sem', classe: '', texto: 'Sem validade' };
    const dias = LH.datas.diasAte(doc.validade);
    if (dias < 0) return { chave: 'vencido', classe: 'selo--perigo', texto: `Vencido ${fmt.relativo(doc.validade)}` };
    if (dias <= 15) return { chave: 'avencer', classe: 'selo--alerta', texto: dias === 0 ? 'Vence hoje' : `Vence ${fmt.relativo(doc.validade)}` };
    return { chave: 'valido', classe: 'selo--sucesso', texto: `Válido até ${fmt.data(doc.validade)}` };
  };

  // --- Card de licitação -----------------------------------------------------------
  const valorTexto = (l) => (l.valor == null ? 'Valor sigiloso' : fmt.moeda(l.valor));
  const prazoTexto = (l) => (l.abertura ? `Propostas até ${fmt.data(l.abertura)}${l.hora ? ` às ${esc(l.hora)}` : ''}` : 'Prazo não informado');

  /** favs: Set com os ids favoritados (vem do LH.repo). */
  LH.cartaoLicitacao = (l, favs = new Set()) => {
    const fav = favs.has(l.id);
    const dias = l.abertura ? LH.datas.diasAte(l.abertura) : 99;
    return `
    <article class="card spot licitacao" data-reveal>
      <div class="licitacao__topo">
        <div>
          <div class="chips">
            <span class="selo selo--info">${esc(l.modalidade)}</span>
            <span class="selo">${esc(l.numero)}</span>
            ${l.me_epp ? '<span class="selo selo--sucesso">Exclusiva ME/EPP</span>' : ''}
            ${dias >= 0 && dias <= 3 ? `<span class="selo selo--alerta">${icone('relogio')} Encerra ${fmt.relativo(l.abertura)}</span>` : ''}
          </div>
          <h3 class="licitacao__objeto" style="margin-top:10px">${esc(l.objeto)}</h3>
          <p class="licitacao__orgao">${esc(l.orgao)}</p>
        </div>
        <button type="button" class="btn-icone btn-icone--pequeno ${fav ? 'ligado' : ''}" data-acao="favoritar" data-id="${l.id}"
          aria-pressed="${fav}" aria-label="${fav ? 'Tirar dos favoritos' : 'Favoritar'}">${icone('estrela')}</button>
      </div>
      <div class="licitacao__info">
        <span>${icone('local')} ${esc([l.municipio, l.uf].filter(Boolean).join('/'))}</span>
        <span>${icone('calendario')} ${prazoTexto(l)}</span>
        <span>${icone('moeda')} <b class="licitacao__valor">${valorTexto(l)}</b></span>
        <span>${icone('computador')} ${esc(l.plataforma)}</span>
      </div>
      <div class="licitacao__acoes">
        <button type="button" class="btn btn--pequeno" data-acao="detalhes" data-id="${l.id}">${icone('olho')} Detalhes</button>
        <button type="button" class="btn btn--pequeno" data-acao="ler-ia" data-id="${l.id}">${icone('brilho')} Ler edital com IA</button>
        <button type="button" class="btn btn--pequeno" data-acao="crm" data-id="${l.id}">${icone('kanban')} Acompanhar no CRM</button>
      </div>
    </article>`;
  };

  /** Coloca a licitação na primeira etapa do CRM (se ainda não estiver lá). */
  LH.enviarParaCrm = async (id) => {
    try {
      await LH.repo.adicionarAoCrm(id);
      LH.aviso('Licitação adicionada ao CRM, na etapa "Triagem".', 'sucesso');
      return true;
    } catch (e) {
      if (e.codigo === 'sem_empresa') {
        LH.modal({
          titulo: 'Cadastre a sua empresa',
          html: '<p>No CRM, cada licitação é acompanhada por uma empresa (com CNPJ). Cadastre a sua empresa primeiro; leva menos de um minuto.</p>',
          acoes: [
            { rotulo: 'Agora não', classe: 'btn--fantasma' },
            { rotulo: 'Cadastrar empresa', classe: 'btn--primario', acao: (f) => { f(); LH.ir('crm/empresa'); } },
          ],
        });
      } else {
        LH.aviso(e.message, e.codigo === 'ja_existe' ? 'info' : 'perigo');
      }
      return false;
    }
  };

  LH.detalhesLicitacao = (id) => {
    const l = LH.licitacaoEmCache(id);
    if (!l) return;
    const links = [
      l.linkPncp && `<a class="btn btn--pequeno" href="${esc(l.linkPncp)}" target="_blank" rel="noopener noreferrer">${icone('externo')} Ver no PNCP</a>`,
      l.linkDisputa && `<a class="btn btn--pequeno" href="${esc(l.linkDisputa)}" target="_blank" rel="noopener noreferrer">${icone('computador')} Sala de disputa</a>`,
    ].filter(Boolean).join('');
    LH.modal({
      titulo: l.numero,
      html: `
        <p style="color:var(--texto);font-weight:600">${esc(l.objeto)}</p>
        <dl class="ficha">
          <div><dt>Órgão</dt><dd>${esc(l.orgao)}</dd></div>
          <div><dt>Local</dt><dd>${esc([l.municipio, l.uf].filter(Boolean).join('/'))}</dd></div>
          <div><dt>Modalidade</dt><dd>${esc(l.modalidade)}</dd></div>
          <div><dt>Valor estimado</dt><dd>${valorTexto(l)}</dd></div>
          <div><dt>Prazo das propostas</dt><dd>${prazoTexto(l).replace('Propostas até ', '')}</dd></div>
          <div><dt>Plataforma</dt><dd>${esc(l.plataforma)}</dd></div>
          <div><dt>Publicada</dt><dd>${l.publicada ? fmt.data(l.publicada) : '—'} (fonte: ${esc(l.fonte)})</dd></div>
        </dl>
        ${links ? `<div class="chips">${links}</div>` : ''}
        ${LH.repo.modo === 'demo' ? '<p class="fraco">Dados de exemplo (modo demonstração).</p>' : ''}`,
      acoes: [
        { rotulo: 'Fechar', classe: 'btn--fantasma' },
        { rotulo: 'Ler edital com IA', classe: 'btn--primario', acao: (f) => { f(); LH.ir(`ia/leitor?id=${l.id}`); } },
      ],
    });
  };

  /** Liga os botões dos cards de licitação dentro da raiz. aoMudar() redesenha a lista. */
  LH.ligarAcoesLicitacao = (raiz, aoMudar) => {
    LH.ao(raiz, 'click', '[data-acao]', async (e, botao) => {
      const id = Number(botao.dataset.id);
      switch (botao.dataset.acao) {
        case 'favoritar': {
          botao.disabled = true;
          try {
            const ficou = await LH.repo.alternarFavorito(id);
            botao.classList.toggle('ligado', ficou);
            botao.setAttribute('aria-pressed', String(ficou));
            botao.setAttribute('aria-label', ficou ? 'Tirar dos favoritos' : 'Favoritar');
            LH.aviso(ficou ? 'Licitação salva nas favoritas.' : 'Licitação removida das favoritas.', ficou ? 'sucesso' : 'info');
            aoMudar?.();
          } catch (erro) {
            LH.aviso(erro.message, 'perigo');
          } finally {
            botao.disabled = false;
          }
          break;
        }
        case 'detalhes': LH.detalhesLicitacao(id); break;
        case 'ler-ia': LH.ir(`ia/leitor?id=${id}`); break;
        case 'crm': LH.enviarParaCrm(id); break;
        default: break;
      }
    });
  };

  // --- Agenda: junta sessões, prazos, vencimentos e eventos do usuário ---------------
  LH.agenda = {
    eventos() {
      const proprios = LH.estado.obter('eventos');
      const vencimentos = LH.estado.obter('documentos')
        .filter((d) => d.validade)
        .map((d) => ({ id: `v${d.id}`, data: d.validade, hora: '23:59', titulo: `Vence: ${d.nome}`, detalhe: 'Gestor de documentos', tipo: 'prazo' }));
      return [...LH.dados.eventosPadrao, ...proprios, ...vencimentos]
        .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    },
  };

  // --- Calendário interativo --------------------------------------------------------
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const TIPOS = { sessao: 'Sessão', prazo: 'Prazo', abertura: 'Abertura' };

  /**
   * Desenha um calendário mensal dentro de `el`.
   * opcoes: { grande, eventos: () => lista, aoSelecionar(dataIso) }
   */
  LH.calendario = (el, { grande = false, eventos = LH.agenda.eventos, aoSelecionar } = {}) => {
    const agora = new Date();
    let ano = agora.getFullYear();
    let mes = agora.getMonth();
    let selecionado = LH.datas.hoje();

    const desenhar = () => {
      const lista = eventos();
      const porDia = {};
      for (const ev of lista) (porDia[ev.data] ||= []).push(ev);

      const inicio = new Date(ano, mes, 1).getDay();
      const celulas = [];
      for (let i = 0; i < 42; i++) {
        const d = new Date(ano, mes, 1 - inicio + i);
        const iso = LH.datas.paraIso(d);
        const doDia = porDia[iso] || [];
        const classes = ['cal__dia'];
        if (d.getMonth() !== mes) classes.push('cal__dia--fora');
        if (iso === LH.datas.hoje()) classes.push('cal__dia--hoje');
        if (iso === selecionado) classes.push('cal__dia--selecionado');
        const pontos = doDia.slice(0, 3).map((ev) => `<i class="${ev.tipo}"></i>`).join('');
        celulas.push(`<button type="button" class="${classes.join(' ')}" data-dia="${iso}"
          aria-label="${d.getDate()} de ${MESES[d.getMonth()]}${doDia.length ? `, ${doDia.length} evento(s)` : ''}"
          ${iso === selecionado ? 'aria-current="date"' : ''}>${d.getDate()}${pontos ? `<span class="cal__pontos">${pontos}</span>` : ''}</button>`);
        if (i === 34 && new Date(ano, mes, 1 - inicio + 35).getMonth() !== mes) break; // 5 semanas bastam
      }

      const doSelecionado = porDia[selecionado] || [];
      const anos = [ano - 1, ano, ano + 1, ano + 2];
      el.innerHTML = `
        <div class="cal ${grande ? 'cal--grande' : ''}">
          <div class="cal__cabecalho">
            <button type="button" class="btn-icone btn-icone--pequeno" data-cal="anterior" aria-label="Mês anterior">${icone('setaEsq')}</button>
            <div class="cal__mes">
              <select data-cal="mes" aria-label="Mês">${MESES.map((m, i) => `<option value="${i}"${i === mes ? ' selected' : ''}>${m}</option>`).join('')}</select>
              <select data-cal="ano" aria-label="Ano">${anos.map((a) => `<option${a === ano ? ' selected' : ''}>${a}</option>`).join('')}</select>
            </div>
            <button type="button" class="btn btn--pequeno" data-cal="hoje">Hoje</button>
            <button type="button" class="btn-icone btn-icone--pequeno" data-cal="proximo" aria-label="Próximo mês">${icone('setaDir')}</button>
          </div>
          <div class="cal__semana">${SEMANA.map((s) => `<span>${s}</span>`).join('')}</div>
          <div class="cal__grade">${celulas.join('')}</div>
          <div class="cal__eventos">
            <h4>${fmt.dataLonga(selecionado)} · ${fmt.diaSemana(selecionado)}</h4>
            ${doSelecionado.length ? doSelecionado.map((ev) => `
              <div class="evento evento--${ev.tipo}">
                <span class="evento__hora">${esc(ev.hora === '23:59' ? 'Dia' : ev.hora)}</span>
                <div class="evento__texto">${esc(ev.titulo)}<span>${esc(TIPOS[ev.tipo] || 'Evento')} · ${esc(ev.detalhe || '')}</span></div>
              </div>`).join('') : '<p class="fraco">Nenhum evento neste dia.</p>'}
          </div>
        </div>`;
    };

    const irPara = (novoAno, novoMes) => {
      const d = new Date(novoAno, novoMes, 1);
      ano = d.getFullYear();
      mes = d.getMonth();
      desenhar();
    };

    el.addEventListener('click', (e) => {
      const dia = e.target.closest('[data-dia]');
      if (dia) {
        selecionado = dia.dataset.dia;
        const d = LH.datas.paraData(selecionado);
        if (d.getMonth() !== mes || d.getFullYear() !== ano) { ano = d.getFullYear(); mes = d.getMonth(); }
        desenhar();
        el.querySelector(`[data-dia="${selecionado}"]`)?.focus();
        aoSelecionar?.(selecionado);
        return;
      }
      const botao = e.target.closest('button[data-cal]');
      if (!botao) return;
      if (botao.dataset.cal === 'anterior') irPara(ano, mes - 1);
      if (botao.dataset.cal === 'proximo') irPara(ano, mes + 1);
      if (botao.dataset.cal === 'hoje') {
        selecionado = LH.datas.hoje();
        irPara(agora.getFullYear(), agora.getMonth());
        aoSelecionar?.(selecionado);
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.dataset.cal === 'mes') irPara(ano, Number(e.target.value));
      if (e.target.dataset.cal === 'ano') irPara(Number(e.target.value), mes);
    });

    desenhar();
    return { atualizar: desenhar, selecionado: () => selecionado };
  };
})();
