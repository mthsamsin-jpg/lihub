/* =============================================================================
   Uso LicitaHub · adm-painel.js
   Painel ADM de usuários: números do topo, busca/filtro, lista paginada,
   bloquear e desbloquear. Tudo passa pelo servidor (/api/adm/usuarios*), que
   confere a sessão ADM (cookie HttpOnly). Sem sessão -> volta para /adm.html.
   Textos dos usuários entram como texto (escapados), nunca como HTML.
   ============================================================================= */
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const numero = (n) => (n == null ? '–' : Number(n).toLocaleString('pt-BR'));
  const data = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '–');
  const quando = (d) => {
    if (!d) return 'nunca';
    const min = Math.round((Date.now() - new Date(d)) / 60000);
    if (min < 2) return 'agora';
    if (min < 60) return `há ${min} min`;
    if (min < 1440) return `há ${Math.round(min / 60)} h`;
    if (min < 43200) return `há ${Math.round(min / 1440)} dia(s)`;
    return data(d);
  };
  const PLANOS = { gratuito: 'Free', starter: 'Starter', prime: 'Prime', pro: 'Pro', max: 'Max' };

  const estado = { busca: '', estado: 'todos', pagina: 1, total: 0, porPagina: 25, pedido: 0 };
  const lista = $('#lista');

  function aviso(texto, tipo = 'ok') {
    const el = $('#aviso');
    el.textContent = texto;
    el.className = `aviso aviso--${tipo}`;
    el.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { el.hidden = true; }, 5000);
  }

  /** Chamada à API do ADM com nova tentativa em falha passageira (só leituras). */
  async function api(metodo, url, corpo) {
    const leitura = metodo === 'GET';
    for (let i = 1; ; i++) {
      let r;
      try {
        r = await fetch(url, {
          method: metodo, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(leitura ? {} : { 'X-LH-ADM': '1' }) },
          body: corpo ? JSON.stringify(corpo) : undefined,
        });
      } catch {
        if (leitura && i < 3) { await new Promise((ok) => setTimeout(ok, 700 * i)); continue; }
        throw new Error('Sem conexão com o servidor. Confira a internet.');
      }
      if (r.status === 401) { location.href = '/adm.html'; throw new Error('Sessão ADM expirada.'); }
      if (leitura && i < 3 && [502, 503, 504].includes(r.status) && r.headers.get('content-type')?.includes('json') !== true) {
        await new Promise((ok) => setTimeout(ok, 700 * i)); continue;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || `Falha (${r.status}).`);
      return j;
    }
  }

  // ---------- Números do topo ----------
  async function carregarResumo() {
    try {
      const n = await api('GET', '/api/adm/usuarios/resumo');
      for (const el of document.querySelectorAll('[data-n]')) el.textContent = numero(n[el.dataset.n]);
    } catch {
      for (const el of document.querySelectorAll('[data-n]')) el.textContent = '–';
    }
  }

  // ---------- Lista ----------
  function linha(u) {
    const situacao = u.bloqueado
      ? '<span class="selo selo--bloqueado">Bloqueado</span>'
      : (u.confirmadoEm ? '<span class="selo selo--ativo">Ativo</span>' : '<span class="selo selo--pendente">E-mail não confirmado</span>');
    const plano = u.isento ? 'Isento' : (PLANOS[u.plano] || u.plano);
    const vence = !u.isento && u.planoAte ? `<div class="fraco">até ${data(u.planoAte)}</div>` : '';
    const acao = u.bloqueado
      ? `<button class="btn btn--pequeno btn--ok" type="button" data-acao="desbloquear" data-id="${esc(u.id)}" data-email="${esc(u.email)}">Desbloquear</button>`
      : `<button class="btn btn--pequeno btn--perigo" type="button" data-acao="bloquear" data-id="${esc(u.id)}" data-email="${esc(u.email)}">Bloquear</button>`;
    return `<tr>
      <td data-rotulo="Usuário"><div class="email">${esc(u.email)}</div><div class="fraco">${esc(u.nome || 'sem nome')}${u.telefone ? ` · ${esc(u.telefone)}` : ''}</div></td>
      <td data-rotulo="Situação">${situacao}</td>
      <td data-rotulo="Empresa / plano"><div>${esc(u.organizacao || '–')}</div><span class="selo selo--plano">${esc(plano)}</span>${vence}</td>
      <td data-rotulo="Atividade"><div>Último uso: <strong>${quando(u.ultimaAtividade)}</strong></div><div class="fraco">Último login: ${quando(u.ultimoLogin)}</div></td>
      <td data-rotulo="Cadastro">${data(u.criadoEm)}</td>
      <td class="acoes">${acao}</td>
    </tr>`;
  }

  async function carregarLista() {
    const meu = ++estado.pedido;
    lista.innerHTML = '<div class="esqueleto"></div>'.repeat(5);
    $('#contagem').textContent = 'Carregando…';
    $('#paginas').hidden = true;
    try {
      const q = new URLSearchParams({ busca: estado.busca, estado: estado.estado, pagina: String(estado.pagina) });
      const r = await api('GET', `/api/adm/usuarios?${q}`);
      if (meu !== estado.pedido) return; // resposta de uma busca antiga
      estado.total = r.total;
      estado.porPagina = r.porPagina;
      const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
      if (!r.usuarios.length) {
        lista.innerHTML = `<div class="estado">${estado.busca || estado.estado !== 'todos' ? 'Ninguém encontrado com esse filtro.' : 'Nenhum usuário cadastrado ainda.'}</div>`;
        $('#contagem').textContent = '';
        return;
      }
      lista.innerHTML = `<table class="tabela"><thead><tr><th>Usuário</th><th>Situação</th><th>Empresa / plano</th><th>Atividade</th><th>Cadastro</th><th><span class="sr">Ações</span></th></tr></thead><tbody>${r.usuarios.map(linha).join('')}</tbody></table>`;
      $('#contagem').textContent = `${numero(r.total)} usuário(s)`;
      $('#paginas').hidden = paginas <= 1;
      $('#pag-texto').textContent = `Página ${estado.pagina} de ${paginas}`;
      $('[data-pag="-1"]').disabled = estado.pagina <= 1;
      $('[data-pag="1"]').disabled = estado.pagina >= paginas;
    } catch (e) {
      if (meu !== estado.pedido) return;
      $('#contagem').textContent = '';
      lista.innerHTML = `<div class="estado estado--erro">${esc(e.message)}<br><button class="btn" type="button" data-tentar>Tentar de novo</button></div>`;
    }
  }

  // ---------- Bloquear / desbloquear ----------
  function confirmar({ titulo, texto, botao, perigo, comMotivo }) {
    const d = $('#confirmar');
    $('#conf-titulo').textContent = titulo;
    $('#conf-texto').textContent = texto;
    $('#conf-ok').textContent = botao;
    $('#conf-ok').className = `btn ${perigo ? 'btn--perigo' : 'btn--ok'}`;
    $('#conf-motivo-rotulo').hidden = !comMotivo;
    $('#conf-motivo').value = '';
    return new Promise((ok) => {
      d.addEventListener('close', () => ok(d.returnValue === 'sim' ? { motivo: $('#conf-motivo').value } : null), { once: true });
      d.showModal();
    });
  }

  async function mudar(botao) {
    const { acao, id, email } = botao.dataset;
    const bloquear = acao === 'bloquear';
    const resposta = await confirmar(bloquear
      ? { titulo: 'Bloquear usuário?', texto: `${email} não vai mais conseguir entrar, e as sessões abertas serão encerradas.`, botao: 'Bloquear', perigo: true, comMotivo: true }
      : { titulo: 'Desbloquear usuário?', texto: `${email} volta a poder entrar na plataforma.`, botao: 'Desbloquear', perigo: false, comMotivo: false });
    if (!resposta) return;
    botao.disabled = true;
    try {
      await api('POST', `/api/adm/usuarios/${encodeURIComponent(id)}/${acao}`, bloquear ? { motivo: resposta.motivo } : {});
      aviso(bloquear ? `${email} foi bloqueado.` : `${email} foi desbloqueado.`, 'ok');
      await Promise.all([carregarLista(), carregarResumo()]);
    } catch (e) {
      aviso(e.message, 'erro');
      botao.disabled = false;
    }
  }

  // ---------- Ligações ----------
  $('#filtros').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    estado.busca = String(f.get('busca') || '').trim();
    estado.estado = String(f.get('estado') || 'todos');
    estado.pagina = 1;
    carregarLista();
  });
  $('#filtros select').addEventListener('change', () => $('#filtros').requestSubmit());
  $('#paginas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pag]');
    if (!b || b.disabled) return;
    estado.pagina += Number(b.dataset.pag);
    carregarLista();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  lista.addEventListener('click', (e) => {
    if (e.target.closest('[data-tentar]')) return carregarLista();
    const b = e.target.closest('[data-acao]');
    if (b && !b.disabled) mudar(b);
  });
  $('#sair').addEventListener('click', async () => {
    await fetch('/api/adm/sair', { method: 'POST', credentials: 'same-origin', headers: { 'X-LH-ADM': '1' } }).catch(() => {});
    location.href = '/adm.html';
  });

  // ---------- Início: só abre com sessão ADM ----------
  (async () => {
    const r = await fetch('/api/adm/sessao', { credentials: 'same-origin' }).catch(() => null);
    if (!r?.ok) { location.href = '/adm.html'; return; }
    $('#pagina').hidden = false;
    carregarResumo();
    carregarLista();
  })();
})();
