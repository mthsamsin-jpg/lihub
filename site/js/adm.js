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

  // ---------- Conteúdo público ----------
  function aplicarTextos() {
    for (const el of $$('[data-cms]')) {
      const k = el.dataset.cms;
      if (!originais.has(k)) originais.set(k, el.textContent);
      const novo = conteudo.textos[k];
      el.textContent = novo != null ? novo : originais.get(k);
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
    barra.className = 'adm-barra';
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
    barra.append(titulo, editar, salvar, msg, sair);
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
    const texto = el.textContent.replace(/\s+/g, ' ').trim();
    const atual = conteudo.textos[k] ?? originais.get(k)?.replace(/\s+/g, ' ').trim();
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
  // Enquanto edita, um clique num texto dentro de link não navega.
  document.addEventListener('click', (e) => { if (editando && e.target.closest?.('[data-cms]') && e.target.closest('a')) e.preventDefault(); }, true);

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
