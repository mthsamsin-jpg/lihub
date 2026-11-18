/* =============================================================================
   Uso LicitaHub · Feed Global de Pregões ao Vivo (tela do Licita Lances)
   Ao abrir o robô, a tela já mostra os pregões eletrônicos reais com propostas
   abertas (base sincronizada com a API do PNCP, atualizada sozinha), sem precisar
   cadastrar nada. Cada card tem:
     - Monitorar: cria (ou reaproveita) o item do robô ligado à licitação e abre a
       sala na hora (simulada ou real, conforme o switch do topo). O item nasce em
       modo seguro: piso = teto, então o robô nunca desce de preço até você ajustar.
     - Conectar ao modo real: abre o cadastro para informar custo e preço mínimo e,
       ao salvar, segue para o cofre de credenciais e a conexão com o portal.
   Os chips de portal do topo filtram este feed e os itens do robô ao mesmo tempo.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone } = LH;
  const POR_VEZ = 12;
  const ATUALIZAR_MS = 120_000;
  const moeda = (v) => (v == null ? 'Sigiloso / não informado' : LH.fmt.moeda(v));

  const chaveDoPortal = (l) => LH.plataformaDe?.(l.plataforma) || 'outros';

  /** "encerra em 2 d 4 h" / "encerra hoje às 14:00" / "encerrada". */
  function prazo(l) {
    if (!l.abertura) return 'Data não informada';
    const fim = new Date(`${l.abertura}T${l.hora || '23:59'}:00`);
    const ms = fim - Date.now();
    if (ms <= 0) return 'Propostas encerradas';
    const h = Math.floor(ms / 3_600_000);
    if (h < 24) return `Encerra hoje às ${l.hora || '23:59'}`;
    return `Encerra em ${Math.floor(h / 24)} d ${h % 24} h`;
  }

  /** Modalidade "Pregão Eletrônico" no formato que o repositório usa (id do PNCP ou nome). */
  function filtroPregao() {
    const m = (LH.repo.modalidades || []).find(([, nome]) => /preg[aã]o.*eletr/i.test(nome));
    return m ? { modalidades: [m[0]] } : {};
  }

  /**
   * @param {HTMLElement} caixa
   * @param {object} o
   * @param {() => string} o.filtro               chave do portal escolhida nos chips ('' = todos)
   * @param {(l) => object|null} o.itemDe          item do robô já ligado à licitação
   * @param {(l) => void} o.aoMonitorar
   * @param {(l) => void} o.aoConectar
   */
  function ligar(caixa, { filtro, itemDe, aoMonitorar, aoConectar }) {
    let lista = [];
    let offset = 0;
    let total = null;
    let mostrar = POR_VEZ;
    let carregando = false;
    let ultimaAtualizacao = null;

    caixa.innerHTML = `
      <div class="feed-vivo__topo">
        <div><h2>${icone('raio')} Pregões ao vivo</h2>
          <p class="fraco" data-feed-resumo>Pregões eletrônicos com propostas abertas em todos os portais, direto da base do PNCP.</p></div>
        <div class="feed-vivo__acoes"><span class="robo-chat__ao-vivo" data-feed-hora><i></i> atualizando</span>
          <button type="button" class="btn btn--pequeno btn--fantasma" data-feed-atualizar>${icone('atualizar')} Atualizar</button></div>
      </div>
      <div class="feed-vivo__grade" data-feed-grade>${LH.carregando('Buscando pregões abertos...')}</div>
      <div class="mais-resultados" data-feed-mais hidden><button type="button" class="btn">${icone('setaBaixo')} Mais pregões</button></div>`;
    const grade = caixa.querySelector('[data-feed-grade]');
    const mais = caixa.querySelector('[data-feed-mais]');
    const resumo = caixa.querySelector('[data-feed-resumo]');
    const hora = caixa.querySelector('[data-feed-hora]');

    const cartao = (l) => {
      const chave = chaveDoPortal(l);
      const item = itemDe(l);
      const ativo = item && ['running', 'paused', 'stopped_at_floor'].includes(item.status);
      const situacao = item
        ? `<span class="feed-vivo__no-robo${ativo ? ' feed-vivo__no-robo--ativo' : ''}">${icone('alvo')} ${ativo ? (item.status === 'running' ? 'Monitorando agora' : item.status === 'paused' ? 'Pausado no Licita Lances' : 'Preço mínimo atingido') : 'Já está no Licita Lances'}</span>`
        : '';
      return `
      <article class="feed-vivo__card${ativo ? ' feed-vivo__card--ativo' : ''}" data-feed-id="${esc(l.id)}">
        <header>${LH.portaisRobo.selo(chave)}${chave === 'outros' ? `<span class="fraco feed-vivo__sistema" title="${esc(l.plataforma)}">${esc(l.plataforma)}</span>` : ''}</header>
        <h3 title="${esc(l.objeto)}">${esc(l.objeto)}</h3>
        <p class="feed-vivo__orgao">${esc(l.orgao)}${l.municipio ? ` · ${esc(l.municipio)}/${esc(l.uf)}` : ` · ${esc(l.uf)}`}</p>
        <dl>
          <div><dt>Pregão</dt><dd>${esc(l.edital || l.numero)}</dd></div>
          <div><dt>Valor estimado</dt><dd>${moeda(l.valor)}</dd></div>
        </dl>
        <p class="feed-vivo__prazo">${icone('relogio')} ${prazo(l)}</p>
        ${situacao}
        <footer>
          <button type="button" class="btn btn--pequeno btn--primario" data-feed-monitorar="${esc(l.id)}">${icone(ativo ? 'alvo' : 'olho')} ${ativo ? 'Ver sala' : 'Monitorar'}</button>
          <button type="button" class="btn btn--pequeno" data-feed-conectar="${esc(l.id)}">${icone('plugue')} Conectar ao modo real</button>
          ${l.linkDisputa ? `<a class="btn btn--pequeno btn--fantasma" href="${esc(l.linkDisputa)}" target="_blank" rel="noopener" aria-label="Abrir no portal">${icone('externo')}</a>` : ''}
        </footer>
      </article>`;
    };

    const visiveis = () => {
      const f = filtro();
      // PNCP: todos os pregões do feed vieram do PNCP.
      return !f || f === 'pncp' ? lista : lista.filter((l) => chaveDoPortal(l) === f);
    };

    function desenhar() {
      if (carregando && !lista.length) return;
      const v = visiveis();
      const f = filtro();
      if (!v.length) {
        grade.innerHTML = `<p class="nota">${icone('info')} ${lista.length
          ? `Nenhum pregão aberto de ${esc(LH.portaisRobo.de(f).nome)} entre os carregados. Clique em <b>Mais pregões</b> ou escolha outro portal.`
          : 'Nenhum pregão eletrônico com propostas abertas agora.'}</p>`;
      } else grade.innerHTML = v.slice(0, mostrar).map(cartao).join('');
      const temMais = v.length > mostrar || (total == null || offset < total);
      mais.hidden = !temMais;
      resumo.textContent = `${total != null ? `${total.toLocaleString('pt-BR')} pregões eletrônicos com propostas abertas` : 'Pregões eletrônicos com propostas abertas'} em todos os portais, direto da base do PNCP${f && f !== 'pncp' ? ` · mostrando ${LH.portaisRobo.de(f).nome}` : ''}.`;
    }

    async function carregar({ novo = false } = {}) {
      if (carregando) return;
      carregando = true;
      hora.innerHTML = '<i></i> atualizando';
      try {
        if (novo) { offset = 0; lista = []; mostrar = POR_VEZ; }
        const r = await LH.repo.buscar({ ...filtroPregao(), ordem: 'prazo' }, offset);
        const vistos = new Set(lista.map((l) => l.id));
        lista = lista.concat((r.lista || []).filter((l) => !vistos.has(l.id)));
        offset += r.porPagina || r.lista?.length || 0;
        total = r.total ?? (r.lista?.length < (r.porPagina || 20) ? lista.length : total);
        ultimaAtualizacao = new Date();
        hora.innerHTML = `<i></i> ao vivo · ${ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      } catch (e) {
        if (!lista.length) grade.innerHTML = LH.erroHtml(e);
        hora.textContent = 'sem conexão';
      } finally {
        carregando = false;
      }
      desenhar();
    }

    const porId = (id) => lista.find((l) => String(l.id) === String(id));
    caixa.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-feed-atualizar')) carregar({ novo: true });
      else if (b.closest('[data-feed-mais]')) {
        mostrar += POR_VEZ;
        if (visiveis().length < mostrar && (total == null || offset < total)) carregar(); else desenhar();
      } else if (b.dataset.feedMonitorar) { const l = porId(b.dataset.feedMonitorar); if (l) aoMonitorar(l); }
      else if (b.dataset.feedConectar) { const l = porId(b.dataset.feedConectar); if (l) aoConectar(l); }
    });

    carregar();
    // Feed contínuo: recarrega sozinho (prazos e pregões novos).
    const relogio = setInterval(() => { if (document.visibilityState === 'visible') carregar({ novo: true }); }, ATUALIZAR_MS);
    return { desenhar, parar: () => clearInterval(relogio) };
  }

  LH.roboFeed = { ligar, chaveDoPortal };
}());
