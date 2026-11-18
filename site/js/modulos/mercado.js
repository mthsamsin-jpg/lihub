/* =============================================================================
   Uso LicitaHub · Pesquisa de Preço
   Preços praticados em compras públicas para um item do catálogo, com
   estatísticas, gráfico por período e a tabela de registros.
   Nesta demonstração os registros são simulados (na versão real: PNCP).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const PERIODOS = [['3', 'Últimos 3 meses'], ['6', 'Últimos 6 meses'], ['12', 'Últimos 12 meses'], ['24', 'Últimos 24 meses']];
  const COMPRADORES = ['Prefeitura Municipal', 'Secretaria de Estado da Saúde', 'Tribunal de Justiça', 'Universidade Federal', 'Instituto Federal', 'Câmara Municipal', 'Hospital Universitário', 'Polícia Militar', 'Secretaria de Educação', 'Companhia de Saneamento'];

  const mediana = (v) => {
    const s = [...v].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  /** Registros simulados, sempre iguais para a mesma pesquisa. */
  function registros({ item, uf, municipio, meses }) {
    const ref = LH.dados.catalogo.find((c) => c.nome === item);
    const base = ref?.base ?? 100;
    const sorte = LH.aleatorioDe(`${item}|${uf}|${municipio}|${meses}`);
    const qtd = 14 + Math.floor(sorte() * 16);
    const ufs = uf ? [uf] : ['SP', 'MG', 'PR', 'RJ', 'BA', 'RS', 'SC', 'GO', 'PE', 'CE'];
    return Array.from({ length: qtd }, () => {
      const diasAtras = Math.floor(sorte() * meses * 30);
      const tendencia = 1 + ((meses * 30 - diasAtras) / (meses * 30)) * 0.06; // leve alta no período
      let fator = 0.78 + sorte() * 0.44;
      if (sorte() < 0.08) fator *= sorte() < 0.5 ? 0.35 : 2.4; // alguns valores fora da curva
      const u = ufs[Math.floor(sorte() * ufs.length)];
      const cidades = LH.dados.MUNICIPIOS[u] || ['Capital'];
      return {
        data: LH.datas.somar(-diasAtras),
        orgao: `${COMPRADORES[Math.floor(sorte() * COMPRADORES.length)]}`,
        uf: u,
        municipio: municipio || cidades[Math.floor(sorte() * cidades.length)],
        quantidade: Math.max(1, Math.round(sorte() * 500)),
        unitario: Math.round(base * fator * tendencia * 100) / 100,
        fonte: sorte() < 0.7 ? 'PNCP' : 'Compras.gov.br',
      };
    }).sort((a, b) => b.data.localeCompare(a.data));
  }

  function grafico(lista, meses) {
    const baldes = Math.min(12, meses);
    const tamanho = (meses * 30) / baldes;
    const grupos = Array.from({ length: baldes }, () => []);
    for (const r of lista) {
      const idade = -LH.datas.diasAte(r.data);
      const i = Math.min(baldes - 1, Math.floor(idade / tamanho));
      grupos[baldes - 1 - i].push(r.unitario);
    }
    const valores = grupos.map((g) => (g.length ? mediana(g) : 0));
    const max = Math.max(...valores, 1);
    const med = mediana(lista.map((r) => r.unitario));
    const L = 600, A = 230, base = 200, topo = 16, largura = (L - 40) / baldes;
    const y = (v) => base - ((base - topo) * v) / (max * 1.1);
    const barras = valores.map((v, i) => {
      const x = 30 + i * largura + largura * 0.18;
      const w = largura * 0.64;
      const fim = new Date(); fim.setDate(fim.getDate() - Math.round((baldes - 1 - i) * tamanho));
      const rotulo = fim.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
      return `${v ? `<rect class="barra-g" x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(base - y(v)).toFixed(1)}" rx="5"><title>${rotulo}: mediana ${fmt.moeda(v)}</title></rect>` : ''}
        <text x="${(x + w / 2).toFixed(1)}" y="${base + 18}" text-anchor="middle">${rotulo}</text>`;
    }).join('');
    return `
      <svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="Mediana do preço por período">
        <defs><linearGradient id="grad-barra" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0284c7" stop-opacity=".55"/></linearGradient></defs>
        <line x1="24" x2="${L - 8}" y1="${base}" y2="${base}" stroke="rgba(148,197,255,.18)"/>
        ${barras}
        <line class="linha-mediana" x1="24" x2="${L - 8}" y1="${y(med).toFixed(1)}" y2="${y(med).toFixed(1)}"/>
        <text x="${L - 10}" y="${(y(med) - 6).toFixed(1)}" text-anchor="end" style="fill:var(--alerta)">mediana ${fmt.moeda(med)}</text>
      </svg>`;
  }

  LH.vistas['pesquisa-precos'] = {
    titulo: 'Pesquisa de Preço',
    local: 'A Pesquisa de Preço ainda usa preços de exemplo: a consulta aos preços praticados em compras públicas entra numa próxima etapa.',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Pesquisa de Preço',
        texto: 'Veja quanto o governo pagou por um item em compras públicas e use a referência para formar o seu preço.',
        acoes: '<span class="selo">Dados de exemplo</span>',
      })}
      <form class="card spot form" id="form-preco" data-reveal autocomplete="off">
        <div class="alternador" role="group" aria-label="Tipo de item">
          <button type="button" class="ativo" data-tipo="produto">Produto</button>
          <button type="button" data-tipo="servico">Serviço</button>
        </div>
        <div class="form__linha">
          <label class="campo" style="grid-column:1 / -1"><span class="campo__rotulo">Item do Catálogo</span>
            <input name="item" list="catalogo-preco" required placeholder="Comece a digitar: papel A4, notebook, limpeza...">
            <datalist id="catalogo-preco"></datalist></label>
        </div>
        <div class="form__linha">
          <label class="campo"><span class="campo__rotulo">Estado (UF)</span><select name="uf">${LH.opcoesUf('', 'Todos')}</select></label>
          <label class="campo"><span class="campo__rotulo">Município (Opcional)</span><select name="municipio" disabled>${LH.opcoesMunicipio('')}</select></label>
          <label class="campo"><span class="campo__rotulo">Período</span><select name="meses">${LH.opcoes(PERIODOS, '12')}</select></label>
        </div>
        <button class="btn btn--primario btn--grande" type="submit" style="justify-self:start">${icone('grafico')} Analisar mercado</button>
      </form>
      <section id="saida-preco" style="margin-top:18px"></section>`,
    montar(raiz) {
      const form = raiz.querySelector('#form-preco');
      const saida = raiz.querySelector('#saida-preco');
      let tipo = 'produto';

      const preencherCatalogo = () => {
        raiz.querySelector('#catalogo-preco').innerHTML = LH.dados.catalogo
          .filter((c) => c.tipo === tipo).map((c) => `<option value="${esc(c.nome)}">`).join('');
        form.item.placeholder = tipo === 'produto' ? 'Comece a digitar: papel A4, notebook, pneu...' : 'Comece a digitar: limpeza, vigilância, locação...';
      };
      LH.ao(form, 'click', '[data-tipo]', (e, b) => {
        tipo = b.dataset.tipo;
        form.querySelectorAll('[data-tipo]').forEach((x) => x.classList.toggle('ativo', x === b));
        form.item.value = '';
        preencherCatalogo();
      });
      form.uf.addEventListener('change', () => {
        form.municipio.innerHTML = LH.opcoesMunicipio(form.uf.value);
        form.municipio.disabled = !form.uf.value;
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const item = form.item.value.trim();
        if (!item) return form.item.focus();
        const meses = Number(form.meses.value);
        const todos = registros({ item, uf: form.uf.value, municipio: form.municipio.value, meses });
        const med0 = mediana(todos.map((r) => r.unitario));
        // IN SEGES/ME nº 65/2021: desconsiderar valores inexequíveis e excessivamente elevados
        const validos = todos.filter((r) => r.unitario >= med0 * 0.5 && r.unitario <= med0 * 1.7);
        const fora = todos.length - validos.length;
        const v = validos.map((r) => r.unitario);
        const unidade = LH.dados.catalogo.find((c) => c.nome === item)?.unidade || 'unidade';
        const est = (rotulo, valor, destaque) => `<div class="card card--compacto estat ${destaque ? 'estat--destaque' : ''}" data-reveal><strong>${valor}</strong><span>${rotulo}</span></div>`;

        saida.innerHTML = `
          <div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
            ${est('Menor preço', fmt.moeda(Math.min(...v)))}
            ${est('Mediana (referência)', fmt.moeda(mediana(v)), true)}
            ${est('Média', fmt.moeda(v.reduce((s, x) => s + x, 0) / v.length))}
            ${est('Maior preço', fmt.moeda(Math.max(...v)))}
            ${est('Registros usados', `${v.length}${fora ? ` <small class="fraco">(+${fora} fora da curva)</small>` : ''}`)}
          </div>
          <article class="card spot" data-reveal style="margin-top:18px">
            <div class="card__titulo"><h2>${icone('grafico')} Preço por ${esc(unidade)} ao longo do tempo</h2><span class="selo">${esc(PERIODOS.find((p) => p[0] === String(meses))[1])}</span></div>
            ${grafico(validos, meses)}
          </article>
          <article class="card spot" data-reveal style="margin-top:18px">
            <div class="card__titulo"><h2>${icone('arquivo')} Registros de compras</h2></div>
            <div class="tabela-rolagem"><table class="tabela">
              <thead><tr><th>Data</th><th>Comprador</th><th>Local</th><th class="numero">Quantidade</th><th class="numero">Valor unitário</th><th>Fonte</th></tr></thead>
              <tbody>${todos.map((r) => {
                const foraDaCurva = !validos.includes(r);
                return `<tr${foraDaCurva ? ' style="opacity:.5"' : ''}><td>${fmt.data(r.data)}</td><td>${esc(r.orgao)}</td><td>${esc(r.municipio)}/${esc(r.uf)}</td>
                  <td class="numero">${fmt.numero(r.quantidade)}</td><td class="numero">${fmt.moeda(r.unitario)}${foraDaCurva ? ' <span class="selo selo--alerta">fora da curva</span>' : ''}</td><td>${esc(r.fonte)}</td></tr>`;
              }).join('')}</tbody>
            </table></div>
          </article>
          <p class="nota" data-reveal style="margin-top:18px">${icone('info')} Pela IN SEGES/ME nº 65/2021, o preço estimado pode usar a média, a mediana ou o menor valor de pelo menos 3 preços, desconsiderando os inexequíveis, os inconsistentes e os excessivamente elevados. Aqui, os valores abaixo de 50% ou acima de 170% da mediana ficam de fora do cálculo.</p>`;
        LH.revelar(saida);
        saida.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      preencherCatalogo();
    },
  };
})();
