/* =============================================================================
   Uso LicitaHub · Licitações
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
  const carregar = (tag, atributos) => new Promise((ok, falha) => {
    const el = Object.assign(document.createElement(tag), atributos);
    el.onload = ok;
    el.onerror = () => falha(new Error(`Não consegui carregar ${atributos.src || atributos.href}. Confira a internet.`));
    document.head.append(el);
  });
  const ORDENS = [['relevancia', 'Mais relevantes'], ['prazo', 'Prazo mais próximo'], ['valor', 'Maior valor'], ['recentes', 'Publicadas recentemente']];

  // --- Buscar Licitações ---------------------------------------------------------
  // Painel de filtros avançados em cima (objeto, estado, cidade, modalidade,
  // plataformas e período de abertura) e os cards dos editais embaixo.
  const plataformasTodas = () => [...LH.PLATAFORMAS, LH.PLATAFORMA_OUTROS];
  /** " · em SP / Campinas · materiais · com "copo"": o que está filtrando a contagem. */
  const resumoFiltros = (f) => {
    const partes = [];
    if (f.uf) partes.push(`em <b>${esc(f.municipio ? `${f.municipio}/${f.uf}` : f.uf)}</b>`);
    if (f.tipo) partes.push(f.tipo === 'material' ? 'de <b>materiais/produtos</b>' : 'de <b>serviços</b>');
    if (String(f.termo || '').trim()) partes.push(`com <mark class="marca-termo">${esc(String(f.termo).trim())}</mark>`);
    return partes.length ? ` ${partes.join(' · ')}` : '';
  };
  LH.vistas.buscar = {
    titulo: 'Buscar Licitações',
    render: (p) => `
      ${LH.cabecalho({
        titulo: 'Buscar Licitações',
        texto: 'Editais abertos de todos os portais oficiais que publicam no PNCP: Comprasnet, BLL, BNC, BBMNET, Portal de Compras Públicas e outros, num lugar só.',
        acoes: LH.repo.modo === 'demo' ? '<span class="selo">Dados de exemplo</span>' : '<span class="selo selo--sucesso">PNCP · atualizado sozinho</span>',
      })}
      <form class="card form busca-avancada" id="filtros" data-reveal autocomplete="off">
        <div class="card__titulo"><h2>${icone('filtro')} Filtros avançados</h2></div>
        <div class="busca-avancada__linha">
          <label class="campo busca-avancada__objeto"><span class="campo__rotulo">Objeto</span>
            <input name="termo" value="${esc(p.q || '')}" placeholder="ex.: copo, papel A4, cadeira de rodas"></label>
          <label class="campo"><span class="campo__rotulo">Estado (UF)</span>
            <select name="uf">${LH.opcoesUf('')}</select></label>
          <label class="campo"><span class="campo__rotulo">Cidade</span>
            <input name="municipio" list="busca-cidades" placeholder="Escolha o estado" disabled>
            <datalist id="busca-cidades"></datalist></label>
          <label class="campo"><span class="campo__rotulo">Modalidade</span>
            <select name="modalidade">${LH.opcoes(LH.repo.modalidades.map(comDocumentacao), '', 'Todas')}</select></label>
        </div>
        <div class="busca-avancada__linha busca-avancada__tipo">
          <fieldset class="segmentado" aria-label="Tipo de contratação">
            <legend class="campo__rotulo">Tipo de contratação</legend>
            <label><input type="radio" name="tipo" value="" checked><span>Todos</span></label>
            <label><input type="radio" name="tipo" value="material"><span>${icone('caixa')} Materiais / Produtos</span></label>
            <label><input type="radio" name="tipo" value="servico"><span>${icone('engrenagem')} Serviços</span></label>
          </fieldset>
        </div>

        <fieldset class="plataformas">
          <legend>${icone('computador')} Plataforma
            <button type="button" class="link-botao" data-plataformas="todas">Marcar todas</button>
            <button type="button" class="link-botao" data-plataformas="nenhuma">Limpar</button></legend>
          <div class="plataformas__grade">
            ${plataformasTodas().map(([chave, nome]) => `
            <label class="plataforma"><input type="checkbox" name="plataformas" value="${esc(chave)}" checked><span>${esc(nome)}</span></label>`).join('')}
          </div>
          <p class="fraco plataformas__nota">${icone('info')} Todos são portais oficiais. Cada um publica no PNCP (Lei 14.133/2021), e o Uso LicitaHub reúne tudo pela API do PNCP.</p>
        </fieldset>

        <div class="busca-avancada__linha busca-avancada__linha--fim">
          <label class="campo"><span class="campo__rotulo">Abertura de</span><input type="date" name="de"></label>
          <label class="campo"><span class="campo__rotulo">Abertura até</span><input type="date" name="ate"></label>
          <details class="busca-avancada__mais">
            <summary>${icone('mais')} Mais filtros</summary>
            <div class="busca-avancada__extras">
              <label class="campo"><span class="campo__rotulo">Órgão</span><input name="orgao" placeholder="ex.: Prefeitura, Tribunal"></label>
              <label class="campo"><span class="campo__rotulo">Valor mínimo (R$)</span><input name="min" inputmode="decimal" placeholder="0"></label>
              <label class="campo"><span class="campo__rotulo">Valor máximo (R$)</span><input name="max" inputmode="decimal" placeholder="sem limite"></label>
            </div>
          </details>
        </div>
        <div class="busca-avancada__rodape">
          <button class="btn btn--fantasma" type="reset">Limpar filtros</button>
          <button class="btn btn--primario btn--grande" type="submit">${icone('busca')} Pesquisar</button>
        </div>
      </form>

      <section class="card pncp-vivo" id="pncp-vivo" aria-live="polite"></section>

      <section aria-live="polite" class="busca-resultados">
        <div class="resultados__barra">
          <span id="contagem"></span>
          <label class="campo" style="grid-auto-flow:column;align-items:center;gap:8px">
            <span class="campo__rotulo">Ordenar por</span>
            <select id="ordem">${LH.opcoes(ORDENS, p.q ? 'relevancia' : 'prazo')}</select>
          </label>
        </div>
        <div class="resultados" id="resultados"></div>
        <div class="mais-resultados" id="mais" hidden><button class="btn" type="button">${icone('setaBaixo')} Carregar mais</button></div>
      </section>`,
    montar(raiz, params = {}) {
      const form = raiz.querySelector('#filtros');
      const ordem = raiz.querySelector('#ordem');
      // Busca ao vivo no PNCP: roda sozinha quando se chega pela barra do topo (?q=...).
      const pncpVivo = LH.pncpAoVivo?.ligar(raiz.querySelector('#pncp-vivo'), {
        termo: () => form.termo.value, uf: () => form.uf.value, tipo: () => form.tipo.value, automatico: !!params.q && LH.repo.modo === 'real',
      });
      const caixa = raiz.querySelector('#resultados');
      const mais = raiz.querySelector('#mais');
      const cidade = form.municipio;
      let favs = new Set();
      let offset = 0;
      let ultimaCamada = null; // última faixa de camada desenhada (continua no "Carregar mais")
      let total = 0;
      let pedido = 0; // ignora respostas de buscas antigas

      const plataformasMarcadas = () => [...form.querySelectorAll('[name=plataformas]:checked')].map((c) => c.value);
      const ler = () => {
        const d = new FormData(form);
        const marcadas = plataformasMarcadas();
        return {
          termo: d.get('termo'), orgao: d.get('orgao'), modalidade: d.get('modalidade'), uf: d.get('uf'), tipo: d.get('tipo') || '',
          municipio: d.get('municipio') || '', min: fmt.lerNumero(d.get('min')), max: fmt.lerNumero(d.get('max')),
          de: d.get('de'), ate: d.get('ate'), ordem: ordem.value,
          // todas marcadas = sem filtro
          plataformas: marcadas.length === plataformasTodas().length ? [] : marcadas,
        };
      };
      const buscar = async (continuar = false) => {
        const meu = ++pedido;
        const f = ler();
        LH.termosBusca = LH.termos.grupos(f.termo);
        if (!continuar) {
          offset = 0;
          ultimaCamada = null;
          mais.hidden = true;
          if (!plataformasMarcadas().length) {
            caixa.innerHTML = LH.vazio('computador', 'Nenhuma plataforma marcada', 'Marque ao menos um portal no filtro "Plataforma".');
            raiz.querySelector('#contagem').textContent = '';
            return;
          }
          if (f.de && f.ate && f.de > f.ate) {
            caixa.innerHTML = LH.vazio('calendario', 'Período inválido', 'A data "Abertura de" precisa ser antes de "Abertura até".');
            return;
          }
          caixa.innerHTML = LH.carregando('Buscando licitações...');
        }
        try {
          // Favoritas em paralelo e sem derrubar a busca: se falhar, os editais aparecem mesmo assim.
          const [r, fv] = await Promise.all([LH.repo.buscar(f, offset), continuar ? null : LH.repo.favoritos().catch(() => null)]);
          if (fv) favs = fv;
          if (meu !== pedido) return;
          if (!continuar) total = r.total ?? 0;
          // Numeração contínua entre páginas ("Carregar mais" segue de onde parou).
          // Com termo, uma faixa abre cada camada da pirâmide (exata, principal, relacionadas, outras).
          const html = r.lista.map((l, k) => {
            let faixa = '';
            if (l.camada > 0 && l.camada !== ultimaCamada) {
              ultimaCamada = l.camada;
              faixa = `<div class="camada-faixa camada-faixa--${l.camada}" role="separator">${esc(LH.termos.ROTULOS_CAMADA[l.camada])}${l.totalCamada != null ? ` <span>${fmt.numero(l.totalCamada)}</span>` : ''}</div>`;
            }
            return faixa + LH.cartaoLicitacao(l, favs, { n: offset + k + 1, total: Math.max(total, offset + r.lista.length) });
          }).join('');
          if (continuar) caixa.insertAdjacentHTML('beforeend', html);
          else caixa.innerHTML = html || LH.vazio('busca', 'Nada encontrado', 'Tente outras palavras ou tire alguns filtros.');
          offset += r.lista.length;
          raiz.querySelector('#contagem').innerHTML = `<strong>${fmt.numero(total)}</strong> licitação(ões) aberta(s)${resumoFiltros(f)}${LH.termosBusca.length ? ' · as mais próximas do termo primeiro' : ''}${offset < total ? ` · mostrando ${fmt.numero(offset)}` : ''}`;
          mais.hidden = offset >= total || r.lista.length < r.porPagina;
          LH.revelar(caixa);
        } catch (e) {
          if (meu !== pedido) return;
          // "Carregar mais" que falha não apaga o que já está na tela.
          if (continuar) LH.aviso(e.message, 'perigo');
          else LH.erroComTentar(caixa, e, () => buscar());
        }
      };

      // Cidades do estado escolhido (lista oficial do IBGE, carregada só quando precisa)
      const atualizarCidades = async () => {
        const uf = form.uf.value;
        cidade.value = '';
        cidade.disabled = !uf;
        cidade.placeholder = uf ? 'Todas as cidades' : 'Escolha o estado';
        raiz.querySelector('#busca-cidades').innerHTML = '';
        if (!uf) return;
        try {
          if (!LH.geo) await carregar('script', { src: 'dados/municipios.js' });
          raiz.querySelector('#busca-cidades').innerHTML = (LH.geo?.municipios[uf] || [])
            .map((m) => `<option value="${esc(m[0])}"></option>`).join('');
        } catch { /* sem a lista, a cidade continua podendo ser digitada */ }
      };

      form.addEventListener('submit', (e) => { e.preventDefault(); buscar(); if (LH.repo.modo === 'real' && form.termo.value.trim().length >= 3) pncpVivo?.buscar(); });
      // Estado, cidade, modalidade, tipo, plataforma e datas valem na hora (sem precisar de "Pesquisar").
      let espera = null;
      form.addEventListener('change', (e) => {
        if (e.target.name === 'termo' || e.target.matches('[data-obs]')) return;
        clearTimeout(espera);
        espera = setTimeout(() => buscar(), e.target.name === 'plataformas' ? 500 : 150);
      });
      form.addEventListener('reset', () => setTimeout(() => { atualizarCidades(); buscar(); }));
      form.uf.addEventListener('change', atualizarCidades);
      form.addEventListener('click', (e) => {
        const b = e.target.closest('[data-plataformas]');
        if (!b) return;
        form.querySelectorAll('[name=plataformas]').forEach((c) => { c.checked = b.dataset.plataformas === 'todas'; });
      });
      ordem.addEventListener('change', () => buscar());
      mais.querySelector('button').addEventListener('click', async (ev) => {
        const b = ev.currentTarget;
        if (b.disabled) return; // evita clique duplo carregando a mesma página duas vezes
        b.disabled = true;
        try { await buscar(true); } finally { b.disabled = false; }
      });
      LH.ligarAcoesLicitacao(caixa);
      buscar();
    },
  };

  // --- Radar de Licitações (proximidade geográfica com mapa) ---------------------------
  // Filtros em linha -> raio a partir de uma cidade -> mapa com as licitações
  // agrupadas por município. As coordenadas vêm de site/dados/municipios.js e o
  // mapa usa a biblioteca Leaflet (carregada só nesta tela).
  const MAX_TERMOS = 20;
  const MAX_MUNICIPIOS = 2000;
  const RAIO_MAX = 1000;
  const NOMES_UF = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
    GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
    PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
    SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
  };

  // Leaflet 1.9.4 e o agrupamento (markercluster 1.5.3), do cdnjs; e as coordenadas.
  let recursosMapa = null;
  const carregarRecursosMapa = () => {
    recursosMapa ??= Promise.all([
      carregar('link', { rel: 'stylesheet', href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css' }),
      carregar('link', { rel: 'stylesheet', href: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.min.css' }),
      LH.geo ? null : carregar('script', { src: 'dados/municipios.js' }),
      carregar('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js' })
        .then(() => carregar('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.min.js' })),
    ]).catch((e) => { recursosMapa = null; throw e; });
    return recursosMapa;
  };

  /** Distância em km entre dois pontos (fórmula de haversine). */
  function distanciaKm(a, b) {
    const rad = (g) => (g * Math.PI) / 180;
    const dLat = rad(b[0] - a[0]);
    const dLon = rad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }
  /** Coordenadas de um município ("Nome", "UF") ou null. */
  const coordenadas = (nome, uf) => {
    const m = (LH.geo?.municipios[uf] || []).find((x) => normalizar(x[0]) === normalizar(nome));
    return m ? [m[1], m[2]] : null;
  };

  /** Termos -> consulta "a or b" (aspas para expressões com espaço). */
  const consultaDosTermos = (termos) => termos.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' or ');
  const lerTermos = (texto) => [...new Map(String(texto || '').split(/[,;\n]/)
    .map((t) => t.replace(/"/g, '').trim().replace(/\s+/g, ' ')).filter((t) => t.length >= 2)
    .map((t) => [normalizar(t), t.slice(0, 60)])).values()];
  const idsModalidade = (nomes) => (LH.repo.modo === 'demo' ? nomes.map(LH.nomeModalidade) : nomes.map(LH.idModalidade).filter(Boolean));

  /** Filtros de busca de um radar salvo (para as contagens e os alertas). */
  const filtrosDoRadar = (r, ordem = 'prazo') => {
    const municipios = r.municipios || [];
    const ufsDosMunicipios = [...new Set(municipios.map((m) => m.split('/')[1]).filter(Boolean))];
    return {
      termo: consultaDosTermos(r.palavras || []),
      ufs: municipios.length ? ufsDosMunicipios : (r.ufs || []),
      municipios: municipios.map((m) => m.split('/')[0]),
      modalidades: idsModalidade(r.modalidades || []),
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
        texto: '<span id="radar-subtitulo">Busca por proximidade geográfica: escolha uma cidade, ajuste o raio e veja as licitações abertas no mapa.</span>',
        acoes: `<button class="btn" type="button" data-acao="computador">${icone('computador')} Alertas no computador</button>`,
      })}
      <form class="card radar-filtros" id="radar-form" data-reveal autocomplete="off">
        <div class="radar-filtros__linha">
          <label class="campo radar-filtros__busca"><span class="campo__rotulo">Busca <span class="fraco" id="termos-conta">(até ${MAX_TERMOS} termos)</span></span>
            <input name="termos" placeholder="ex.: cadeira, computador, TI, limpeza"></label>
          <div class="campo"><span class="campo__rotulo">Modalidade</span>
            <details class="seletor" id="sel-modalidade">
              <summary class="seletor__botao"><span data-resumo>Todas</span>${icone('setaBaixo')}</summary>
              <div class="seletor__lista" role="group" aria-label="Modalidades">
                <label class="marcar seletor__todas"><input type="checkbox" data-todas checked> Todas</label>
                ${LH.MODALIDADES.map(([, m]) => `
                <label class="marcar"><input type="checkbox" name="modalidades" value="${esc(m)}"> ${esc(m)}</label>`).join('')}
              </div>
            </details>
          </div>
          <label class="campo"><span class="campo__rotulo">Estado</span>
            <select name="uf"><option value="">Selecione</option>${Object.entries(NOMES_UF).sort((a, b) => a[0].localeCompare(b[0])).map(([uf, nome]) => `<option value="${uf}" title="${esc(nome)}">${uf}</option>`).join('')}</select></label>
          <label class="campo"><span class="campo__rotulo">Cidade</span>
            <select name="cidade" disabled><option value="">Selecione o estado</option></select></label>
          <label class="campo"><span class="campo__rotulo">Abertura de</span><input type="date" name="de"></label>
          <label class="campo"><span class="campo__rotulo">Abertura até</span><input type="date" name="ate"></label>
        </div>
        <div class="radar-filtros__linha2">
          <div class="campo radar-raio">
            <span class="campo__rotulo">Raio</span>
            <div class="radar-raio__controle">
              <input type="range" name="raio" min="0" max="${RAIO_MAX}" step="5" value="50" aria-label="Raio em quilômetros">
              <output id="raio-valor">50 km</output>
            </div>
          </div>
          <button class="btn btn--primario" type="submit" id="radar-buscar" disabled>${icone('busca')} Buscar</button>
          <button class="btn btn--fantasma" type="button" data-acao="salvar" disabled>${icone('sino')} Salvar como radar</button>
          <span class="fraco radar-filtros__dica" id="radar-dica">Escolha o estado para buscar.</span>
        </div>
      </form>

      <section class="card radar-mapa" data-reveal aria-label="Mapa das licitações">
        <div id="mapa" class="radar-mapa__mapa" role="application" aria-label="Mapa interativo das licitações por município"></div>
        <div class="radar-mapa__aviso" id="mapa-aviso">
          <p>Selecione um <strong>estado</strong>, uma <strong>cidade</strong> e clique em <strong>Buscar</strong><br>para ver as licitações no mapa.</p>
        </div>
        <div class="radar-mapa__resumo card--vidro" id="mapa-resumo" hidden></div>
      </section>

      <section aria-live="polite" style="margin-top:18px" id="area-municipio" hidden>
        <div class="resultados__barra"><span id="mun-titulo"></span><button class="btn btn--pequeno btn--fantasma" type="button" data-acao="fechar-municipio">${icone('fechar')} Fechar</button></div>
        <div class="resultados" id="mun-resultados"></div>
      </section>

      <div class="grade grade--lateral" style="margin-top:18px">
        <section class="grade" id="radares" aria-label="Seus radares"></section>
        <aside class="card spot" data-reveal style="align-self:start">
          <div class="card__titulo"><h2>${icone('sino')} Últimos alertas</h2><span class="ao-vivo">Ao vivo</span></div>
          <ul class="lista" id="alertas">${LH.carregando()}</ul>
        </aside>
      </div>`,

    montar(raiz) {
      const form = raiz.querySelector('#radar-form');
      const selCidade = form.cidade;
      const botaoBuscar = raiz.querySelector('#radar-buscar');
      const botaoSalvar = raiz.querySelector('[data-acao="salvar"]');
      const aviso = raiz.querySelector('#mapa-aviso');
      const resumo = raiz.querySelector('#mapa-resumo');
      const areaMun = raiz.querySelector('#area-municipio');
      const caixaMun = raiz.querySelector('#mun-resultados');
      let mapa = null;
      let camadas = null;
      let ultima = null; // última busca: { filtros, ufs, municipios, ... } (para salvar e abrir municípios)
      let pedido = 0;
      let vivo = true;

      // --- Filtros ---
      const modalidadesMarcadas = () => [...form.querySelectorAll('[name=modalidades]:checked')].map((c) => c.value);
      const atualizarModalidade = () => {
        const marcadas = modalidadesMarcadas();
        const resumo = raiz.querySelector('#sel-modalidade [data-resumo]');
        resumo.textContent = !marcadas.length ? 'Todas' : (marcadas.length === 1 ? marcadas[0] : `${marcadas.length} selecionadas`);
        resumo.title = marcadas.join(', ') || 'Todas as modalidades';
        form.querySelector('[data-todas]').checked = !marcadas.length;
      };
      const atualizarTermos = () => {
        const n = lerTermos(form.termos.value).length;
        const conta = raiz.querySelector('#termos-conta');
        conta.textContent = n ? `(${n}/${MAX_TERMOS} termos)` : `(até ${MAX_TERMOS} termos)`;
        conta.classList.toggle('texto-perigo', n > MAX_TERMOS);
      };
      const atualizarCidades = async () => {
        const uf = form.uf.value;
        selCidade.disabled = !uf;
        if (!uf) { selCidade.innerHTML = '<option value="">Selecione o estado</option>'; return; }
        selCidade.innerHTML = '<option value="">Carregando...</option>';
        try { await carregarRecursosMapa(); } catch { /* sem internet: segue com o que houver */ }
        const nomes = (LH.geo?.municipios[uf] || []).map((m) => m[0]);
        selCidade.innerHTML = `<option value="">Todo o estado</option>${nomes.map((n) => `<option>${esc(n)}</option>`).join('')}`;
        selCidade.disabled = false;
      };
      const atualizarRaio = () => {
        const km = Number(form.raio.value);
        raiz.querySelector('#raio-valor').textContent = km ? `${km} km` : 'Só a cidade';
        form.raio.style.setProperty('--p', `${(km / RAIO_MAX) * 100}%`);
        form.raio.disabled = !selCidade.value;
      };
      const atualizarBotoes = () => {
        botaoBuscar.disabled = !form.uf.value;
        raiz.querySelector('#radar-dica').textContent = !form.uf.value ? 'Escolha o estado para buscar.'
          : (selCidade.value ? `Raio a partir de ${selCidade.value}/${form.uf.value}.` : `Todo o estado de ${NOMES_UF[form.uf.value]}. Escolha uma cidade para usar o raio.`);
        atualizarRaio();
      };

      // --- Mapa ---
      const iniciarMapa = async () => {
        await carregarRecursosMapa();
        if (!vivo || mapa) return;
        const L = window.L;
        mapa = L.map(raiz.querySelector('#mapa'), { zoomControl: true, worldCopyJump: true, minZoom: 3 }).setView([-14.5, -52], 4);
        // Mapa do OpenStreetMap; a versão escura é o mesmo mapa com um filtro de cor (CSS).
        const osm = (classe) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18, className: classe,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</a>',
        });
        const escuro = osm('mapa-tiles--escuro');
        const claro = osm('mapa-tiles--claro');
        escuro.addTo(mapa);
        L.control.layers({ 'Mapa escuro': escuro, 'Mapa claro': claro }, null, { position: 'topright' }).addTo(mapa);
        camadas = L.layerGroup().addTo(mapa);
        setTimeout(() => mapa.invalidateSize(), 50);
      };

      const tamanho = (n) => (n >= 100 ? 54 : n >= 30 ? 46 : n >= 10 ? 40 : 34);
      const iconeNumero = (n, grupo) => window.L.divIcon({
        className: '',
        html: `<span class="mapa-ponto${grupo ? ' mapa-ponto--grupo' : ''}" style="--t:${tamanho(n)}px">${fmt.numero(n)}</span>`,
        iconSize: [tamanho(n), tamanho(n)],
      });

      const desenharNoMapa = ({ pontos, centro, raioKm, cidade }) => {
        const L = window.L;
        camadas.clearLayers();
        const limites = [];
        if (centro) {
          L.marker(centro, {
            icon: L.divIcon({ className: '', html: `<span class="mapa-centro">${LH.icone('local')}</span>`, iconSize: [30, 30], iconAnchor: [15, 28] }),
            title: cidade, zIndexOffset: 1000,
          }).addTo(camadas).bindTooltip(cidade, { direction: 'top', offset: [0, -24] });
          if (raioKm) {
            const circulo = L.circle(centro, { radius: raioKm * 1000, className: 'mapa-raio', interactive: false }).addTo(camadas);
            limites.push(circulo.getBounds());
          }
        }
        const grupo = L.markerClusterGroup({
          showCoverageOnHover: false, maxClusterRadius: 55, spiderfyOnMaxZoom: true,
          iconCreateFunction: (c) => iconeNumero(c.getAllChildMarkers().reduce((s, m) => s + m.options.total, 0), true),
        });
        for (const p of pontos) {
          const m = L.marker(p.coord, { icon: iconeNumero(p.total), total: p.total, title: `${p.municipio}/${p.uf}` });
          m.bindPopup(`
            <div class="mapa-popup">
              <strong>${esc(p.municipio)}/${esc(p.uf)}</strong>
              <span>${fmt.numero(p.total)} licitação(ões) aberta(s)${p.distancia != null ? ` · ${fmt.numero(Math.round(p.distancia))} km` : ''}</span>
              <button type="button" class="btn btn--pequeno btn--primario" data-ver-municipio="${esc(p.uf)}|${esc(p.municipio)}">Ver licitações</button>
            </div>`);
          grupo.addLayer(m);
        }
        camadas.addLayer(grupo);
        if (pontos.length) limites.push(L.latLngBounds(pontos.map((p) => p.coord)));
        const tudo = limites.reduce((acc, b) => (acc ? acc.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast())), null);
        if (tudo) mapa.flyToBounds(tudo.pad(0.08), { duration: 0.8, maxZoom: 11 });
        else if (centro) mapa.flyTo(centro, 10, { duration: 0.8 });
      };

      // --- Busca ---
      const montarConsulta = () => {
        const uf = form.uf.value;
        const cidade = selCidade.value;
        const raioKm = Number(form.raio.value);
        const termos = lerTermos(form.termos.value);
        if (termos.length > MAX_TERMOS) throw new Error(`Use no máximo ${MAX_TERMOS} termos (você digitou ${termos.length}).`);
        const de = form.de.value;
        const ate = form.ate.value;
        if (de && ate && de > ate) throw new Error('A data "Abertura de" precisa ser antes da "Abertura até".');
        let centro = null;
        let alvos = []; // [{ nome, uf, coord, distancia }]
        if (cidade) {
          centro = coordenadas(cidade, uf);
          if (!centro) throw new Error(`Não achei a posição de ${cidade} no mapa.`);
          alvos = Object.entries(LH.geo.municipios).flatMap(([u, lista]) => lista.map((m) => ({ nome: m[0], uf: u, coord: [m[1], m[2]] })))
            .map((m) => ({ ...m, distancia: distanciaKm(centro, m.coord) }))
            .filter((m) => (raioKm ? m.distancia <= raioKm : (m.uf === uf && normalizar(m.nome) === normalizar(cidade))));
        }
        return {
          uf, cidade, raioKm: cidade ? raioKm : 0, termos, centro, alvos,
          filtros: {
            termo: consultaDosTermos(termos),
            ufs: cidade ? [...new Set(alvos.map((a) => a.uf))] : [uf],
            municipios: cidade ? alvos.map((a) => a.nome) : [],
            modalidades: idsModalidade(modalidadesMarcadas()),
            de, ate,
          },
        };
      };

      const executar = async (consulta) => {
        const meu = ++pedido;
        botaoBuscar.disabled = true;
        botaoBuscar.innerHTML = `${LH.icone('atualizar', 'girando')} Buscando...`;
        aviso.hidden = true;
        areaMun.hidden = true;
        try {
          await iniciarMapa();
          const linhas = await LH.repo.radarContagem(consulta.filtros);
          if (meu !== pedido || !vivo) return;
          // Só o que está dentro do raio (municípios com o mesmo nome em outra UF ficam de fora).
          const dentro = consulta.alvos.length ? new Map(consulta.alvos.map((a) => [`${a.uf}|${normalizar(a.nome)}`, a])) : null;
          let semPosicao = 0;
          const pontos = [];
          for (const l of linhas) {
            const alvo = dentro?.get(`${l.uf}|${normalizar(l.municipio)}`);
            if (dentro && !alvo) continue;
            const coord = alvo?.coord || coordenadas(l.municipio, l.uf);
            if (!coord) { semPosicao += l.total; continue; }
            pontos.push({ ...l, coord, distancia: alvo?.distancia ?? null });
          }
          const total = pontos.reduce((s, p) => s + p.total, 0);
          ultima = { ...consulta, pontos };
          desenharNoMapa({ pontos, centro: consulta.centro, raioKm: consulta.raioKm, cidade: consulta.cidade ? `${consulta.cidade}/${consulta.uf}` : '' });
          const onde = consulta.cidade
            ? (consulta.raioKm ? `num raio de ${fmt.numero(consulta.raioKm)} km de ${consulta.cidade}/${consulta.uf}` : `em ${consulta.cidade}/${consulta.uf}`)
            : (consulta.uf ? `em ${NOMES_UF[consulta.uf]}` : 'na seleção do radar');
          raiz.querySelector('#radar-subtitulo').textContent = consulta.cidade
            ? `Proximidade a partir de ${consulta.cidade}/${consulta.uf}` : `Licitações abertas ${onde}`;
          resumo.hidden = false;
          resumo.innerHTML = total
            ? `<strong>${fmt.numero(total)}</strong> licitação(ões) em <strong>${fmt.numero(pontos.length)}</strong> município(s) ${esc(onde)}${semPosicao ? `<br><span class="fraco">${fmt.numero(semPosicao)} sem posição no mapa</span>` : ''}<br><span class="fraco">Clique num número para ver as licitações.</span>`
            : `Nenhuma licitação aberta ${esc(onde)}.<br><span class="fraco">Aumente o raio ou tire alguns filtros.</span>`;
          botaoSalvar.disabled = false;
        } catch (e) {
          if (meu === pedido) {
            aviso.hidden = false;
            aviso.innerHTML = `<p>${LH.icone('alerta')} ${esc(e.message)}</p>`;
          }
        } finally {
          if (meu === pedido) {
            botaoBuscar.innerHTML = `${LH.icone('busca')} Buscar`;
            atualizarBotoes();
          }
        }
      };

      const verMunicipio = async (uf, municipio) => {
        mapa?.closePopup();
        areaMun.hidden = false;
        raiz.querySelector('#mun-titulo').innerHTML = `${LH.icone('local')} <strong>${esc(municipio)}/${esc(uf)}</strong>`;
        caixaMun.innerHTML = LH.carregando('Carregando as licitações...');
        areaMun.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try {
          const [favs, lista] = await Promise.all([LH.repo.favoritos().catch(() => []), LH.repo.licitacoesDoMunicipio(ultima.filtros, uf, municipio)]);
          LH.termosBusca = LH.termos.grupos(ultima.filtros.termo); // marca-texto nos cards do município
          caixaMun.innerHTML = lista.length ? lista.map((l) => LH.cartaoLicitacao(l, favs)).join('')
            : LH.vazio('busca', 'Nada encontrado', 'As licitações deste município podem ter encerrado agora há pouco.');
          LH.revelar(caixaMun);
        } catch (e) { caixaMun.innerHTML = LH.erroHtml(e); }
      };

      // --- Radares salvos e alertas ---
      let radares = [];
      const desenharRadares = async () => {
        const caixa = raiz.querySelector('#radares');
        try { radares = await LH.repo.radares(); } catch (e) {
          if (vivo) LH.erroComTentar(caixa, e, desenharRadares);
          return;
        }
        if (!vivo) return;
        const resultados = await Promise.all(radares.map((r) => doRadar(r).catch(() => ({ lista: [], total: null }))));
        if (!vivo || !caixa.isConnected) return; // saiu da tela enquanto contava
        caixa.innerHTML = radares.length ? radares.map((r, i) => {
          const qtd = resultados[i].total;
          const mun = r.municipios || [];
          const regiao = mun.length ? (mun.length > 3 ? `${mun.length} municípios (${mun.slice(0, 2).map((m) => m.split('/')[0]).join(', ')}...)` : mun.map((m) => m.replace('/', ' · ')).join(', '))
            : (r.ufs.length ? `UFs: ${r.ufs.join(', ')}` : 'Brasil inteiro');
          return `
          <article class="card spot" data-reveal>
            <div class="card__titulo">
              <h3>${LH.icone('radar')} ${esc(r.nome)}</h3>
              <label class="chave"><input type="checkbox" data-alternar="${r.id}" ${r.ativo ? 'checked' : ''}> ${r.ativo ? 'Ligado' : 'Desligado'}</label>
            </div>
            <div class="chips">${r.palavras.map((p) => `<span class="chip">${esc(p)}</span>`).join('') || '<span class="fraco">Todos os objetos</span>'}</div>
            <p class="fraco" style="margin-top:10px">${esc(regiao)} · ${r.modalidades.length ? esc(r.modalidades.join(', ')) : 'Todas as modalidades'}${r.ativo && r.canais?.email !== false ? ` · ${LH.icone('email')} aviso diário por e-mail` : ''}</p>
            <div class="card__rodape">
              <span class="selo selo--info">${qtd == null ? 'Contagem indisponível agora' :`${fmt.numero(qtd)} aberta(s) agora`}</span>
              <button class="btn btn--pequeno btn--primario" type="button" data-abrir="${r.id}">${LH.icone('local')} Ver no mapa</button>
              <button class="btn btn--pequeno btn--perigo" type="button" data-excluir="${r.id}" style="margin-left:auto">${LH.icone('lixeira')} Excluir</button>
            </div>
          </article>`;
        }).join('') : `<div class="card">${LH.vazio('radar', 'Nenhum radar salvo', 'Faça uma busca no mapa e clique em "Salvar como radar" para receber alertas.')}</div>`;

        const vistos = new Set();
        const alertas = radares.flatMap((r, i) => (r.ativo ? resultados[i].lista.slice(0, 4) : []))
          .filter((l) => !vistos.has(l.id) && vistos.add(l.id))
          .sort((a, b) => String(b.publicada).localeCompare(String(a.publicada))).slice(0, 6);
        raiz.querySelector('#alertas').innerHTML = alertas.length ? alertas.map((l) => `
          <li class="lista__item">
            <span class="lista__icone">${LH.icone('sino')}</span>
            <div class="lista__texto"><strong>${esc(l.objeto)}</strong><span>${esc([l.municipio, l.uf].filter(Boolean).join('/'))} · ${l.valor == null ? 'valor sigiloso' : fmt.moeda(l.valor)}${l.publicada ? ` · publicada ${fmt.relativo(l.publicada)}` : ''}</span></div>
            <button class="btn-icone btn-icone--pequeno" type="button" data-alerta="${l.id}" aria-label="Ver detalhes">${LH.icone('olho')}</button>
          </li>`).join('') : '<li class="fraco">Ligue um radar para ver os alertas.</li>';
        LH.revelar(raiz);
      };

      const salvarRadar = () => {
        if (!ultima) return;
        const municipios = ultima.cidade ? ultima.alvos.map((a) => `${a.nome}/${a.uf}`) : [];
        if (municipios.length > MAX_MUNICIPIOS) return LH.aviso(`O raio tem ${fmt.numero(municipios.length)} municípios. Para salvar, use um raio com até ${fmt.numero(MAX_MUNICIPIOS)}.`, 'alerta');
        const sugestao = [ultima.termos.slice(0, 2).join(', '), ultima.cidade ? `${ultima.cidade}${ultima.raioKm ? ` +${ultima.raioKm} km` : ''}` : NOMES_UF[ultima.uf]].filter(Boolean).join(' · ');
        LH.modal({
          titulo: 'Salvar como radar',
          html: `
            <p>Todo dia de manhã você recebe por e-mail as licitações novas ${ultima.cidade ? `nos ${fmt.numero(municipios.length)} município(s) deste raio` : `em ${esc(NOMES_UF[ultima.uf])}`} que ainda estão recebendo propostas.</p>
            <label class="campo"><span class="campo__rotulo">Nome do radar</span><input id="radar-nome" maxlength="120" value="${esc(sugestao.slice(0, 120))}"></label>
            <div class="chips">
              <label class="chave"><input type="checkbox" id="radar-email" checked> Aviso diário por e-mail</label>
            </div>`,
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            { rotulo: 'Salvar radar', classe: 'btn--primario', acao: async (fechar, fundo) => {
              const nome = fundo.querySelector('#radar-nome').value.trim();
              if (!nome) return fundo.querySelector('#radar-nome').focus();
              try {
                await LH.repo.salvarRadar({
                  nome, ativo: true, palavras: ultima.termos, ufs: ultima.filtros.ufs, municipios,
                  modalidades: modalidadesMarcadas(),
                  canais: { email: fundo.querySelector('#radar-email').checked, telegram: false, computador: false },
                });
                fechar();
                LH.aviso(fundo.querySelector('#radar-email')?.checked !== false ? 'Radar salvo. As licitações novas chegam no seu e-mail todo dia de manhã.' : 'Radar salvo.', 'sucesso');
                desenharRadares();
              } catch (erro) { LH.aviso(erro.message, 'perigo'); }
            } },
          ],
        });
      };

      const abrirRadar = (r) => {
        form.termos.value = (r.palavras || []).join(', ');
        form.querySelectorAll('[name=modalidades]').forEach((c) => { c.checked = (r.modalidades || []).map(LH.nomeModalidade).includes(c.value); });
        atualizarTermos(); atualizarModalidade();
        const mun = r.municipios || [];
        const alvos = mun.map((m) => { const [nome, uf] = m.split('/'); return { nome, uf, coord: coordenadas(nome, uf), distancia: null }; }).filter((a) => a.coord);
        const termos = r.palavras || [];
        executar({
          uf: mun.length ? '' : (r.ufs[0] || ''), cidade: '', raioKm: 0, termos, centro: null, alvos,
          filtros: { ...filtrosDoRadar(r), de: form.de.value, ate: form.ate.value },
        });
        raiz.querySelector('.radar-mapa').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };

      // --- Eventos ---
      form.uf.addEventListener('change', async () => { await atualizarCidades(); atualizarBotoes(); });
      selCidade.addEventListener('change', atualizarBotoes);
      form.raio.addEventListener('input', atualizarRaio);
      form.termos.addEventListener('input', atualizarTermos);
      form.addEventListener('change', (e) => {
        if (e.target.matches('[data-todas]')) form.querySelectorAll('[name=modalidades]').forEach((c) => { c.checked = false; });
        if (e.target.name === 'modalidades' || e.target.matches('[data-todas]')) atualizarModalidade();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.uf.value) return;
        try { await carregarRecursosMapa(); } catch (erro) { return LH.aviso(erro.message, 'perigo'); }
        try { executar(montarConsulta()); } catch (erro) { LH.aviso(erro.message, 'alerta'); }
      });
      // Fecha o seletor de modalidade ao clicar fora.
      const fecharSeletor = (e) => { const d = raiz.querySelector('#sel-modalidade'); if (d?.open && !d.contains(e.target)) d.open = false; };
      document.addEventListener('click', fecharSeletor);

      LH.ao(raiz, 'click', '[data-ver-municipio]', (e, b) => { const [uf, m] = b.dataset.verMunicipio.split('|'); verMunicipio(uf, m); });
      LH.ligarAcoesLicitacao(caixaMun); // Baixar edital, Ver itens, Site oficial, favoritar, IA, CRM
      LH.ao(raiz, 'click', '[data-acao]', async (e, b) => {
        if (caixaMun.contains(b)) return;
        const acao = b.dataset.acao;
        if (acao === 'salvar') salvarRadar();
        if (acao === 'fechar-municipio') areaMun.hidden = true;
        if (acao === 'computador') {
          if (!('Notification' in window)) return LH.aviso('Este navegador não mostra alertas no computador.', 'alerta');
          const ok = (await Notification.requestPermission()) === 'granted';
          if (ok) LH.notificar('Uso LicitaHub', 'Pronto! Os alertas do Radar vão aparecer assim no seu computador.');
          LH.aviso(ok ? 'Alertas no computador ligados.' : 'O navegador não deu permissão para alertas.', ok ? 'sucesso' : 'alerta');
        }
      });
      LH.ao(raiz, 'click', '[data-alerta]', (e, b) => LH.detalhesLicitacao(b.dataset.alerta));
      LH.ao(raiz, 'click', '[data-abrir]', async (e, b) => {
        const r = radares.find((x) => String(x.id) === b.dataset.abrir);
        if (!r) return;
        try { await carregarRecursosMapa(); abrirRadar(r); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
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

      atualizarBotoes();
      iniciarMapa().catch(() => {
        aviso.innerHTML = `<p>${LH.icone('alerta')} Não consegui carregar o mapa. Confira a internet e abra o Radar de novo.</p>`;
      });
      desenharRadares();
      return () => {
        vivo = false;
        document.removeEventListener('click', fecharSeletor);
        mapa?.remove();
      };
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
          const favs = await LH.repo.favoritos().catch(() => []);
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
