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
  /** Modalidade com o nível de documentação estimado ("Dispensa · documentação simplificada"). */
  const comDocumentacao = ([valor, nome]) => {
    const nivel = LH.NIVEIS_DOCUMENTACAO.find(([, , , re]) => re.test(nome));
    return [valor, nivel ? `${nome} · documentação ${nivel[1].toLowerCase()}` : nome];
  };
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
            <select name="modalidade">${LH.opcoes(LH.repo.modalidades.map(comDocumentacao), '', 'Todas')}</select></label>
          <details class="perfil-legenda">
            <summary>${icone('info')} Como ler o perfil do órgão</summary>
            <p><strong>Esfera</strong>: municipal, estadual ou federal, como o órgão está registrado no PNCP.</p>
            <p><strong>Documentação</strong>: estimativa pela modalidade (Lei 14.133/2021). Na dispensa, parte da habilitação pode ser dispensada (art. 70); na concorrência, costuma ser pedida completa. Confira sempre no edital.</p>
          </details>
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

  // --- Radar de Licitações (busca regional com mapa) -----------------------------------
  // Mapa do Brasil em "ladrilhos": cada estado é um quadrado na posição aproximada
  // do mapa (coluna, linha). Clicar seleciona; os municípios refinam a busca.
  const ID_MODALIDADE = { 'Pregão Eletrônico': 6, 'Dispensa Eletrônica': 8, 'Concorrência Eletrônica': 4 };
  const MAX_TERMOS = 20;
  const MAX_MUNICIPIOS = 50;
  const ESTADOS = {
    RR: ['Roraima', 'norte', 3, 1], AP: ['Amapá', 'norte', 5, 1],
    AM: ['Amazonas', 'norte', 2, 2], PA: ['Pará', 'norte', 4, 2], MA: ['Maranhão', 'nordeste', 5, 2], CE: ['Ceará', 'nordeste', 6, 2], RN: ['Rio Grande do Norte', 'nordeste', 7, 2],
    AC: ['Acre', 'norte', 1, 3], RO: ['Rondônia', 'norte', 2, 3], TO: ['Tocantins', 'norte', 4, 3], PI: ['Piauí', 'nordeste', 5, 3], PE: ['Pernambuco', 'nordeste', 6, 3], PB: ['Paraíba', 'nordeste', 7, 3],
    MT: ['Mato Grosso', 'centro', 3, 4], GO: ['Goiás', 'centro', 4, 4], BA: ['Bahia', 'nordeste', 5, 4], SE: ['Sergipe', 'nordeste', 6, 4], AL: ['Alagoas', 'nordeste', 7, 4],
    MS: ['Mato Grosso do Sul', 'centro', 3, 5], DF: ['Distrito Federal', 'centro', 4, 5], MG: ['Minas Gerais', 'sudeste', 5, 5], ES: ['Espírito Santo', 'sudeste', 6, 5],
    SP: ['São Paulo', 'sudeste', 4, 6], RJ: ['Rio de Janeiro', 'sudeste', 5, 6],
    PR: ['Paraná', 'sul', 4, 7], SC: ['Santa Catarina', 'sul', 4, 8], RS: ['Rio Grande do Sul', 'sul', 4, 9],
  };

  // Municípios de cada UF: lista oficial do IBGE (pública); sem internet, os de exemplo.
  const cacheMunicipios = new Map();
  function municipiosDa(uf) {
    if (!cacheMunicipios.has(uf)) {
      cacheMunicipios.set(uf, fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((lista) => lista.map((m) => m.nome))
        .catch(() => { cacheMunicipios.delete(uf); return LH.dados.MUNICIPIOS[uf] || []; }));
    }
    return cacheMunicipios.get(uf);
  }

  /** Termos -> consulta "a or b" (aspas para expressões com espaço). */
  const consultaDosTermos = (termos) => termos.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' or ');
  /** Filtros de busca de um radar (ou da tela). Com municípios escolhidos, a busca fica só neles. */
  const filtrosDoRadar = (r, ordem = 'prazo') => {
    const municipios = r.municipios || [];
    const ufsDosMunicipios = [...new Set(municipios.map((m) => m.split('/')[1]).filter(Boolean))];
    return {
      termo: consultaDosTermos(r.palavras || []),
      ufs: municipios.length ? ufsDosMunicipios : (r.ufs || []),
      municipios: municipios.map((m) => m.split('/')[0]),
      modalidades: LH.repo.modo === 'demo' ? (r.modalidades || []) : (r.modalidades || []).map((m) => ID_MODALIDADE[m]).filter(Boolean),
      ordem,
    };
  };
  async function doRadar(r) {
    const res = await LH.repo.buscar(filtrosDoRadar(r, 'recentes'));
    return { lista: res.lista, total: res.total ?? res.lista.length };
  }

  LH.vistas.radar = {
    titulo: 'Radar de Licitações',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Radar de Licitações',
        texto: 'Escolha os estados no mapa, refine por município e informe até 20 termos. Os resultados aparecem na hora e você pode salvar a busca como radar para receber alertas.',
        acoes: `<button class="btn" type="button" data-acao="computador">${icone('computador')} Alertas no computador</button>`,
      })}
      <section class="card spot regional" data-reveal aria-label="Busca regional">
        <div class="regional__mapa">
          <div class="card__titulo"><h2>${icone('local')} Estados</h2><span class="fraco" id="ufs-resumo">Brasil inteiro</span></div>
          <div class="mapa-uf" role="group" aria-label="Mapa do Brasil por estado: clique para selecionar">
            ${Object.entries(ESTADOS).map(([uf, [nome, regiao, col, lin]]) => `
              <button type="button" class="mapa-uf__estado mapa-uf__estado--${regiao}" style="grid-column:${col};grid-row:${lin}"
                data-uf="${uf}" aria-pressed="false" title="${esc(nome)}"><span>${uf}</span></button>`).join('')}
          </div>
          <div class="mapa-uf__legenda">
            <span><i class="norte"></i>Norte</span><span><i class="nordeste"></i>Nordeste</span><span><i class="centro"></i>Centro-Oeste</span><span><i class="sudeste"></i>Sudeste</span><span><i class="sul"></i>Sul</span>
            <button type="button" class="btn btn--pequeno btn--fantasma" data-acao="limpar-ufs">Limpar estados</button>
          </div>
        </div>

        <form class="regional__filtros form" id="form-regional" autocomplete="off">
          <div class="campo">
            <span class="campo__rotulo">Municípios <span class="fraco">(opcional, até ${MAX_MUNICIPIOS})</span></span>
            <div class="regional__municipio">
              <select id="mun-uf" aria-label="Estado do município"><option value="">Escolha um estado no mapa</option></select>
              <input id="mun-nome" list="mun-lista" placeholder="ex.: Ananindeua" disabled aria-label="Nome do município">
              <datalist id="mun-lista"></datalist>
              <button type="button" class="btn" data-acao="add-municipio" disabled>${icone('mais')} Adicionar</button>
            </div>
            <div class="chips" id="municipios"></div>
          </div>

          <div class="campo">
            <span class="campo__rotulo">Termos de busca <span class="fraco" id="termos-conta">0/${MAX_TERMOS}</span></span>
            <div class="termos" id="termos">
              <input id="termo-novo" aria-label="Novo termo de busca">
            </div>
            <span class="fraco" style="font-size:.78rem">Basta um dos termos aparecer no objeto da licitação. Tecle Enter ou vírgula para separar.</span>
          </div>

          <fieldset class="campo" style="border:0;padding:0;margin:0">
            <legend class="campo__rotulo">Modalidades (nenhuma = todas)</legend>
            <div class="chips">${Object.keys(ID_MODALIDADE).map((m) => `<label class="marcar chip"><input type="checkbox" name="modalidades" value="${esc(m)}"> ${esc(m)}</label>`).join('')}</div>
          </fieldset>

          <div class="regional__acoes">
            <button class="btn btn--primario btn--grande" type="submit">${icone('radar')} Buscar na região</button>
            <button class="btn" type="button" data-acao="salvar">${icone('sino')} Salvar como radar</button>
            <button class="btn btn--fantasma" type="button" data-acao="limpar">Limpar tudo</button>
          </div>
        </form>
      </section>

      <section aria-live="polite" style="margin-top:18px" id="area-resultados" hidden>
        <div class="resultados__barra"><span id="reg-contagem"></span><span class="fraco" id="reg-filtros"></span></div>
        <div class="resultados" id="reg-resultados"></div>
        <div class="mais-resultados" id="reg-mais" hidden><button class="btn" type="button">${icone('setaBaixo')} Carregar mais</button></div>
      </section>

      <div class="grade grade--lateral" style="margin-top:18px">
        <section class="grade" id="radares" aria-label="Seus radares"></section>
        <aside class="card spot" data-reveal style="align-self:start">
          <div class="card__titulo"><h2>${icone('sino')} Últimos alertas</h2><span class="ao-vivo">Ao vivo</span></div>
          <ul class="lista" id="alertas">${LH.carregando()}</ul>
        </aside>
      </div>`,

    montar(raiz) {
      const estado = { ufs: new Set(), municipios: [], termos: [] };
      const form = raiz.querySelector('#form-regional');
      const selUf = raiz.querySelector('#mun-uf');
      const inpMun = raiz.querySelector('#mun-nome');
      const botaoMun = raiz.querySelector('[data-acao="add-municipio"]');
      const inpTermo = raiz.querySelector('#termo-novo');
      const area = raiz.querySelector('#area-resultados');
      const caixa = raiz.querySelector('#reg-resultados');
      const mais = raiz.querySelector('#reg-mais');
      let consulta = null;
      let offset = 0;
      let total = 0;
      let pedido = 0;
      let ufPreferida = '';

      const atual = () => ({
        palavras: [...estado.termos], ufs: [...estado.ufs], municipios: [...estado.municipios],
        modalidades: [...form.querySelectorAll('[name=modalidades]:checked')].map((c) => c.value),
      });

      // --- Mapa e municípios ---
      const carregarListaMunicipios = async () => {
        const uf = selUf.value;
        const lista = raiz.querySelector('#mun-lista');
        if (!uf) { lista.innerHTML = ''; return; }
        const nomes = await municipiosDa(uf);
        if (selUf.value === uf) lista.innerHTML = nomes.map((n) => `<option value="${esc(n)}">`).join('');
      };
      const desenharEstados = () => {
        raiz.querySelectorAll('[data-uf]').forEach((b) => {
          const ligado = estado.ufs.has(b.dataset.uf);
          b.classList.toggle('ligado', ligado);
          b.setAttribute('aria-pressed', String(ligado));
        });
        const ufs = [...estado.ufs].sort();
        raiz.querySelector('#ufs-resumo').textContent = ufs.length ? `${ufs.length} estado(s): ${ufs.join(', ')}` : 'Brasil inteiro';
        const escolhida = estado.ufs.has(ufPreferida) ? ufPreferida : (estado.ufs.has(selUf.value) ? selUf.value : ufs[0]);
        selUf.innerHTML = ufs.length
          ? ufs.map((uf) => `<option value="${uf}"${uf === escolhida ? ' selected' : ''}>${esc(ESTADOS[uf][0])} (${uf})</option>`).join('')
          : '<option value="">Escolha um estado no mapa</option>';
        inpMun.disabled = !ufs.length;
        botaoMun.disabled = !ufs.length;
        carregarListaMunicipios();
      };
      const desenharMunicipios = () => {
        raiz.querySelector('#municipios').innerHTML = estado.municipios.map((m, i) => `
          <span class="chip chip--remover">${icone('local')} ${esc(m.replace('/', ' · '))}
            <button type="button" data-remover-mun="${i}" aria-label="Remover ${esc(m)}">${icone('fechar')}</button></span>`).join('')
          + (estado.municipios.length ? '<span class="fraco regional__nota">Com municípios escolhidos, a busca fica só neles.</span>' : '');
      };
      const adicionarMunicipio = async () => {
        const uf = selUf.value;
        const digitado = inpMun.value.trim();
        if (!uf || !digitado) return;
        const nomes = await municipiosDa(uf);
        const oficial = nomes.find((n) => normalizar(n) === normalizar(digitado));
        if (!oficial && nomes.length > 10) return LH.aviso(`Não achei "${digitado}" entre os municípios de ${ESTADOS[uf][0]}. Escolha um nome da lista.`, 'alerta');
        const chave = `${oficial || digitado}/${uf}`;
        if (estado.municipios.includes(chave)) return LH.aviso('Este município já está na busca.', 'info');
        if (estado.municipios.length >= MAX_MUNICIPIOS) return LH.aviso(`Use no máximo ${MAX_MUNICIPIOS} municípios.`, 'alerta');
        estado.municipios.push(chave);
        inpMun.value = '';
        desenharMunicipios();
        inpMun.focus();
      };

      // --- Termos (até 20) ---
      const desenharTermos = () => {
        const caixaTermos = raiz.querySelector('#termos');
        caixaTermos.querySelectorAll('.chip').forEach((c) => c.remove());
        inpTermo.insertAdjacentHTML('beforebegin', estado.termos.map((t, i) => `
          <span class="chip chip--remover">${esc(t)}<button type="button" data-remover-termo="${i}" aria-label="Remover ${esc(t)}">${icone('fechar')}</button></span>`).join(''));
        raiz.querySelector('#termos-conta').textContent = `${estado.termos.length}/${MAX_TERMOS}`;
        inpTermo.disabled = estado.termos.length >= MAX_TERMOS;
        inpTermo.placeholder = inpTermo.disabled ? 'Limite de 20 termos'
          : (estado.termos.length ? 'Mais um termo...' : 'ex.: limpeza, merenda escolar, ar condicionado');
      };
      const adicionarTermos = (texto) => {
        const novos = String(texto).split(',').map((t) => t.replace(/"/g, '').trim().replace(/\s+/g, ' ')).filter((t) => t.length >= 2);
        for (const t of novos) {
          if (estado.termos.length >= MAX_TERMOS) { LH.aviso(`Use no máximo ${MAX_TERMOS} termos.`, 'alerta'); break; }
          if (!estado.termos.some((x) => normalizar(x) === normalizar(t))) estado.termos.push(t.slice(0, 60));
        }
        inpTermo.value = '';
        desenharTermos();
      };

      // --- Busca e resultados (cards) ---
      const buscar = async (continuar = false) => {
        const meu = ++pedido;
        area.hidden = false;
        if (!continuar) {
          offset = 0;
          caixa.innerHTML = LH.carregando('Buscando licitações na região...');
          mais.hidden = true;
          const partes = [
            consulta.municipios.length ? `${consulta.municipios.length} município(s)` : (consulta.ufs.length ? consulta.ufs.join(', ') : 'Brasil inteiro'),
            estado.termos.length ? `${estado.termos.length} termo(s)` : 'todos os objetos',
          ];
          raiz.querySelector('#reg-filtros').textContent = partes.join(' · ');
        }
        try {
          const [favs, r] = await Promise.all([LH.repo.favoritos(), LH.repo.buscar(consulta, offset)]);
          if (meu !== pedido) return;
          if (!continuar) total = r.total ?? r.lista.length;
          const html = r.lista.map((l) => LH.cartaoLicitacao(l, favs)).join('');
          if (continuar) caixa.insertAdjacentHTML('beforeend', html);
          else caixa.innerHTML = html || LH.vazio('radar', 'Nada aberto nessa região', 'Tente outros termos, mais estados ou tire os municípios.');
          offset += r.lista.length;
          raiz.querySelector('#reg-contagem').innerHTML = `<strong>${fmt.numero(total)}</strong> licitação(ões) aberta(s)${offset < total ? ` · mostrando ${fmt.numero(offset)}` : ''}`;
          mais.hidden = offset >= total || r.lista.length < (r.porPagina || 20);
          LH.revelar(caixa);
          if (!continuar) area.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
          if (meu === pedido) caixa.innerHTML = LH.erroHtml(e);
        }
      };
      const iniciarBusca = () => {
        if (inpTermo.value.trim()) adicionarTermos(inpTermo.value);
        consulta = filtrosDoRadar(atual());
        buscar();
      };

      const carregarRadar = (r) => {
        estado.ufs = new Set(r.ufs || []);
        estado.municipios = [...(r.municipios || [])];
        for (const m of estado.municipios) estado.ufs.add(m.split('/')[1]);
        estado.termos = [...(r.palavras || [])].slice(0, MAX_TERMOS);
        form.querySelectorAll('[name=modalidades]').forEach((c) => { c.checked = (r.modalidades || []).includes(c.value); });
        desenharEstados(); desenharMunicipios(); desenharTermos();
        iniciarBusca();
      };

      // --- Radares salvos e alertas ---
      let radares = [];
      const desenharRadares = async () => {
        radares = await LH.repo.radares().catch((e) => { LH.aviso(e.message, 'perigo'); return []; });
        const caixaRadares = raiz.querySelector('#radares');
        const resultados = await Promise.all(radares.map((r) => doRadar(r).catch(() => ({ lista: [], total: null }))));
        caixaRadares.innerHTML = radares.length ? radares.map((r, i) => {
          const qtd = resultados[i].total;
          const regiao = r.municipios?.length ? r.municipios.map((m) => m.replace('/', ' · ')).join(', ')
            : (r.ufs.length ? `UFs: ${r.ufs.join(', ')}` : 'Brasil inteiro');
          return `
          <article class="card spot" data-reveal>
            <div class="card__titulo">
              <h3>${icone('radar')} ${esc(r.nome)}</h3>
              <label class="chave"><input type="checkbox" data-alternar="${r.id}" ${r.ativo ? 'checked' : ''}> ${r.ativo ? 'Ligado' : 'Desligado'}</label>
            </div>
            <div class="chips">${r.palavras.map((p) => `<span class="chip">${esc(p)}</span>`).join('') || '<span class="fraco">Todos os objetos</span>'}</div>
            <p class="fraco" style="margin-top:10px">${esc(regiao)} · ${r.modalidades.length ? esc(r.modalidades.join(', ')) : 'Todas as modalidades'}</p>
            <div class="card__rodape">
              <span class="selo selo--info">${qtd == null ? 'Sem conexão' : `${fmt.numero(qtd)} aberta(s) agora`}</span>
              <button class="btn btn--pequeno btn--primario" type="button" data-abrir="${r.id}">${icone('olho')} Ver resultados</button>
              <button class="btn btn--pequeno btn--perigo" type="button" data-excluir="${r.id}" style="margin-left:auto">${icone('lixeira')} Excluir</button>
            </div>
          </article>`;
        }).join('') : `<div class="card">${LH.vazio('radar', 'Nenhum radar salvo', 'Monte uma busca no mapa acima e clique em "Salvar como radar" para receber alertas.')}</div>`;

        const vistos = new Set();
        const alertas = radares.flatMap((r, i) => (r.ativo ? resultados[i].lista.slice(0, 4) : []))
          .filter((l) => !vistos.has(l.id) && vistos.add(l.id))
          .sort((a, b) => String(b.publicada).localeCompare(String(a.publicada))).slice(0, 6);
        raiz.querySelector('#alertas').innerHTML = alertas.length ? alertas.map((l) => `
          <li class="lista__item">
            <span class="lista__icone">${icone('sino')}</span>
            <div class="lista__texto"><strong>${esc(l.objeto)}</strong><span>${esc([l.municipio, l.uf].filter(Boolean).join('/'))} · ${l.valor == null ? 'valor sigiloso' : fmt.moeda(l.valor)}${l.publicada ? ` · publicada ${fmt.relativo(l.publicada)}` : ''}</span></div>
            <button class="btn-icone btn-icone--pequeno" type="button" data-alerta="${l.id}" aria-label="Ver detalhes">${icone('olho')}</button>
          </li>`).join('') : '<li class="fraco">Ligue um radar para ver os alertas.</li>';
        LH.revelar(raiz);
      };

      const salvarRadar = () => {
        const r = atual();
        if (!r.palavras.length && !r.ufs.length && !r.municipios.length) return LH.aviso('Escolha ao menos um estado ou um termo antes de salvar.', 'alerta');
        const sugestao = [r.palavras.slice(0, 2).join(', '), r.municipios[0]?.split('/')[0] || r.ufs.slice(0, 3).join('/')].filter(Boolean).join(' em ');
        LH.modal({
          titulo: 'Salvar como radar',
          html: `
            <label class="campo"><span class="campo__rotulo">Nome do radar</span><input id="radar-nome" maxlength="120" value="${esc(sugestao.slice(0, 120))}"></label>
            <div class="chips">
              <label class="chave"><input type="checkbox" id="radar-email" checked> E-mail</label>
              <label class="chave"><input type="checkbox" id="radar-telegram"> Telegram</label>
              <label class="chave"><input type="checkbox" id="radar-computador" checked> Computador</label>
            </div>`,
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            { rotulo: 'Salvar radar', classe: 'btn--primario', acao: async (fechar, fundo) => {
              const nome = fundo.querySelector('#radar-nome').value.trim();
              if (!nome) return fundo.querySelector('#radar-nome').focus();
              try {
                await LH.repo.salvarRadar({
                  ...r, nome, ativo: true,
                  canais: ['email', 'telegram', 'computador'].reduce((c, k) => ({ ...c, [k]: fundo.querySelector(`#radar-${k}`).checked }), {}),
                });
                fechar();
                LH.aviso('Radar salvo. Você será avisado das novas licitações.', 'sucesso');
                desenharRadares();
              } catch (erro) { LH.aviso(erro.message, 'perigo'); }
            } },
          ],
        });
      };

      // --- Eventos ---
      LH.ao(raiz, 'click', '[data-uf]', (e, b) => {
        const uf = b.dataset.uf;
        if (estado.ufs.has(uf)) {
          estado.ufs.delete(uf);
          const antes = estado.municipios.length;
          estado.municipios = estado.municipios.filter((m) => !m.endsWith(`/${uf}`));
          if (estado.municipios.length !== antes) desenharMunicipios();
        } else {
          estado.ufs.add(uf);
          ufPreferida = uf; // o seletor de município já abre no estado que acabou de ser marcado
        }
        desenharEstados();
      });
      selUf.addEventListener('change', () => { ufPreferida = selUf.value; carregarListaMunicipios(); });
      botaoMun.addEventListener('click', adicionarMunicipio);
      inpMun.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); adicionarMunicipio(); } });
      inpTermo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          if (inpTermo.value.trim()) adicionarTermos(inpTermo.value);
          else if (e.key === 'Enter') iniciarBusca();
        } else if (e.key === 'Backspace' && !inpTermo.value && estado.termos.length) {
          estado.termos.pop();
          desenharTermos();
        }
      });
      inpTermo.addEventListener('paste', (e) => {
        const texto = e.clipboardData?.getData('text') || '';
        if (/[,\n]/.test(texto)) { e.preventDefault(); adicionarTermos(texto.replace(/\n/g, ',')); }
      });
      raiz.querySelector('#termos').addEventListener('click', (e) => { if (e.target.id === 'termos') inpTermo.focus(); });
      LH.ao(raiz, 'click', '[data-remover-termo]', (e, b) => { estado.termos.splice(Number(b.dataset.removerTermo), 1); desenharTermos(); inpTermo.focus(); });
      LH.ao(raiz, 'click', '[data-remover-mun]', (e, b) => { estado.municipios.splice(Number(b.dataset.removerMun), 1); desenharMunicipios(); });
      form.addEventListener('submit', (e) => { e.preventDefault(); iniciarBusca(); });
      mais.querySelector('button').addEventListener('click', () => buscar(true));
      LH.ligarAcoesLicitacao(caixa); // Baixar edital, Ver itens, Site oficial, favoritar, IA, CRM

      LH.ao(raiz, 'click', '[data-acao]', async (e, b) => {
        if (caixa.contains(b)) return; // botões dos cards já tratados acima
        const acao = b.dataset.acao;
        if (acao === 'limpar-ufs') { estado.ufs.clear(); estado.municipios = []; desenharEstados(); desenharMunicipios(); }
        if (acao === 'limpar') {
          estado.ufs.clear(); estado.municipios = []; estado.termos = [];
          form.querySelectorAll('[name=modalidades]').forEach((c) => { c.checked = false; });
          desenharEstados(); desenharMunicipios(); desenharTermos();
          area.hidden = true;
        }
        if (acao === 'salvar') salvarRadar();
        if (acao === 'computador') {
          if (!('Notification' in window)) return LH.aviso('Este navegador não mostra alertas no computador.', 'alerta');
          const ok = (await Notification.requestPermission()) === 'granted';
          if (ok) LH.notificar('LicitaHub', 'Pronto! Os alertas do Radar vão aparecer assim no seu computador.');
          LH.aviso(ok ? 'Alertas no computador ligados.' : 'O navegador não deu permissão para alertas.', ok ? 'sucesso' : 'alerta');
        }
      });
      LH.ao(raiz, 'click', '[data-alerta]', (e, b) => LH.detalhesLicitacao(b.dataset.alerta));
      LH.ao(raiz, 'click', '[data-abrir]', (e, b) => {
        const r = radares.find((x) => String(x.id) === b.dataset.abrir);
        if (r) carregarRadar(r);
      });
      LH.ao(raiz, 'change', '[data-alternar]', async (e, chave) => {
        try {
          const r = radares.find((x) => String(x.id) === chave.dataset.alternar);
          await LH.repo.salvarRadar({ ...r, ativo: chave.checked });
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        desenharRadares();
      });
      LH.ao(raiz, 'click', '[data-excluir]', async (e, b) => {
        if (!(await LH.confirmar('Excluir radar', 'Este radar deixa de enviar alertas. Continuar?', 'Excluir', true))) return;
        try { await LH.repo.removerRadar(b.dataset.excluir); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        desenharRadares();
      });

      desenharEstados();
      desenharTermos();
      desenharRadares();
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
