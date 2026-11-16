/* =============================================================================
   LicitaHub · Licitações
   Buscar Licitações, Radar de Licitações, Petronect (Beta) e Licitações favoritas.
   No modo real, a busca usa a função buscar_licitacoes do banco (PNCP).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ORDENS = [['relevancia', 'Mais relevantes'], ['prazo', 'Prazo mais próximo'], ['valor', 'Maior valor'], ['recentes', 'Publicadas recentemente']];

  // --- Buscar Licitações ---------------------------------------------------------
  LH.vistas.buscar = {
    titulo: 'Buscar Licitações',
    render: (p) => `
      ${LH.cabecalho({
        titulo: 'Buscar Licitações',
        texto: 'Oportunidades abertas publicadas no PNCP. Busque por palavra-chave, órgão, modalidade e local.',
        acoes: LH.repo.modo === 'demo' ? '<span class="selo">Dados de exemplo</span>' : '<span class="selo selo--sucesso">PNCP · atualizado sozinho</span>',
      })}
      <div class="grade grade--filtros">
        <form class="card form filtros" id="filtros" data-reveal="esquerda" autocomplete="off">
          <div class="card__titulo"><h2>${icone('filtro')} Filtros</h2></div>
          <label class="campo"><span class="campo__rotulo">Palavra-chave</span>
            <input name="termo" value="${esc(p.q || '')}" placeholder="ex.: limpeza, notebook, &quot;ar condicionado&quot;"></label>
          <label class="campo"><span class="campo__rotulo">Órgão</span>
            <input name="orgao" placeholder="ex.: Prefeitura, Tribunal"></label>
          <label class="campo"><span class="campo__rotulo">Modalidade</span>
            <select name="modalidade">${LH.opcoes(LH.repo.modalidades, '', 'Todas')}</select></label>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">UF</span>
              <select name="uf">${LH.opcoesUf('')}</select></label>
            <label class="campo"><span class="campo__rotulo">Município</span>
              <input name="municipio" placeholder="opcional"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Valor mínimo (R$)</span><input name="min" inputmode="decimal" placeholder="0"></label>
            <label class="campo"><span class="campo__rotulo">Valor máximo (R$)</span><input name="max" inputmode="decimal" placeholder="sem limite"></label>
          </div>
          <label class="campo"><span class="campo__rotulo">Propostas até</span><input type="date" name="ate"></label>
          <div class="form__linha">
            <button class="btn btn--primario" type="submit">${icone('busca')} Buscar</button>
            <button class="btn btn--fantasma" type="reset">Limpar</button>
          </div>
        </form>

        <section aria-live="polite">
          <div class="resultados__barra">
            <span id="contagem"></span>
            <label class="campo" style="grid-auto-flow:column;align-items:center;gap:8px">
              <span class="campo__rotulo">Ordenar por</span>
              <select id="ordem">${LH.opcoes(ORDENS, p.q ? 'relevancia' : 'prazo')}</select>
            </label>
          </div>
          <div class="resultados" id="resultados"></div>
          <div class="mais-resultados" id="mais" hidden><button class="btn" type="button">${icone('setaBaixo')} Carregar mais</button></div>
        </section>
      </div>`,
    montar(raiz) {
      const form = raiz.querySelector('#filtros');
      const ordem = raiz.querySelector('#ordem');
      const caixa = raiz.querySelector('#resultados');
      const mais = raiz.querySelector('#mais');
      let favs = new Set();
      let offset = 0;
      let total = 0;
      let pedido = 0; // ignora respostas de buscas antigas

      const ler = () => {
        const d = new FormData(form);
        return {
          termo: d.get('termo'), orgao: d.get('orgao'), modalidade: d.get('modalidade'), uf: d.get('uf'),
          municipio: d.get('municipio'), min: fmt.lerNumero(d.get('min')), max: fmt.lerNumero(d.get('max')),
          ate: d.get('ate'), ordem: ordem.value,
        };
      };
      const buscar = async (continuar = false) => {
        const meu = ++pedido;
        if (!continuar) {
          offset = 0;
          caixa.innerHTML = LH.carregando('Buscando licitações...');
          mais.hidden = true;
        }
        try {
          if (!continuar) favs = await LH.repo.favoritos();
          const r = await LH.repo.buscar(ler(), offset);
          if (meu !== pedido) return;
          if (!continuar) total = r.total ?? 0;
          const html = r.lista.map((l) => LH.cartaoLicitacao(l, favs)).join('');
          if (continuar) caixa.insertAdjacentHTML('beforeend', html);
          else caixa.innerHTML = html || LH.vazio('busca', 'Nada encontrado', 'Tente outras palavras ou tire alguns filtros.');
          offset += r.lista.length;
          raiz.querySelector('#contagem').innerHTML = `<strong>${fmt.numero(total)}</strong> licitação(ões) aberta(s)${offset < total ? ` · mostrando ${fmt.numero(offset)}` : ''}`;
          mais.hidden = offset >= total || r.lista.length < r.porPagina;
          LH.revelar(caixa);
        } catch (e) {
          if (meu === pedido) caixa.innerHTML = LH.erroHtml(e);
        }
      };

      form.addEventListener('submit', (e) => { e.preventDefault(); buscar(); });
      form.addEventListener('reset', () => setTimeout(() => buscar()));
      form.addEventListener('input', LH.atrasar(() => buscar(), 450));
      ordem.addEventListener('change', () => buscar());
      mais.querySelector('button').addEventListener('click', () => buscar(true));
      LH.ligarAcoesLicitacao(caixa);
      buscar();
    },
  };

  // --- Radar de Licitações ------------------------------------------------------------
  // A configuração dos radares fica no navegador; no modo real, as contagens e os
  // alertas saem da busca de verdade no banco.
  const ID_MODALIDADE = { 'Pregão Eletrônico': 6, 'Dispensa Eletrônica': 8, 'Concorrência Eletrônica': 4 };
  const encontra = (radar, l) => {
    const texto = normalizar(l.objeto);
    const temPalavra = !radar.palavras.length || radar.palavras.some((p) => texto.includes(normalizar(p)));
    return temPalavra
      && (!radar.ufs.length || radar.ufs.includes(l.uf))
      && (!radar.modalidades.length || radar.modalidades.includes(l.modalidade));
  };
  /** Licitações de um radar: no modo real, busca no banco; na demonstração, filtra os exemplos. */
  async function doRadar(r) {
    if (LH.repo.modo === 'demo') {
      const lista = LH.dados.licitacoes.filter((l) => encontra(r, l));
      return { lista, total: lista.length };
    }
    const termo = r.palavras.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' or ');
    const modalidades = r.modalidades.map((m) => ID_MODALIDADE[m]).filter(Boolean);
    const res = await LH.repo.buscar({ termo, ufs: r.ufs, modalidades, ordem: 'recentes' });
    return { lista: res.lista, total: res.total ?? 0 };
  }

  LH.vistas.radar = {
    titulo: 'Radar de Licitações',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Radar de Licitações',
        texto: 'Monitoramento automático: diga o que interessa à sua empresa e receba um alerta sempre que entrar uma licitação parecida.',
        acoes: `<button class="btn" type="button" data-acao="computador">${icone('computador')} Alertas no computador</button>
                <button class="btn btn--primario" type="button" data-acao="novo">${icone('mais')} Novo radar</button>`,
      })}
      <form class="card form" id="form-radar" hidden data-reveal>
        <div class="card__titulo"><h2>${icone('radar')} Novo radar</h2></div>
        <div class="form__linha">
          <label class="campo"><span class="campo__rotulo">Nome do radar</span><input name="nome" required placeholder="ex.: Material de limpeza no Sul"></label>
          <label class="campo"><span class="campo__rotulo">Palavras-chave (separe por vírgula)</span><input name="palavras" required placeholder="limpeza, higienização"></label>
          <label class="campo"><span class="campo__rotulo">UFs (separe por vírgula, vazio = todas)</span><input name="ufs" placeholder="SP, PR, SC"></label>
        </div>
        <fieldset class="campo" style="border:0;padding:0;margin:0">
          <legend class="campo__rotulo">Modalidades (nenhuma marcada = todas)</legend>
          <div class="chips">${Object.keys(ID_MODALIDADE).map((m) => `<label class="marcar chip"><input type="checkbox" name="modalidades" value="${esc(m)}"> ${esc(m)}</label>`).join('')}</div>
        </fieldset>
        <fieldset class="campo" style="border:0;padding:0;margin:0">
          <legend class="campo__rotulo">Avisar por</legend>
          <div class="chips">
            <label class="chave"><input type="checkbox" name="email" checked> E-mail</label>
            <label class="chave"><input type="checkbox" name="telegram"> Telegram</label>
            <label class="chave"><input type="checkbox" name="computador" checked> Computador</label>
          </div>
        </fieldset>
        <div class="card__rodape"><button class="btn btn--primario" type="submit">Salvar radar</button><button class="btn btn--fantasma" type="button" data-acao="cancelar">Cancelar</button></div>
      </form>
      <div class="grade grade--lateral" style="margin-top:4px">
        <section class="grade" id="radares" aria-label="Seus radares"></section>
        <aside class="card spot" data-reveal style="align-self:start">
          <div class="card__titulo"><h2>${icone('sino')} Últimos alertas</h2><span class="ao-vivo">Ao vivo</span></div>
          <ul class="lista" id="alertas">${LH.carregando()}</ul>
        </aside>
      </div>`,
    montar(raiz) {
      const form = raiz.querySelector('#form-radar');
      const desenhar = async () => {
        const radares = await LH.repo.radares().catch((e) => { LH.aviso(e.message, 'perigo'); return []; });
        const caixa = raiz.querySelector('#radares');
        const resultados = await Promise.all(radares.map((r) => doRadar(r).catch(() => ({ lista: [], total: null }))));
        caixa.innerHTML = radares.length ? radares.map((r, i) => {
          const qtd = resultados[i].total;
          return `
          <article class="card spot" data-reveal>
            <div class="card__titulo">
              <h3>${icone('radar')} ${esc(r.nome)}</h3>
              <label class="chave"><input type="checkbox" data-alternar="${r.id}" ${r.ativo ? 'checked' : ''}> ${r.ativo ? 'Ligado' : 'Desligado'}</label>
            </div>
            <div class="chips">${r.palavras.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>
            <p class="fraco" style="margin-top:10px">${r.ufs.length ? `UFs: ${esc(r.ufs.join(', '))}` : 'Todas as UFs'} · ${r.modalidades.length ? esc(r.modalidades.join(', ')) : 'Todas as modalidades'}</p>
            <div class="card__rodape">
              <span class="selo selo--info">${qtd == null ? 'Sem conexão' : `${fmt.numero(qtd)} licitação(ões) abertas agora`}</span>
              ${r.canais.email ? `<span class="selo">${icone('email')} E-mail</span>` : ''}
              ${r.canais.telegram ? `<span class="selo">${icone('telegram')} Telegram</span>` : ''}
              ${r.canais.computador ? `<span class="selo">${icone('computador')} Computador</span>` : ''}
              <button class="btn btn--pequeno btn--perigo" type="button" data-excluir="${r.id}" style="margin-left:auto">${icone('lixeira')} Excluir</button>
            </div>
          </article>`;
        }).join('') : `<div class="card">${LH.vazio('radar', 'Nenhum radar ainda', 'Crie um radar para ser avisado das novas licitações.')}</div>`;

        // Alertas: as mais recentes de cada radar ligado
        const vistos = new Set();
        const alertas = radares.flatMap((r, i) => (r.ativo ? resultados[i].lista.slice(0, 4) : []))
          .filter((l) => !vistos.has(l.id) && vistos.add(l.id))
          .sort((a, b) => String(b.publicada).localeCompare(String(a.publicada))).slice(0, 6);
        raiz.querySelector('#alertas').innerHTML = alertas.length ? alertas.map((l) => `
          <li class="lista__item">
            <span class="lista__icone">${icone('sino')}</span>
            <div class="lista__texto"><strong>${esc(l.objeto)}</strong><span>${esc(l.uf)} · ${l.valor == null ? 'valor sigiloso' : fmt.moeda(l.valor)}${l.publicada ? ` · publicada ${fmt.relativo(l.publicada)}` : ''}</span></div>
            <button class="btn-icone btn-icone--pequeno" type="button" data-acao="detalhes" data-id="${l.id}" aria-label="Ver detalhes">${icone('olho')}</button>
          </li>`).join('') : '<li class="fraco">Ligue um radar para ver os alertas.</li>';
        LH.revelar(raiz);
      };

      LH.ao(raiz, 'click', '[data-acao]', async (e, b) => {
        if (b.dataset.acao === 'novo') { form.hidden = false; form.classList.add('revelado'); form.nome.focus(); }
        if (b.dataset.acao === 'cancelar') { form.reset(); form.hidden = true; }
        if (b.dataset.acao === 'detalhes') LH.detalhesLicitacao(b.dataset.id);
        if (b.dataset.acao === 'computador') {
          if (!('Notification' in window)) return LH.aviso('Este navegador não mostra alertas no computador.', 'alerta');
          const ok = (await Notification.requestPermission()) === 'granted';
          if (ok) LH.notificar('LicitaHub', 'Pronto! Os alertas do Radar vão aparecer assim no seu computador.');
          LH.aviso(ok ? 'Alertas no computador ligados.' : 'O navegador não deu permissão para alertas.', ok ? 'sucesso' : 'alerta');
        }
      });
      LH.ao(raiz, 'change', '[data-alternar]', async (e, chave) => {
        try {
          const r = (await LH.repo.radares()).find((x) => String(x.id) === chave.dataset.alternar);
          await LH.repo.salvarRadar({ ...r, ativo: chave.checked });
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        desenhar();
      });
      LH.ao(raiz, 'click', '[data-excluir]', async (e, b) => {
        if (!(await LH.confirmar('Excluir radar', 'Este radar deixa de enviar alertas. Continuar?', 'Excluir', true))) return;
        try { await LH.repo.removerRadar(b.dataset.excluir); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        desenhar();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = new FormData(form);
        const lista = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
        const botao = form.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          await LH.repo.salvarRadar({
            nome: d.get('nome').trim(), palavras: lista(d.get('palavras')),
            ufs: lista(d.get('ufs')).map((u) => u.toUpperCase()).filter((u) => LH.dados.UFS.includes(u)),
            modalidades: d.getAll('modalidades'),
            canais: { email: d.get('email') === 'on', telegram: d.get('telegram') === 'on', computador: d.get('computador') === 'on' },
            ativo: true,
          });
          form.reset();
          form.hidden = true;
          LH.aviso('Radar criado. Você será avisado das novas licitações.', 'sucesso');
          desenhar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        botao.disabled = false;
      });
      desenhar();
    },
  };

  // --- Petronect (Beta) ---------------------------------------------------------------
  LH.vistas.petronect = {
    titulo: 'Petronect',
    local: 'As oportunidades da Petronect ainda são de exemplo: a leitura das informações públicas do portal entra numa próxima etapa. O "Lembrar prazo" já grava no seu calendário.',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Petronect <span class="selo selo--beta" style="vertical-align:middle">Beta</span>',
        texto: 'Oportunidades de compra da Petrobras publicadas no portal Petronect, num só lugar com as suas licitações.',
      })}
      <p class="nota" data-reveal>${icone('info')} Módulo em teste. Os dados abaixo são de exemplo; a versão final usa só as informações públicas do portal.</p>
      <section class="card spot" data-reveal style="margin-top:18px">
        <div class="form__linha" style="margin-bottom:16px">
          <label class="campo"><span class="campo__rotulo">Buscar</span><input id="pn-busca" placeholder="ex.: válvulas, manutenção"></label>
          <label class="campo"><span class="campo__rotulo">Categoria</span>
            <select id="pn-categoria">${LH.opcoes([...new Set(LH.dados.petronect.map((o) => o.categoria))], '', 'Todas')}</select></label>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Oportunidade</th><th>Descrição</th><th>Categoria</th><th>Prazo</th><th>Situação</th><th></th></tr></thead>
            <tbody id="pn-linhas"></tbody>
          </table>
        </div>
      </section>`,
    montar(raiz) {
      const desenhar = () => {
        const q = normalizar(raiz.querySelector('#pn-busca').value);
        const cat = raiz.querySelector('#pn-categoria').value;
        const linhas = LH.dados.petronect.filter((o) => (!q || normalizar(o.descricao).includes(q)) && (!cat || o.categoria === cat));
        raiz.querySelector('#pn-linhas').innerHTML = linhas.length ? linhas.map((o) => `
          <tr>
            <td><strong>${esc(o.numero)}</strong></td>
            <td>${esc(o.descricao)}</td>
            <td>${esc(o.categoria)}</td>
            <td>${fmt.data(o.limite)}<br><span class="fraco">${fmt.relativo(o.limite)}</span></td>
            <td><span class="selo ${o.status === 'Encerrando' ? 'selo--alerta' : 'selo--sucesso'}">${esc(o.status)}</span></td>
            <td><button class="btn btn--pequeno" type="button" data-lembrar="${esc(o.numero)}">${icone('calendario')} Lembrar prazo</button></td>
          </tr>`).join('') : '<tr><td colspan="6" class="fraco">Nenhuma oportunidade encontrada.</td></tr>';
      };
      raiz.querySelector('#pn-busca').addEventListener('input', LH.atrasar(desenhar, 200));
      raiz.querySelector('#pn-categoria').addEventListener('change', desenhar);
      LH.ao(raiz, 'click', '[data-lembrar]', async (e, b) => {
        const o = LH.dados.petronect.find((x) => x.numero === b.dataset.lembrar);
        const titulo = `Petronect ${o.numero}: prazo final`;
        try {
          if ((await LH.repo.eventosProprios()).some((ev) => ev.titulo === titulo)) return LH.aviso('Este prazo já está no calendário.', 'info');
          await LH.repo.salvarEvento({ data: o.limite, hora: '12:00', titulo, detalhe: o.descricao, tipo: 'prazo' });
          LH.aviso('Prazo adicionado ao calendário.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      desenhar();
    },
  };

  // --- Licitações favoritas -----------------------------------------------------------
  LH.vistas.favoritas = {
    titulo: 'Licitações favoritas',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Licitações favoritas',
        texto: 'Os editais que você salvou para acompanhar de perto.',
        acoes: `<a class="btn" href="#/buscar">${icone('busca')} Buscar mais</a>`,
      })}
      <div class="resultados" id="favoritas">${LH.carregando()}</div>`,
    montar(raiz) {
      const caixa = raiz.querySelector('#favoritas');
      const desenhar = async () => {
        try {
          const favs = await LH.repo.favoritos();
          const lista = (await LH.repo.licitacoes([...favs]))
            .sort((a, b) => String(a.abertura || '9999').localeCompare(String(b.abertura || '9999')));
          caixa.innerHTML = lista.length
            ? lista.map((l) => LH.cartaoLicitacao(l, favs)).join('')
            : `<div class="card">${LH.vazio('estrela', 'Nenhuma favorita ainda', 'Toque na estrela de uma licitação para guardá-la aqui.', '<a class="btn btn--primario" href="#/buscar">Buscar licitações</a>')}</div>`;
          LH.revelar(caixa);
        } catch (e) {
          caixa.innerHTML = LH.erroHtml(e);
        }
      };
      LH.ligarAcoesLicitacao(caixa, desenhar);
      desenhar();
    },
  };
})();
