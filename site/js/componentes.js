/* =============================================================================
   Uso LicitaHub · componentes.js
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

  // --- Modalidades -----------------------------------------------------------------
  // Códigos oficiais do PNCP (manual da API, tabela "Modalidade de contratação").
  LH.MODALIDADES = [
    [6, 'Pregão Eletrônico'], [8, 'Dispensa de Licitação'], [4, 'Concorrência Eletrônica'],
    [7, 'Pregão Presencial'], [9, 'Inexigibilidade'], [3, 'Concurso'], [5, 'Concorrência Presencial'],
    [12, 'Credenciamento'], [13, 'Leilão Presencial'], [1, 'Leilão Eletrônico'],
  ];
  // Nomes antigos (radares salvos antes desta lista) -> nome atual.
  const APELIDOS_MODALIDADE = { 'Dispensa Eletrônica': 'Dispensa de Licitação', Dispensa: 'Dispensa de Licitação' };
  LH.nomeModalidade = (nome) => APELIDOS_MODALIDADE[nome] || nome;
  LH.idModalidade = (nome) => LH.MODALIDADES.find(([, n]) => n === LH.nomeModalidade(nome))?.[0] ?? null;

  // --- Plataformas (portais onde a disputa acontece) ---------------------------------
  // O PNCP informa em "sistema_origem" o portal que publicou a compra. Cada portal é
  // reconhecido por pedaços do nome; o que não casar com nenhum vai para "Demais portais".
  LH.PLATAFORMAS = [
    ['comprasnet', 'Comprasnet (Compras.gov.br)', ['compras.gov', 'comprasnet', 'siasg']],
    ['licitacoes-e', 'Licitações-e (Banco do Brasil)', ['licitacoes-e', 'licitações-e', 'banco do brasil']],
    ['bbmnet', 'BBMNET', ['bbmnet', 'bbm net']],
    ['bnc', 'BNC', ['bnc', 'bolsa nacional de compras']],
    ['pcp', 'Portal de Compras Públicas', ['portal de compras p', 'portaldecompraspublicas']],
    ['bll', 'BLL Compras', ['bll', 'bolsa de licita']],
    ['licitar', 'Licitar Digital', ['licitar digital', 'licitardigital']],
    ['licitamais', 'Licita Mais Brasil', ['licita mais', 'licitamais']],
    ['licitanet', 'Licitanet', ['licitanet']],
    ['comprasbr', 'ComprasBR', ['comprasbr', 'compras br']],
  ];
  LH.PLATAFORMA_OUTROS = ['outros', 'Demais portais integrados'];
  const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  /** Nome vindo do PNCP -> chave da plataforma ('outros' se não for nenhuma da lista). */
  LH.plataformaDe = (nome) => {
    const n = semAcento(nome);
    return LH.PLATAFORMAS.find(([, , partes]) => partes.some((p) => n.includes(semAcento(p))))?.[0] || 'outros';
  };

  // --- Observações do usuário nos cards ---------------------------------------------
  // Ficam na conta (tabela licitacao_observacoes). O card nasce com o campo vazio e
  // as observações chegam logo depois, de uma vez para todos os cards da tela.
  const obsCache = new Map();
  LH.observacao = (id) => obsCache.get(Number(id)) || '';
  async function preencherObservacoes(raiz) {
    const campos = [...raiz.querySelectorAll('textarea[data-obs]:not([data-obs-ok])')];
    if (!campos.length) return;
    campos.forEach((c) => { c.dataset.obsOk = '1'; });
    const faltam = campos.map((c) => Number(c.dataset.obs)).filter((id) => !obsCache.has(id));
    try {
      if (faltam.length) {
        const achadas = await LH.repo.observacoes(faltam);
        faltam.forEach((id) => obsCache.set(id, achadas.get(id) || ''));
      }
      for (const c of campos) if (!c.value && document.activeElement !== c) c.value = LH.observacao(c.dataset.obs);
    } catch { /* sem observações: o campo continua vazio e editável */ }
  }

  // --- Perfil do órgão -----------------------------------------------------------
  // Esfera: vem do PNCP (orgao_esfera). Na demonstração, deduzida do nome do órgão.
  const ESFERAS = { M: 'Municipal', E: 'Estadual', F: 'Federal', D: 'Distrital' };
  const esferaPeloNome = (orgao = '') => {
    if (/prefeitura|munic[ií]p|c[aâ]mara municipal/i.test(orgao)) return 'M';
    if (/federal|minist[eé]rio|tribunal regional|ex[eé]rcito|marinha|aeron[aá]utica/i.test(orgao)) return 'F';
    if (/estado|estadual|governo do/i.test(orgao)) return 'E';
    return null;
  };
  // Exigência de documentação estimada pela modalidade (Lei 14.133/2021):
  // na dispensa, o art. 70 permite dispensar parte da habilitação; na
  // concorrência, costuma-se pedir a habilitação completa.
  LH.NIVEIS_DOCUMENTACAO = [
    ['simplificada', 'Simplificada', 'selo--sucesso', /dispensa/i],
    ['padrao', 'Padrão', 'selo--info', /preg[aã]o/i],
    ['completa', 'Completa', 'selo--alerta', /concorr[eê]ncia/i],
  ];
  LH.perfilOrgao = (l) => {
    const esfera = l.esfera || (LH.repo.modo === 'demo' ? esferaPeloNome(l.orgao) : null);
    const nivel = LH.NIVEIS_DOCUMENTACAO.find(([, , , re]) => re.test(l.modalidade || ''));
    return { esfera: ESFERAS[esfera] || null, documentacao: nivel ? { chave: nivel[0], rotulo: nivel[1], classe: nivel[2] } : null };
  };
  const selosPerfil = (l) => {
    const p = LH.perfilOrgao(l);
    return [
      p.esfera && `<span class="selo selo--esfera" title="Esfera do órgão comprador">${icone('predio')} ${esc(p.esfera)}</span>`,
      p.documentacao && `<span class="selo ${p.documentacao.classe}" title="Estimativa pela modalidade (Lei 14.133/2021). Confira sempre a habilitação no edital.">${icone('arquivoCheck')} Documentação ${esc(p.documentacao.rotulo.toLowerCase())}</span>`,
    ].filter(Boolean).join('');
  };
  /** Site de origem: a plataforma onde a licitação é disputada; senão, a página no PNCP. */
  const siteOficial = (l) => l.linkDisputa || l.linkPncp || null;

  /** Selo CAPAG (nota do Tesouro Nacional); vazio quando o órgão não tem nota. */
  const seloCapag = (l) => {
    const nota = /^[ABCD]\+?$/.test(l.capag || '') ? l.capag : null;
    if (!nota) return '';
    const ente = l.capagChave?.startsWith('UF-') ? `do estado (${l.uf})` : `do município (${l.municipio || l.uf})`;
    return `<span class="capag capag--${nota[0].toLowerCase()}" title="CAPAG ${nota}: capacidade de pagamento ${ente}, segundo o Tesouro Nacional. A é a melhor, D a pior.">CAPAG ${nota}</span>`;
  };

  /** favs: Set com os ids favoritados (vem do LH.repo). */
  // pos = { n, total }: posição do resultado na busca ("3 de 120"), opcional.
  LH.cartaoLicitacao = (l, favs = new Set(), pos = null) => {
    const fav = favs.has(l.id);
    const dias = l.abertura ? LH.datas.diasAte(l.abertura) : 99;
    const status = !l.abertura ? ['Aberta', 'selo--sucesso'] : dias < 0 ? ['Encerrada', 'selo--perigo'] : ['Aberta', 'selo--sucesso'];
    const obs = LH.observacao(l.id);
    return `
    <article class="card spot licitacao" data-reveal>
      <div class="licitacao__corpo">
      <div class="licitacao__principal">
      <div class="licitacao__topo">
        <div>
          <div class="chips">
            ${pos ? `<span class="licitacao__ordem" title="Licitação ${pos.n} de ${fmt.numero(pos.total)} nesta busca">N°${pos.n}</span>` : ''}
            <span class="selo ${status[1]} licitacao__status"><i aria-hidden="true"></i>${status[0]}</span>
            <span class="selo selo--info">${esc(l.modalidade)}</span>
            <span class="selo" title="Número oficial da compra no PNCP">Nº ${esc(l.numero)}</span>
            ${l.me_epp ? '<span class="selo selo--sucesso">Exclusiva ME/EPP</span>' : ''}
            ${dias >= 0 && dias <= 3 ? `<span class="selo selo--alerta">${icone('relogio')} Encerra ${fmt.relativo(l.abertura)}</span>` : ''}
          </div>
          <div class="chips licitacao__perfil">${selosPerfil(l)}</div>
          <h3 class="licitacao__objeto" style="margin-top:10px">${esc(l.objeto)}</h3>
          <p class="licitacao__orgao">${esc(l.orgao)}</p>
        </div>
        <div class="licitacao__acoes-topo">
        ${seloCapag(l)}
        <button type="button" class="btn-icone btn-icone--pequeno ${fav ? 'ligado' : ''}" data-acao="favoritar" data-id="${l.id}"
          aria-pressed="${fav}" aria-label="${fav ? 'Tirar dos favoritos' : 'Favoritar'}">${icone('estrela')}</button>
        </div>
      </div>
      <dl class="licitacao__ficha">
        <div><dt>Nº do edital</dt><dd>${esc(l.edital || l.numero)}</dd></div>
        <div><dt>UASG / Unidade</dt><dd>${esc(l.uasg || '—')}</dd></div>
        <div><dt>Abertura</dt><dd>${l.abertura ? `${fmt.data(l.abertura)}${l.hora ? ` às ${esc(l.hora)}` : ''}` : 'Não informada'}</dd></div>
        <div><dt>Cidade/UF</dt><dd>${esc([l.municipio, l.uf].filter(Boolean).join('/') || '—')}</dd></div>
      </dl>
      <div class="licitacao__info">
        <span>${icone('moeda')} <b class="licitacao__valor">${valorTexto(l)}</b></span>
        ${siteOficial(l) ? `<a class="plataforma-selo" href="${esc(siteOficial(l))}" target="_blank" rel="noopener noreferrer" title="Portal de disputa: ${esc(l.plataforma)} (abrir site oficial)">${icone('globo')} ${esc(l.plataforma)}</a>` : `<span class="plataforma-selo" title="Portal de disputa">${icone('globo')} ${esc(l.plataforma)}</span>`}
      </div>
      </div>
      <div class="licitacao__lateral" role="group" aria-label="Ações rápidas">
        <button type="button" class="btn btn--pequeno btn--primario" data-acao="baixar" data-id="${l.id}">${icone('baixar')} Baixar Edital</button>
        ${siteOficial(l)
          ? `<a class="btn btn--pequeno btn--rapida" href="${esc(siteOficial(l))}" target="_blank" rel="noopener noreferrer">${icone('externo')} Ver Site Oficial</a>`
          : `<button type="button" class="btn btn--pequeno btn--rapida" disabled title="O órgão não informou o site">${icone('externo')} Ver Site Oficial</button>`}
        <button type="button" class="btn btn--pequeno btn--rapida" data-acao="itens" data-id="${l.id}">${icone('caixa')} Ver itens</button>
      </div>
      </div>
      <label class="licitacao__obs">
        <span>${icone('lapis')} Observação</span>
        <textarea rows="1" maxlength="2000" data-obs="${l.id}" placeholder="Nova observação...">${esc(obs)}</textarea>
      </label>
      <div class="licitacao__acoes">
        <div class="licitacao__mais">
          <button type="button" class="btn btn--pequeno btn--fantasma" data-acao="detalhes" data-id="${l.id}">${icone('olho')} Detalhes</button>
          <button type="button" class="btn btn--pequeno btn--fantasma" data-acao="ler-ia" data-id="${l.id}">${icone('brilho')} Ler com IA</button>
          <button type="button" class="btn btn--pequeno btn--fantasma" data-acao="crm" data-id="${l.id}">${icone('kanban')} CRM</button>
        </div>
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

  // --- Documentos e itens (lidos na hora do PNCP pelo servidor) ---------------------
  const linkPncp = (l) => (l?.linkPncp
    ? `<a class="btn btn--pequeno" href="${esc(l.linkPncp)}" target="_blank" rel="noopener noreferrer">${icone('externo')} Abrir no PNCP</a>` : '');

  /** Abre um modal que carrega o conteúdo em seguida. */
  function modalCarregando(titulo, l, carregar) {
    LH.modal({ titulo, html: `<div data-corpo>${LH.carregando('Consultando o portal do governo (PNCP)...')}
      <p class="fraco" data-espera aria-live="polite" style="margin-top:8px">O portal pode levar alguns segundos para responder.</p></div>` });
    const corpo = document.querySelector('.modal-fundo:last-of-type [data-corpo]');
    // Contador para a tela não parecer travada enquanto o portal do governo responde.
    const inicio = Date.now();
    const relogio = setInterval(() => {
      const aviso = corpo?.querySelector('[data-espera]');
      if (!aviso) return clearInterval(relogio);
      const s = Math.round((Date.now() - inicio) / 1000);
      aviso.textContent = s < 10 ? 'O portal pode levar alguns segundos para responder.'
        : `Ainda aguardando o PNCP (${s} s)... o portal do governo está lento agora, mas seguimos tentando.`;
    }, 1000);
    carregar()
      .then((html) => { if (corpo?.isConnected) corpo.innerHTML = html; })
      .catch((e) => { if (corpo?.isConnected) corpo.innerHTML = `${LH.erroHtml(e)}<div class="chips" style="margin-top:12px">${linkPncp(l)}</div>`; })
      .finally(() => clearInterval(relogio));
  }
  const soNoReal = (l) => `<p class="nota">${icone('info')} Na demonstração não há arquivos do governo. Entre com a sua conta para ${l}.</p>`;

  LH.documentosLicitacao = (id) => {
    const l = LH.licitacaoEmCache(id);
    modalCarregando(`Editais · ${l?.numero ?? ''}`, l, async () => {
      if (LH.repo.modo === 'demo') return soNoReal('baixar o edital e os anexos publicados no PNCP');
      const { arquivos } = await LH.nuvem.api(`/api/licitacoes/${Number(id)}/arquivos`, { limiteMs: 50_000 });
      if (!arquivos.length) return `<p class="fraco">O órgão ainda não publicou documentos desta licitação no PNCP.</p><div class="chips">${linkPncp(l)}</div>`;
      return `<ul class="lista">${arquivos.map((a, i) => `
        <li class="lista__item">
          <span class="lista__icone">${icone('arquivo')}</span>
          <div class="lista__texto"><strong>${esc(a.titulo)}</strong><span>${esc(a.tipo || 'Documento')}${a.data ? ` · ${fmt.data(String(a.data).slice(0, 10))}` : ''}</span></div>
          <a class="btn btn--pequeno ${i === 0 ? 'btn--primario' : ''}" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" download data-baixar-edital>${icone('baixar')} Baixar</a>
        </li>`).join('')}</ul>`;
    });
  };

  LH.itensLicitacao = (id) => {
    const l = LH.licitacaoEmCache(id);
    modalCarregando(`Itens · ${l?.numero ?? ''}`, l, async () => {
      if (LH.repo.modo === 'demo') return soNoReal('ver os itens, quantidades e valores publicados no PNCP');
      const { itens } = await LH.nuvem.api(`/api/licitacoes/${Number(id)}/itens`, { limiteMs: 50_000 });
      if (!itens.length) return `<p class="fraco">O PNCP não tem itens publicados para esta licitação.</p><div class="chips">${linkPncp(l)}</div>`;
      // Ordem oficial do edital (o servidor já ordena; reforça aqui sem perder a posição).
      itens.sort((a, b) => (a.numero ?? Infinity) - (b.numero ?? Infinity) || (a.posicao ?? 0) - (b.posicao ?? 0));
      const n = itens.length;
      const total = itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0);
      const numeros = itens.map((i) => i.numero).filter((x) => Number.isInteger(x) && x > 0);
      const maior = numeros.length ? Math.max(...numeros) : 0;
      const tem = new Set(numeros);
      const faltam = [];
      for (let k = 1; k <= maior && faltam.length < 30; k += 1) if (!tem.has(k)) faltam.push(k);
      const rotulo = (i, k) => `Item ${i.numero ?? k + 1}`;
      const html = `
        <p class="fraco"><strong>${fmt.numero(n)}</strong> item(ns) no edital${maior ? ` · Item 1 a Item ${fmt.numero(maior)}` : ''}${total ? ` · ${fmt.moeda(total)} estimados` : ''}</p>
        ${faltam.length ? `<p class="selo selo--alerta">O PNCP não publicou: ${faltam.map((x) => `Item ${x}`).join(', ')}${faltam.length >= 30 ? '...' : ''}</p>` : ''}
        ${n > 5 ? `<input type="search" class="campo" data-itens-filtro placeholder="Filtrar por número ou descrição (a numeração oficial é mantida)" style="margin:8px 0;width:100%">
        <p class="fraco" data-itens-contagem aria-live="polite"></p>` : ''}
        <div class="tabela-rolagem itens-tabela">
          <table class="tabela">
            <thead><tr><th>Nº oficial</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
            <tbody>${itens.map((i, k) => `
              <tr data-item-busca="${esc(`${i.numero ?? ''} ${i.descricao}`.toLowerCase())}" data-item-num="${i.numero ?? ''}">
                <td style="white-space:nowrap"><strong>${rotulo(i, k)}</strong><br><span class="fraco">${k + 1} de ${n}</span></td>
                <td>${esc(i.descricao)}${i.beneficio && !/sem benef/i.test(i.beneficio) ? `<br><span class="selo selo--sucesso">${esc(i.beneficio)}</span>` : ''}</td>
                <td>${i.quantidade == null ? '—' : fmt.numero(i.quantidade)} ${esc(i.unidade)}</td>
                <td>${i.valorUnitario == null ? 'Sigiloso' : fmt.moeda(i.valorUnitario)}</td>
                <td>${i.valorTotal == null ? 'Sigiloso' : fmt.moeda(i.valorTotal)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>`;
      return html;
    });
  };

  // "Baixar": o arquivo vem direto do portal do governo e pode demorar a começar.
  // O botão mostra "Baixando edital..." por alguns segundos para não parecer travado.
  document.addEventListener('click', (e) => {
    const botao = e.target.closest?.('[data-baixar-edital]');
    if (!botao || botao.classList.contains('baixando')) return;
    const original = botao.innerHTML;
    botao.classList.add('baixando');
    botao.setAttribute('aria-busy', 'true');
    botao.innerHTML = `${icone('atualizar', 'girando')} Baixando edital...`;
    LH.aviso('Baixando o edital do portal do governo. Pode levar alguns segundos para o download começar.', 'info');
    setTimeout(() => {
      botao.classList.remove('baixando');
      botao.removeAttribute('aria-busy');
      botao.innerHTML = original;
    }, 15_000);
  });

  // Filtro da janela de itens: só esconde linhas, nunca renumera (o "Item N" é o oficial).
  // Número puro ("12") acha exatamente o Item 12; texto procura na descrição.
  document.addEventListener('input', (e) => {
    const campo = e.target.closest?.('[data-itens-filtro]');
    if (!campo) return;
    const corpo = campo.closest('[data-corpo]');
    const termo = campo.value.trim().toLowerCase();
    const soNumero = /^\d+$/.test(termo);
    const linhas = [...corpo.querySelectorAll('[data-item-busca]')];
    let vis = 0;
    for (const tr of linhas) {
      const ok = !termo || (soNumero ? tr.dataset.itemNum === String(Number(termo)) : tr.dataset.itemBusca.includes(termo));
      tr.hidden = !ok;
      if (ok) vis += 1;
    }
    corpo.querySelector('[data-itens-contagem]').textContent = termo ? `${fmt.numero(vis)} de ${fmt.numero(linhas.length)} item(ns)` : '';
  });

  /** Liga os botões dos cards de licitação dentro da raiz. aoMudar() redesenha a lista. */
  LH.ligarAcoesLicitacao = (raiz, aoMudar) => {
    raiz.addEventListener('change', async (e) => {
      const campo = e.target.closest?.('[data-obs]');
      if (!campo) return;
      const id = Number(campo.dataset.obs);
      const texto = campo.value.trim().slice(0, 2000);
      try {
        await LH.repo.salvarObservacao(id, texto);
        obsCache.set(id, texto);
        LH.aviso(texto ? 'Observação salva na sua conta.' : 'Observação apagada.', 'sucesso');
      } catch (erro) {
        LH.aviso(erro.message, 'perigo');
      }
    });
    preencherObservacoes(raiz);
    new MutationObserver(LH.atrasar(() => preencherObservacoes(raiz), 60)).observe(raiz, { childList: true, subtree: true });
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
            const l = LH.licitacaoEmCache(id);
            LH.aviso(ficou
              ? (l?.abertura ? `Salva nas favoritas e marcada no calendário em ${fmt.data(l.abertura)}.` : 'Salva nas favoritas. O órgão não informou o prazo, então ela não aparece no calendário.')
              : 'Removida das favoritas e do calendário.', ficou ? 'sucesso' : 'info');
            // Calendários abertos (Home, Calendário) se atualizam na hora.
            document.dispatchEvent(new CustomEvent('lh:favoritos', { detail: { id, favorita: ficou } }));
            aoMudar?.();
          } catch (erro) {
            LH.aviso(erro.message, 'perigo');
          } finally {
            botao.disabled = false;
          }
          break;
        }
        case 'detalhes': LH.detalhesLicitacao(id); break;
        case 'baixar': LH.documentosLicitacao(id); break;
        case 'itens': LH.itensLicitacao(id); break;
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
  const TIPOS = { sessao: 'Sessão', prazo: 'Prazo', abertura: 'Abertura', favorita: 'Favorita' };

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
        if (doDia.some((ev) => ev.tipo === 'favorita')) classes.push('cal__dia--favorita');
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
