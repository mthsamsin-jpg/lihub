/* =============================================================================
   Uso LicitaHub · Inteligência de Mercado
   - Concorrentes: por CNPJ ou razão social, o que o fornecedor VENCEU no PNCP
     (compras, itens, valor, desconto sobre o estimado, UFs, órgãos).
   - Preços praticados: para um item/segmento, a faixa de preço homologada
     (mínimo, quartis, mediana, máximo), desconto médio e quem mais vence.
   - Leitura automática de editais por IA (liga/desliga da organização).
   Fonte: resultados homologados publicados no PNCP (só o vencedor é público).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
  const moeda = (v) => (v == null ? '—' : fmt.moeda(Number(v)));
  const doc = (ni) => (String(ni || '').length === 14 ? LH.cnpj.mascara(ni) : ni || '—');
  const data = (d) => (d ? fmt.data(String(d).slice(0, 10)) : '—');

  /** Faixa de preço (mín · P25 · mediana · P75 · máx) em barra. */
  function faixa(p) {
    if (!p?.amostras) return '';
    const min = Number(p.preco_min);
    const max = Number(p.preco_max);
    const pos = (v) => (max > min ? ((Number(v) - min) / (max - min)) * 100 : 50);
    return `
      <div class="faixa-preco" role="img" aria-label="Faixa de preço homologado de ${moeda(min)} a ${moeda(max)}, mediana ${moeda(p.preco_mediano)}">
        <div class="faixa-preco__trilho">
          <span class="faixa-preco__miolo" style="left:${pos(p.preco_p25)}%;width:${Math.max(2, pos(p.preco_p75) - pos(p.preco_p25))}%"></span>
          <span class="faixa-preco__mediana" style="left:${pos(p.preco_mediano)}%"></span>
        </div>
        <div class="faixa-preco__rotulos"><span>${moeda(min)}</span><span>mediana ${moeda(p.preco_mediano)}</span><span>${moeda(max)}</span></div>
      </div>`;
  }

  /** Painel de preços de um termo (usado aqui e no Gerador de proposta). */
  LH.painelPrecos = (p, termo) => {
    if (!p?.amostras) {
      return `<p class="nota">${icone('info')} Ainda não há resultados homologados com "${esc(termo)}" na base. A base cresce sozinha todos os dias com os resultados publicados no PNCP.</p>`;
    }
    const grupos = LH.termos.grupos(termo);
    return `
      <div class="metricas">
        <div class="metrica"><span>Amostras</span><strong>${fmt.numero(p.amostras)}</strong></div>
        <div class="metrica"><span>Faixa competitiva (P25 a P75)</span><strong>${moeda(p.preco_p25)} a ${moeda(p.preco_p75)}</strong></div>
        <div class="metrica"><span>Preço mediano</span><strong>${moeda(p.preco_mediano)}</strong></div>
        <div class="metrica"><span>Desconto mediano sobre o estimado</span><strong>${pct(p.desconto_mediano)}</strong></div>
      </div>
      ${faixa(p)}
      ${p.unidades?.length ? `<p class="fraco">Unidades mais comuns: ${p.unidades.map(esc).join(', ')}. Compare preços na mesma unidade.</p>` : ''}
      ${p.fornecedores?.length ? `<h3 class="inteligencia__sub">Quem mais vence</h3>
        <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Fornecedor</th><th class="numero">Itens vencidos</th><th class="numero">Preço médio</th><th></th></tr></thead>
        <tbody>${p.fornecedores.map((f) => `<tr><td>${esc(f.nome || '—')}<br><span class="fraco">${esc(doc(f.fornecedor_ni))}</span></td>
          <td class="numero">${fmt.numero(f.itens)}</td><td class="numero">${moeda(f.preco_medio)}</td>
          <td><button type="button" class="btn btn--pequeno btn--fantasma" data-ver-concorrente="${esc(f.fornecedor_ni)}">${icone('olho')} Ver</button></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${p.recentes?.length ? `<h3 class="inteligencia__sub">Resultados recentes</h3>
        <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Item</th><th>Un.</th><th class="numero">Estimado</th><th class="numero">Homologado</th><th class="numero">Desconto</th><th>Vencedor</th><th>Órgão</th><th>Data</th></tr></thead>
        <tbody>${p.recentes.map((r) => `<tr><td>${LH.termos.destacar(r.item_descricao || '', grupos)}</td><td>${esc(r.unidade || '')}</td>
          <td class="numero">${moeda(r.valor_unit_estimado)}</td><td class="numero"><strong>${moeda(r.valor_unit_homologado)}</strong></td><td class="numero">${pct(r.desconto_pct)}</td>
          <td>${esc(r.fornecedor_nome || '—')}</td><td>${esc(r.orgao_nome || '')}${r.uf ? ` · ${esc(r.uf)}` : ''}</td><td>${data(r.data_resultado)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <p class="fraco">Preços homologados publicados no PNCP. Use como referência: confira a especificação e a unidade antes de formar o seu preço.</p>`;
  };

  /** Evolução mensal (barras = valor homologado; rótulo = desconto mediano) + onde mais vence. */
  function painelEvolucao(pn) {
    if (!pn?.mensal?.length) return '';
    const meses = pn.mensal.slice(-12);
    const max = Math.max(...meses.map((m) => Number(m.valor) || 0), 1);
    const L = 600, A = 220, base = 180, topo = 18, larg = (L - 40) / meses.length;
    const nomeMes = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
    const barras = meses.map((m, i) => {
      const v = Number(m.valor) || 0;
      const h = ((base - topo) * v) / max;
      const x = 30 + i * larg + larg * 0.18, w = larg * 0.64;
      return `<rect class="barra-g" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="5"><title>${nomeMes(m.mes)}: ${moeda(v)} · ${m.compras} compra(s) · ${m.itens} item(ns) · desconto mediano ${pct(m.desconto_mediano)}</title></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${base + 16}" text-anchor="middle">${nomeMes(m.mes)}</text>
        ${m.desconto_mediano == null ? '' : `<text x="${(x + w / 2).toFixed(1)}" y="${(base - h - 5).toFixed(1)}" text-anchor="middle" style="fill:var(--texto-2);font-size:10px">${pct(m.desconto_mediano)}</text>`}`;
    }).join('');
    const lista = (titulo, linhas) => (linhas?.length ? `<div><h3 class="inteligencia__sub">${titulo}</h3><ol class="lista-ranking">${linhas}</ol></div>` : '');
    return `
      <h3 class="inteligencia__sub">Evolução mês a mês (valor homologado; acima da barra, o desconto mediano)</h3>
      <svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="Valor homologado por mês">
        <defs><linearGradient id="grad-barra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0284c7" stop-opacity=".55"/></linearGradient></defs>
        <line x1="24" x2="${L - 8}" y1="${base}" y2="${base}" stroke="rgba(148,197,255,.18)"/>${barras}
      </svg>
      <div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px">
        ${lista('Órgãos onde mais vence', (pn.orgaos || []).map((o) => `<li><span>${esc(o.orgao || o.orgao_cnpj || '—')}${o.uf ? ` · ${esc(o.uf)}` : ''}</span><span class="fraco">${fmt.numero(o.compras)} compra(s) · ${moeda(o.valor)}</span></li>`).join(''))}
        ${lista('Estados', (pn.ufs || []).map((u) => `<li><span>${esc(u.uf)}</span><span class="fraco">${fmt.numero(u.itens)} item(ns) · ${moeda(u.valor)}</span></li>`).join(''))}
        ${lista('Portais', (pn.portais || []).map((p) => `<li><span>${esc(p.portal)}</span><span class="fraco">${fmt.numero(p.itens)} item(ns)</span></li>`).join(''))}
      </div>`;
  }

  function painelConcorrente(c, itens, painel) {
    return `
      <div class="metricas">
        <div class="metrica"><span>Compras vencidas</span><strong>${fmt.numero(c.compras_vencidas)}</strong></div>
        <div class="metrica"><span>Itens vencidos</span><strong>${fmt.numero(c.itens_vencidos)}</strong></div>
        <div class="metrica"><span>Valor homologado</span><strong>${moeda(c.valor_total)}</strong></div>
        <div class="metrica"><span>Desconto médio / mediano</span><strong>${pct(c.desconto_medio)} / ${pct(c.desconto_mediano)}</strong></div>
      </div>
      ${painelEvolucao(painel)}
      <h3 class="inteligencia__sub">Itens vencidos</h3>
      <p class="fraco">${esc(c.fornecedor_porte || 'Porte não informado')} · ${fmt.numero(c.orgaos)} órgão(s) · UFs: ${esc((c.ufs || []).join(', ') || '—')} · de ${data(c.primeira)} a ${data(c.ultima)}</p>
      <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Item</th><th>Un.</th><th class="numero">Qtd.</th><th class="numero">Estimado</th><th class="numero">Homologado</th><th class="numero">Desconto</th><th>Órgão</th><th>Portal</th></tr></thead>
      <tbody>${itens.map((r) => `<tr><td>${data(r.data_resultado)}</td><td>${esc(r.item_descricao || '')}</td><td>${esc(r.unidade || '')}</td>
        <td class="numero">${r.quantidade_homologada == null ? '—' : fmt.numero(Number(r.quantidade_homologada))}</td>
        <td class="numero">${moeda(r.valor_unit_estimado)}</td><td class="numero"><strong>${moeda(r.valor_unit_homologado)}</strong></td><td class="numero">${pct(r.desconto_pct)}</td>
        <td>${esc(r.orgao_nome || '')}${r.uf ? ` · ${esc(r.uf)}` : ''}</td><td>${esc(r.portal || '')}</td></tr>`).join('')}</tbody></table></div>
      <p class="fraco">O PNCP publica só o vencedor de cada item. Disputas que esse concorrente perdeu e os lances dele aparecem apenas nos pregões acompanhados pelo Robô Turbo 2.0.</p>`;
  }

  LH.vistas.inteligencia = {
    titulo: 'Inteligência de Mercado',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Inteligência de Mercado',
        texto: 'Quem vence, por quanto e com que desconto: resultados homologados do PNCP, atualizados sozinhos.',
        acoes: '<span class="selo selo--sucesso" id="base-mercado">PNCP</span>',
      })}
      <div class="alternador" role="tablist" aria-label="Tipo de consulta" data-reveal>
        <button type="button" class="ativo" data-aba="precos" role="tab" aria-selected="true">${icone('moeda')} Preços de item</button>
        <button type="button" data-aba="concorrentes" role="tab" aria-selected="false">${icone('usuarios')} Concorrentes</button>
      </div>

      <section class="card spot" data-painel="precos" data-reveal>
        <form class="form" id="form-precos" autocomplete="off">
          <div class="form__linha">
            <label class="campo" style="grid-column:span 2"><span class="campo__rotulo">Item ou segmento</span>
              <input name="termo" required minlength="3" placeholder="ex.: copo descartável, papel A4, notebook"></label>
            <label class="campo"><span class="campo__rotulo">Estado (UF)</span><select name="uf">${LH.opcoesUf('', 'Todos')}</select></label>
            <label class="campo"><span class="campo__rotulo">Unidade (opcional)</span><input name="unidade" placeholder="ex.: UN, PCT, CX"></label>
          </div>
          <button class="btn btn--primario" type="submit">${icone('busca')} Ver preços praticados</button>
        </form>
        <div id="res-precos" aria-live="polite" style="margin-top:16px"></div>
      </section>

      <section class="card spot" data-painel="concorrentes" hidden data-reveal>
        <form class="form" id="form-concorrentes" autocomplete="off">
          <div class="form__linha">
            <label class="campo" style="grid-column:span 3"><span class="campo__rotulo">CNPJ ou razão social do concorrente</span>
              <input name="busca" required minlength="3" placeholder="ex.: 10.936.713/0001-15 ou COPIAR BRASIL"></label>
          </div>
          <button class="btn btn--primario" type="submit">${icone('busca')} Consultar concorrente</button>
        </form>
        <div id="res-concorrentes" aria-live="polite" style="margin-top:16px"></div>
      </section>

      <section class="card spot form" id="leitura-auto" data-reveal style="margin-top:18px">
        <div class="card__titulo"><h2>${icone('brilho')} Leitura automática de editais por IA</h2></div>
        <p class="fraco">Ligada, a IA lê sozinha o edital das licitações que a equipe favoritou ou colocou no CRM (enquanto estão abertas): resumo, habilitação, prazos, critério de julgamento e riscos. Usa a cota mensal de leituras do seu plano e nunca passa dela. O resultado aparece no <a href="#/ia/leitor">Leitor de Edital IA</a>.</p>
        <label class="interruptor"><input type="checkbox" id="ia-auto" disabled> <span id="ia-auto-texto">Carregando...</span></label>
      </section>`,
    montar(raiz) {
      const abas = raiz.querySelectorAll('[data-aba]');
      const mostrar = (aba) => {
        abas.forEach((b) => { const ok = b.dataset.aba === aba; b.classList.toggle('ativo', ok); b.setAttribute('aria-selected', String(ok)); });
        raiz.querySelectorAll('[data-painel]').forEach((p) => { p.hidden = p.dataset.painel !== aba; });
      };
      abas.forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.aba)));

      // Tamanho da base.
      LH.repo.mercadoResumo().then((r) => {
        raiz.querySelector('#base-mercado').textContent = r.resultados
          ? `${fmt.numero(r.resultados)} resultados · até ${data(r.ultimo)}` : 'Base em formação';
      }).catch(() => {});

      // Preços de item.
      const formP = raiz.querySelector('#form-precos');
      const resP = raiz.querySelector('#res-precos');
      formP.addEventListener('submit', async (e) => {
        e.preventDefault();
        const termo = formP.termo.value.trim();
        resP.innerHTML = LH.carregando('Consultando os resultados homologados...');
        try {
          const p = await LH.repo.mercadoPrecos(termo, { ufs: formP.uf.value ? [formP.uf.value] : [], unidade: formP.unidade.value.trim() });
          resP.innerHTML = LH.painelPrecos(p, termo);
        } catch (erro) { resP.innerHTML = LH.erroHtml(erro); }
      });

      // Concorrentes.
      const formC = raiz.querySelector('#form-concorrentes');
      const resC = raiz.querySelector('#res-concorrentes');
      const abrirConcorrente = async (c) => {
        resC.innerHTML = LH.carregando('Carregando o histórico...');
        try {
          const [itens, painel] = await Promise.all([
            LH.repo.mercadoConcorrenteItens(c.fornecedor_ni),
            LH.repo.mercadoConcorrentePainel ? LH.repo.mercadoConcorrentePainel(c.fornecedor_ni).catch(() => null) : null,
          ]);
          resC.innerHTML = `<div class="card__titulo"><h2>${esc(c.fornecedor_nome || '—')}</h2><span class="selo">${esc(doc(c.fornecedor_ni))}</span></div>${painelConcorrente(c, itens, painel)}`;
        } catch (erro) { resC.innerHTML = LH.erroHtml(erro); }
      };
      let encontrados = [];
      const consultar = async (busca) => {
        resC.innerHTML = LH.carregando('Procurando o concorrente...');
        try {
          encontrados = await LH.repo.mercadoConcorrentes(busca);
          if (!encontrados.length) { resC.innerHTML = LH.vazio('usuarios', 'Nenhum resultado', 'Esse fornecedor ainda não aparece como vencedor na base. Tente parte do nome ou o CNPJ.'); return; }
          if (encontrados.length === 1) return abrirConcorrente(encontrados[0]);
          resC.innerHTML = `<div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Fornecedor</th><th class="numero">Compras vencidas</th><th class="numero">Valor homologado</th><th class="numero">Desconto mediano</th><th></th></tr></thead>
            <tbody>${encontrados.map((c, k) => `<tr><td>${esc(c.fornecedor_nome || '—')}<br><span class="fraco">${esc(doc(c.fornecedor_ni))}</span></td>
              <td class="numero">${fmt.numero(c.compras_vencidas)}</td><td class="numero">${moeda(c.valor_total)}</td><td class="numero">${pct(c.desconto_mediano)}</td>
              <td><button type="button" class="btn btn--pequeno" data-abrir="${k}">${icone('olho')} Ver</button></td></tr>`).join('')}</tbody></table></div>`;
        } catch (erro) { resC.innerHTML = LH.erroHtml(erro); }
      };
      formC.addEventListener('submit', (e) => { e.preventDefault(); consultar(formC.busca.value.trim()); });
      resC.addEventListener('click', (e) => {
        const b = e.target.closest('[data-abrir]');
        if (b) abrirConcorrente(encontrados[Number(b.dataset.abrir)]);
      });
      // "Ver" a partir da tabela de preços: abre o concorrente na outra aba.
      resP.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ver-concorrente]');
        if (!b) return;
        mostrar('concorrentes');
        formC.busca.value = b.dataset.verConcorrente;
        consultar(b.dataset.verConcorrente);
      });

      // Leitura automática (só dono/administrador muda).
      const chave = raiz.querySelector('#ia-auto');
      const texto = raiz.querySelector('#ia-auto-texto');
      const pode = LH.repo.modo === 'real' && LH.nuvem?.podeGerenciar?.();
      LH.repo.leituraAutomatica().then((ligada) => {
        if (ligada == null) { texto.textContent = LH.repo.modo === 'real' ? 'Indisponível: rode o supabase/atualizar-inteligencia.sql.' : 'Disponível com login.'; return; }
        chave.checked = ligada;
        chave.disabled = !pode;
        texto.textContent = `${ligada ? 'Ligada' : 'Desligada'}${pode ? '' : ' (só o dono ou um administrador muda)'}`;
      }).catch(() => { texto.textContent = 'Indisponível agora.'; });
      chave.addEventListener('change', async () => {
        chave.disabled = true;
        try {
          await LH.repo.definirLeituraAutomatica(chave.checked);
          texto.textContent = chave.checked ? 'Ligada' : 'Desligada';
          LH.aviso(chave.checked ? 'Leitura automática ligada: a IA começa nas próximas horas.' : 'Leitura automática desligada.', 'sucesso');
        } catch (erro) { chave.checked = !chave.checked; LH.aviso(erro.message, 'perigo'); }
        chave.disabled = false;
      });
    },
  };
}());
