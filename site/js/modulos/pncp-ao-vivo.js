/* =============================================================================
   Uso LicitaHub · Busca AO VIVO no PNCP + "Importar para o Robô Turbo 2.0"
   Consulta o PNCP na hora (pelo servidor: /api/pncp/busca) com a palavra da
   barra do topo ou do campo "Objeto". Cada resultado mostra o órgão, o objeto,
   o número, o valor estimado, o fim das propostas e o PORTAL da disputa. O botão
   "Importar para o Robô Turbo 2.0" lista os itens da compra e abre o cadastro do robô já
   preenchido (descrição, quantidade, valor unitário estimado como teto, portal,
   nº do pregão e do item).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone } = LH;
  const moeda = (v) => (v == null ? '—' : LH.fmt.moeda(v));
  const quando = (v) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const logado = () => LH.repo?.modo === 'real';

  /** Leva um item para o cadastro do robô (a tela do robô abre o formulário preenchido). */
  function importar(dados) {
    LH.roboImportar = dados;
    LH.ir('robo');
  }

  async function escolherItem(r) {
    LH.modal({
      titulo: 'Importar para o Robô Turbo 2.0',
      html: `<div class="pncp-importar">
        <div class="cofre__form-topo">${LH.portaisRobo.selo(r.portal)}<b>${esc(r.orgao || '')} · ${esc(r.numero || '')}</b></div>
        <p class="fraco">${esc(r.objeto || '')}</p>
        <ul class="pncp-importar__itens" data-itens>${LH.carregando('Lendo os itens no PNCP...')}</ul>
      </div>`,
      acoes: [{ rotulo: 'Fechar', classe: 'btn--fantasma' }],
    });
    const fundo = [...document.querySelectorAll('.modal-fundo')].at(-1);
    const lista = fundo.querySelector('[data-itens]');
    const base = { plataforma: r.portal === 'outros' ? 'outros' : r.portal, pregaoRef: r.numero, origemPncp: r.numeroControle };
    const fechar = () => fundo.remove();
    let itens = [];
    try {
      itens = (await LH.nuvem.api(`/api/pncp/compras/${r.cnpj}/${r.ano}/${r.sequencial}/itens`)).itens || [];
    } catch (e) {
      lista.innerHTML = `<li>${LH.erroHtml(e)}</li>`;
    }
    const compraInteira = `<li class="pncp-importar__item"><div><b>Compra inteira (lote único)</b><span class="fraco">${esc((r.objeto || '').slice(0, 140))}</span></div>
      <button type="button" class="btn btn--pequeno" data-importar="-1">${icone('alvo')} Importar</button></li>`;
    if (itens.length) {
      lista.innerHTML = itens.map((it, k) => `<li class="pncp-importar__item"><div>
          <b>Item ${esc(it.numero ?? k + 1)} · ${esc(it.descricao)}</b>
          <span class="fraco">${esc(it.quantidade ?? '—')} ${esc(it.unidade || '')} · unitário estimado ${it.valorUnitario ? moeda(it.valorUnitario) : 'sigiloso'}${it.beneficio ? ` · ${esc(it.beneficio)}` : ''}</span></div>
          <button type="button" class="btn btn--pequeno btn--primario" data-importar="${k}">${icone('alvo')} Importar</button></li>`).join('') + compraInteira;
    } else if (!lista.querySelector('.nota')) lista.innerHTML = compraInteira;
    else lista.insertAdjacentHTML('beforeend', compraInteira);
    lista.addEventListener('click', (e) => {
      const b = e.target.closest('[data-importar]');
      if (!b) return;
      const k = Number(b.dataset.importar);
      const it = itens[k];
      fechar();
      importar(it ? {
        ...base,
        descricao: `Item ${it.numero ?? k + 1} · ${it.descricao}`.slice(0, 300),
        itemNumero: it.numero ?? null, loteRef: it.numero != null ? String(it.numero) : null,
        quantidade: Math.max(1, Math.round(Number(it.quantidade) || 1)),
        teto: it.valorUnitario > 0 ? it.valorUnitario : null,
      } : {
        ...base,
        descricao: `${r.numero || ''} · ${r.objeto || ''}`.slice(0, 300),
        quantidade: 1, teto: r.valorEstimado || null,
      });
    });
  }

  /**
   * Liga a seção ao vivo dentro da tela de busca.
   * @param {HTMLElement} caixa
   * @param {{ termo: () => string, uf: () => string, automatico?: boolean }} o
   */
  function ligar(caixa, { termo, uf, automatico = false }) {
    let resultados = [];
    let pagina = 1;
    let total = 0;
    let pedido = 0;
    caixa.innerHTML = `
      <div class="card__titulo"><h2>${icone('raio')} Direto do PNCP, agora</h2>
        <button type="button" class="btn btn--pequeno" data-pncp-buscar>${icone('busca')} Buscar no PNCP ao vivo</button></div>
      <p class="fraco pncp-vivo__nota">Consulta o PNCP neste momento (pode levar até 30 s) e mostra o portal onde cada disputa acontece. Use <b>Importar para o Robô Turbo 2.0</b> para cadastrar o item com os dados oficiais.</p>
      <div class="pncp-vivo__lista" data-pncp-lista></div>
      <div class="mais-resultados" data-pncp-mais hidden><button class="btn" type="button">${icone('setaBaixo')} Mais resultados do PNCP</button></div>`;
    const lista = caixa.querySelector('[data-pncp-lista]');
    const mais = caixa.querySelector('[data-pncp-mais]');

    const cartao = (r, k) => `
      <article class="pncp-vivo__item">
        <header>${LH.portaisRobo.selo(r.portal)}${r.portal === 'outros' ? `<span class="fraco">${esc(r.portalNome)}</span>` : ''}
          <span class="selo">${esc(r.modalidade || '')}${r.modoDisputa ? ` · modo ${esc(r.modoDisputa.toLowerCase())}` : ''}</span>${r.srp ? '<span class="selo">Registro de preços</span>' : ''}</header>
        <h3>${esc(r.objeto || r.titulo || '')}</h3>
        <dl>
          <div><dt>Órgão</dt><dd>${esc(r.orgao || '—')}${r.municipio ? ` · ${esc(r.municipio)}/${esc(r.uf || '')}` : ''}</dd></div>
          <div><dt>Número</dt><dd>${esc(r.numero || '—')}</dd></div>
          <div><dt>Valor estimado</dt><dd>${r.valorEstimado ? moeda(r.valorEstimado) : r.orcamentoSigiloso ? 'Sigiloso' : '—'}</dd></div>
          <div><dt>Propostas até</dt><dd>${quando(r.fimPropostas)}</dd></div>
        </dl>
        <footer>
          ${r.linkPncp ? `<a class="btn btn--pequeno btn--fantasma" href="${esc(r.linkPncp)}" target="_blank" rel="noopener">${icone('externo')} PNCP</a>` : ''}
          ${r.linkOrigem ? `<a class="btn btn--pequeno btn--fantasma" href="${esc(r.linkOrigem)}" target="_blank" rel="noopener">${icone('externo')} Portal da disputa</a>` : ''}
          <button type="button" class="btn btn--pequeno btn--primario" data-pncp-importar="${k}">${icone('alvo')} Importar para o Robô Turbo 2.0</button>
        </footer>
      </article>`;

    const buscar = async (proxima = false) => {
      const q = termo().trim();
      if (!logado()) { lista.innerHTML = `<p class="nota">${icone('info')} A busca ao vivo no PNCP precisa de login (no modo demonstração, use os resultados de exemplo abaixo).</p>`; return; }
      if (q.length < 3) { lista.innerHTML = `<p class="nota">${icone('info')} Digite pelo menos 3 letras no campo <b>Objeto</b> (ou na barra do topo).</p>`; return; }
      const meu = ++pedido;
      pagina = proxima ? pagina + 1 : 1;
      if (!proxima) { resultados = []; lista.innerHTML = LH.carregando('Consultando o PNCP agora...'); }
      mais.hidden = true;
      try {
        const qs = new URLSearchParams({ q, pagina: String(pagina) });
        if (uf()) qs.set('uf', uf());
        const r = await LH.nuvem.api(`/api/pncp/busca?${qs}`);
        if (meu !== pedido) return;
        total = r.total;
        resultados = resultados.concat(r.resultados);
        lista.innerHTML = resultados.length
          ? `<p class="fraco">${total.toLocaleString('pt-BR')} edital(is) com propostas abertas no PNCP para "${esc(q)}".</p>${resultados.map(cartao).join('')}`
          : `<p class="nota">${icone('info')} O PNCP não tem editais com propostas abertas para "${esc(q)}".</p>`;
        mais.hidden = resultados.length >= total || !r.resultados.length;
      } catch (e) {
        if (meu === pedido) lista.innerHTML = LH.erroHtml(e);
      }
    };
    caixa.addEventListener('click', (e) => {
      if (e.target.closest('[data-pncp-buscar]')) buscar();
      if (e.target.closest('[data-pncp-mais] button')) buscar(true);
      const b = e.target.closest('[data-pncp-importar]');
      if (b) escolherItem(resultados[Number(b.dataset.pncpImportar)]);
    });
    if (automatico) buscar();
    return { buscar };
  }

  LH.pncpAoVivo = { ligar, importar };
}());
