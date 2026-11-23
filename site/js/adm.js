/* =============================================================================
   Uso LicitaHub · adm.js (página inicial)
   1. Para todo visitante: aplica os textos e mídias trocados pelo ADM
      (GET /api/site/conteudo). O que não foi trocado fica como está no HTML.
   2. Só com sessão ADM (cookie HttpOnly validado no servidor): barra ADM com
      "Editar textos", "Salvar", espaços de vídeo/foto e "Sair do ADM".
   Marcação: data-cms="chave" (texto) · data-cms-midia="chave" (vídeo/foto).
   Textos entram como texto puro (textContent): nunca como HTML.
   ============================================================================= */
(function () {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const originais = new Map(); // texto original do HTML de cada chave
  let conteudo = { textos: {}, midias: {} };

  // ---------- Modo automático (telas do app, montadas pelo JavaScript) ----------
  // <body data-cms-auto="#menu, #conteudo">: os textos FIXOS dessas áreas (títulos,
  // descrições, nomes de campos, notas) ganham uma chave "t.<tela>.<código do texto
  // original>". Dados de clientes (licitações, tabelas, listas, CRM, janelas) ficam de fora.
  //
  // Números (contagens, valores, datas) viram LACUNAS: "126 licitações abertas" é salvo como
  // "{1} licitações abertas" e o número continua sendo o calculado pelo sistema.
  // Botões: editáveis em toda parte (inclusive nos cartões); com a edição ligada, o clique
  // só edita, não executa a ação. Áreas de DADOS: só rótulos fixos (botões, cabeçalhos).
  const RAIZES = (document.body.dataset.cmsAuto || '').split(',').map((s) => s.trim()).filter(Boolean);
  const CANDIDATOS = 'h1, h2, h3, h4, p, legend, label > span, .campo__rotulo, .nota, .vazio strong, .selo, small, summary, dt, th, button, a.btn, span[id], span.fraco, div.fraco';
  const DADOS = '.licitacao, table, .tabela-rolagem, .lista, .lista-ranking, .kanban, .chat';
  const SO_ROTULOS_EM_DADOS = 'button, a.btn, th, dt, legend';
  const SEMPRE_FORA = '.modal-fundo, .menu-usuario, .adm-barra, .adm-midia, [data-cms-ignorar], [contenteditable="true"]:not([data-cms])';
  const ICONE = (n) => n.nodeType === 1 && (/^(svg|i)$/i.test(n.tagName) || n.classList.contains('ic'));
  const FORMATACAO = /^(STRONG|B|EM|SMALL|SPAN|CODE|U)$/;
  const NUMERO = /\d+(?:[.,]\d+)*/g;
  const codigo = (t) => { let h = 0x811c9dc5; for (const ch of t) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
  const tela = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'home').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'home';
  const numerosDe = (el) => { try { return JSON.parse(el.dataset.cmsNums || '[]'); } catch { return []; } };
  /** "{1} licitações" + ["126"] -> "126 licitações" */
  const preencher = (t, nums) => String(t).replace(/\{(\d+)\}/g, (m, i) => nums[i - 1] ?? m);
  /** texto editado -> modelo com lacunas nos números atuais do elemento */
  const modelar = (t, nums) => nums.reduce((s, n, i) => s.replace(n, `{${i + 1}}`), t);

  function marcarAutomaticos() {
    for (const raiz of RAIZES.flatMap((s) => $$(s))) {
      for (const el of raiz.querySelectorAll(CANDIDATOS)) {
        if (el.closest(SEMPRE_FORA) || el.querySelector('[data-cms]') || el.closest('[data-cms]')) continue;
        if (el.closest(DADOS) && !el.matches(SO_ROTULOS_EM_DADOS)) continue;
        // pode ter só texto, ícones e formatação simples (negrito etc.)
        const filhos = [...el.childNodes];
        if (filhos.some((n) => n.nodeType === 1 && !ICONE(n) && !(FORMATACAO.test(n.tagName) && !n.querySelector('input, button, a, select, textarea, svg, img')))) continue;
        const conteudoNos = filhos.filter((n) => !ICONE(n) && !(n.nodeType === 3 && !n.textContent.trim() && filhos.length > 1));
        const original = conteudoNos.map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
        if (original.length < 2 || original.length > 600 || !/[A-Za-zÀ-ú]/.test(original)) continue;
        const nums = original.match(NUMERO) || [];
        const span = document.createElement('span');
        span.dataset.cms = `t.${tela()}.${codigo(original.replace(NUMERO, '#'))}`;
        if (nums.length) span.dataset.cmsNums = JSON.stringify(nums);
        conteudoNos[0].before(span);
        span.append(...conteudoNos); // mantém a formatação até o ADM trocar o texto
      }
    }
  }

  // ---------- Conteúdo público ----------
  const originalDe = new WeakMap(); // texto original (do sistema) de cada elemento
  function aplicarTextos() {
    marcarAutomaticos();
    for (const el of $$('[data-cms]')) {
      const k = el.dataset.cms;
      if (!originalDe.has(el)) originalDe.set(el, el.textContent);
      if (!originais.has(k)) originais.set(k, el.textContent);
      // não mexe no que está sendo editado nem reescreve o que já está certo (evita laço com o observador)
      if (!(alterados.has(k) || el === document.activeElement)) {
        const novo = conteudo.textos[k];
        const alvo = novo != null ? preencher(novo, numerosDe(el)) : originalDe.get(el);
        if (el.textContent.replace(/\s+/g, ' ').trim() !== alvo.replace(/\s+/g, ' ').trim()) el.textContent = alvo;
      }
      if (editando && !el.hasAttribute('contenteditable')) { el.setAttribute('contenteditable', 'plaintext-only'); el.classList.add('cms-editavel'); }
    }
  }

  function criarMidia(m) {
    let el;
    if (m.tipo === 'video') {
      el = document.createElement('video');
      Object.assign(el, { controls: true, playsInline: true, preload: 'metadata' });
      el.src = m.url;
    } else if (m.tipo === 'imagem') {
      el = document.createElement('img');
      el.src = m.url;
      el.alt = m.legenda || '';
      el.loading = 'lazy';
    } else if (m.tipo === 'youtube' || m.tipo === 'vimeo') {
      el = document.createElement('iframe');
      el.src = m.url;
      el.title = m.legenda || 'Vídeo';
      el.loading = 'lazy';
      el.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
      el.referrerPolicy = 'strict-origin-when-cross-origin';
      el.allowFullscreen = true;
    } else return null;
    el.className = 'midia-slot__midia';
    return el;
  }

  function aplicarMidias(adm = false) {
    for (const slot of $$('[data-cms-midia]')) {
      const k = slot.dataset.cmsMidia;
      const m = conteudo.midias[k];
      slot.replaceChildren();
      const alvo = document.querySelector(`[data-cms-midia-alvo="${CSS.escape(k)}"]`);
      if (m) {
        const el = criarMidia(m);
        if (el) slot.append(el);
        if (m.legenda && m.tipo !== 'imagem') { const p = document.createElement('p'); p.className = 'midia-slot__legenda'; p.textContent = m.legenda; slot.append(p); }
      }
      slot.hidden = !m && !adm;
      if (alvo) { alvo.classList.toggle('tem-midia', !!m); if (m) alvo.removeAttribute('aria-hidden'); }
      if (adm) controlesDoSlot(slot, k, !!m);
    }
  }

  async function carregar() {
    try {
      const r = await fetch('/api/site/conteudo', { credentials: 'same-origin' });
      if (r.ok) conteudo = await r.json();
    } catch { /* sem servidor (arquivo aberto direto): fica o HTML */ }
    aplicarTextos();
    aplicarMidias(false);
    // Telas do app são redesenhadas a cada navegação: reaplica (e marca) a cada mudança.
    if (RAIZES.length) {
      let agendado = 0;
      const obs = new MutationObserver(() => { cancelAnimationFrame(agendado); agendado = requestAnimationFrame(aplicarTextos); });
      for (const raiz of RAIZES.flatMap((s) => $$(s))) obs.observe(raiz, { childList: true, subtree: true });
    }
  }

  // ---------- Modo ADM ----------
  const api = async (metodo, url, corpo) => {
    const r = await fetch(url, {
      method: metodo, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-LH-ADM': '1' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { aviso('A sessão ADM expirou. Entre de novo em /adm.', true); sairDaTela(); }
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
    return j;
  };

  let barra;
  let editando = false;
  const alterados = new Map();

  function aviso(texto, erro = false) {
    const el = barra?.querySelector('.adm-barra__msg');
    if (!el) return;
    el.textContent = texto;
    el.classList.toggle('adm-barra__msg--erro', erro);
  }

  function botao(rotulo, aoClicar, classe = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `adm-btn ${classe}`;
    b.textContent = rotulo;
    b.addEventListener('click', aoClicar);
    return b;
  }

  function montarBarra() {
    document.body.classList.add('modo-adm');
    barra = document.createElement('div');
    barra.className = RAIZES.length ? 'adm-barra adm-barra--rodape' : 'adm-barra';
    barra.setAttribute('role', 'region');
    barra.setAttribute('aria-label', 'Modo ADM');
    const titulo = document.createElement('strong');
    titulo.textContent = 'Modo ADM';
    const editar = botao('Editar textos', () => alternarEdicao(editar));
    const salvar = botao('Salvar textos', salvarTextos, 'adm-btn--primario');
    salvar.disabled = true;
    salvar.dataset.salvar = '1';
    const msg = document.createElement('span');
    msg.className = 'adm-barra__msg';
    msg.setAttribute('aria-live', 'polite');
    const sair = botao('Sair do ADM', async () => { await api('POST', '/api/adm/sair').catch(() => {}); sairDaTela(); }, 'adm-btn--sair');
    const painel = document.createElement('a');
    painel.className = 'adm-btn';
    painel.href = '/adm-painel.html';
    painel.textContent = 'Usuários';
    barra.append(titulo, painel, editar, salvar, msg, sair);
    document.body.prepend(barra);
    aplicarMidias(true);
    window.addEventListener('beforeunload', (e) => { if (alterados.size) e.preventDefault(); });
  }

  function sairDaTela() {
    editando = false;
    alterados.clear();
    for (const el of $$('[data-cms]')) { el.removeAttribute('contenteditable'); el.classList.remove('cms-editavel', 'cms-alterado'); }
    barra?.remove();
    barra = null;
    document.body.classList.remove('modo-adm');
    aplicarMidias(false);
  }

  function marcarAlterado(el) {
    const k = el.dataset.cms;
    const nums = numerosDe(el);
    // guarda o MODELO: os números atuais viram lacunas {1}, {2}... (seguem calculados pelo sistema)
    const texto = modelar(el.textContent.replace(/\s+/g, ' ').trim(), nums);
    const atual = conteudo.textos[k] ?? modelar((originalDe.get(el) ?? originais.get(k) ?? '').replace(/\s+/g, ' ').trim(), nums);
    if (texto !== atual) alterados.set(k, texto); else alterados.delete(k);
    for (const x of $$(`[data-cms="${CSS.escape(k)}"]`)) x.classList.toggle('cms-alterado', alterados.has(k));
    const s = barra.querySelector('[data-salvar]');
    s.disabled = !alterados.size;
    s.textContent = alterados.size ? `Salvar textos (${alterados.size})` : 'Salvar textos';
  }

  function alternarEdicao(b) {
    editando = !editando;
    b.textContent = editando ? 'Parar de editar' : 'Editar textos';
    for (const el of $$('[data-cms]')) {
      if (editando) {
        el.setAttribute('contenteditable', 'plaintext-only'); // só texto, sem formatação colada
        el.classList.add('cms-editavel');
      } else {
        el.removeAttribute('contenteditable');
        el.classList.remove('cms-editavel');
      }
    }
    aviso(editando ? 'Clique num texto com contorno para editar. Apagar tudo e salvar volta ao texto original.' : '');
  }

  document.addEventListener('input', (e) => { const el = e.target.closest?.('[data-cms]'); if (editando && el) marcarAlterado(el); });
  document.addEventListener('keydown', (e) => { if (editando && e.key === 'Enter' && e.target.closest?.('[data-cms]')) e.preventDefault(); });
  // Enquanto edita, clicar num texto dentro de link, botão ou rótulo só edita: não navega
  // nem executa a ação (o evento para aqui, antes de chegar ao botão).
  const parar = (e) => {
    if (!editando || e.target.closest?.('.adm-barra, .adm-midia')) return;
    if (e.target.closest?.('[data-cms]') && e.target.closest('a, button, summary, label')) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  document.addEventListener('click', parar, true);
  // Espaço/Enter num texto de botão não "aperta" o botão
  document.addEventListener('keyup', (e) => { if (editando && e.key === ' ' && e.target.closest?.('[data-cms]')?.closest('button')) e.preventDefault(); }, true);

  async function salvarTextos() {
    if (!alterados.size) return;
    try {
      aviso('Salvando...');
      const textos = Object.fromEntries(alterados);
      const r = await api('PUT', '/api/adm/textos', { textos });
      for (const [k, t] of alterados) { if (t) conteudo.textos[k] = t; else delete conteudo.textos[k]; }
      alterados.clear();
      aplicarTextos();
      $$('.cms-alterado').forEach((x) => x.classList.remove('cms-alterado'));
      const s = barra.querySelector('[data-salvar]');
      s.disabled = true;
      s.textContent = 'Salvar textos';
      aviso(`Salvo: ${r.salvos} texto(s)${r.restaurados ? `, ${r.restaurados} voltaram ao original` : ''}.`);
    } catch (e) { aviso(e.message, true); }
  }

  // ---------- Espaços de vídeo/foto ----------
  function controlesDoSlot(slot, k, temMidia) {
    const box = document.createElement('div');
    box.className = 'adm-midia';
    const rotulo = document.createElement('span');
    rotulo.className = 'adm-midia__rotulo';
    rotulo.textContent = slot.dataset.cmsRotulo || k;
    const arquivo = document.createElement('input');
    arquivo.type = 'file';
    arquivo.accept = 'video/mp4,video/webm,image/jpeg,image/png,image/webp';
    arquivo.hidden = true;
    arquivo.addEventListener('change', () => arquivo.files[0] && enviarArquivo(k, arquivo.files[0]));
    box.append(rotulo,
      botao(temMidia ? 'Trocar por arquivo' : 'Enviar vídeo/foto', () => arquivo.click()),
      botao('Link do YouTube/Vimeo', () => usarLink(k)),
      arquivo);
    if (temMidia) box.append(botao('Remover', () => remover(k), 'adm-btn--sair'));
    const status = document.createElement('span');
    status.className = 'adm-midia__status';
    status.setAttribute('aria-live', 'polite');
    box.append(status);
    slot.prepend(box);
    slot.hidden = false;
  }
  const statusDo = (k) => document.querySelector(`[data-cms-midia="${CSS.escape(k)}"] .adm-midia__status`);

  async function recarregarMidias(texto) {
    const r = await fetch('/api/site/conteudo', { credentials: 'same-origin', cache: 'no-store' });
    if (r.ok) conteudo = await r.json();
    aplicarMidias(true);
    aviso(texto);
  }

  async function usarLink(k) {
    const link = prompt('Cole o link do vídeo (YouTube ou Vimeo):');
    if (!link) return;
    const legenda = prompt('Título do vídeo (opcional, para acessibilidade):') || '';
    try {
      await api('PUT', `/api/adm/midias/${encodeURIComponent(k)}/link`, { link, legenda });
      await recarregarMidias('Vídeo atualizado.');
    } catch (e) { aviso(e.message, true); }
  }

  async function enviarArquivo(k, f) {
    const st = statusDo(k);
    try {
      if (f.size > 50 * 1024 * 1024) throw new Error('O arquivo precisa ter até 50 MB. Para vídeos maiores, use um link do YouTube ou Vimeo.');
      const legenda = f.type.startsWith('image/') ? (prompt('Descrição da imagem (para acessibilidade):') || '') : '';
      const { url, caminho } = await api('POST', `/api/adm/midias/${encodeURIComponent(k)}/envio`, { mime: f.type, tamanho: f.size });
      // envio direto ao Storage (não passa pelo servidor do site), com progresso
      await new Promise((ok, falha) => {
        const x = new XMLHttpRequest();
        x.open('PUT', url);
        x.setRequestHeader('Content-Type', f.type);
        x.upload.onprogress = (e) => { if (e.lengthComputable && st) st.textContent = `Enviando... ${Math.round((e.loaded / e.total) * 100)}%`; };
        x.onload = () => (x.status < 300 ? ok() : falha(new Error(`O envio falhou (${x.status}).`)));
        x.onerror = () => falha(new Error('O envio falhou (conexão).'));
        x.send(f);
      });
      if (st) st.textContent = 'Publicando...';
      await api('PUT', `/api/adm/midias/${encodeURIComponent(k)}/arquivo`, { caminho, legenda });
      await recarregarMidias('Mídia atualizada.');
    } catch (e) {
      if (st) st.textContent = '';
      aviso(e.message, true);
    }
  }

  async function remover(k) {
    if (!confirm('Remover esta mídia do site?')) return;
    try {
      await api('DELETE', `/api/adm/midias/${encodeURIComponent(k)}`);
      await recarregarMidias('Mídia removida.');
    } catch (e) { aviso(e.message, true); }
  }

  // ---------- Início ----------
  (async () => {
    await carregar();
    // O cookie da sessão é HttpOnly (o script não o lê); "lh_adm_on" só avisa para perguntar.
    if (!/(?:^|;\s*)lh_adm_on=1/.test(document.cookie)) return;
    try {
      const r = await fetch('/api/adm/sessao', { credentials: 'same-origin' });
      if (r.ok && (await r.json()).admin) montarBarra();
    } catch { /* sem sessão */ }
  })();
}());
