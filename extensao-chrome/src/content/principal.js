// Script da página do portal (injetado pelo popup só quando a pessoa pede).
// Recebe do popup os itens da proposta e responde com o relatório item a item.
// NUNCA clica em "Enviar/Salvar/Confirmar" do portal: só preenche campos; quem envia é a pessoa.
(function (raiz) {
  if (raiz.__LHX_PRONTO) return; // já injetado nesta aba
  raiz.__LHX_PRONTO = true;
  const LHX = raiz.LHX;
  const log = (...a) => console.info('%c[LicitaHub]', 'color:#0ea5e9;font-weight:bold', ...a);
  const generico = new LHX.AdaptadorBase();

  function adaptador() {
    return (LHX.adaptadores || []).find((a) => { try { return a.reconhece(location.href); } catch { return false; } }) || generico;
  }

  const CORES = { preenchido: '#22c55e', conferir: '#f59e0b', previsto: '#0ea5e9' };
  function marcar(el, cor, titulo) {
    if (!el) return;
    el.style.outline = `3px solid ${cor}`;
    el.style.outlineOffset = '2px';
    el.dataset.lhxMarcado = '1';
    if (titulo) el.title = titulo;
  }
  function limpar() {
    document.querySelectorAll('[data-lhx-marcado]').forEach((el) => { el.style.outline = ''; el.style.outlineOffset = ''; delete el.dataset.lhxMarcado; });
  }

  /** Relatório sem elementos da página (vai para o popup). */
  const relatorio = (plano, extra = {}) => plano.map((p) => ({
    numero: p.item.numero, descricao: p.item.descricao, status: p.status, avisos: p.avisos,
    acoes: p.acoes.map((a) => ({ campo: a.campo, valor: a.valor })), numeroNaTela: p.linha?.numero ?? null, ...extra,
  }));

  function analisar({ itens, opcoes }) {
    limpar();
    const a = adaptador();
    const linhas = a.lerLinhas(document);
    const plano = LHX.planejar(itens, linhas, { casas: a.casas, ...opcoes });
    for (const p of plano) {
      for (const acao of p.acoes) marcar(p.linha.campos[acao.campo].el, p.status === 'conferir' ? CORES.conferir : CORES.previsto, `LicitaHub vai escrever: ${acao.valor}`);
    }
    log(`Análise (${a.nome}): ${linhas.length} linha(s) com campo na página, ${itens.length} item(ns) na proposta.`);
    console.table(relatorio(plano).map((r) => ({ item: r.numero, tela: r.numeroNaTela, status: r.status, acoes: r.acoes.map((x) => `${x.campo}=${x.valor}`).join('; '), avisos: r.avisos.join(' ') })));
    return { portal: { id: a.id, nome: a.nome, validado: a.validado }, linhas: linhas.length, itens: relatorio(plano) };
  }

  async function preencher({ itens, opcoes }) {
    limpar();
    const a = adaptador();
    const plano = LHX.planejar(itens, a.lerLinhas(document), { casas: a.casas, ...opcoes });
    for (const p of plano) {
      for (const acao of p.acoes) {
        const el = p.linha.campos[acao.campo].el;
        try {
          const final = await a.escrever(el, acao.valor);
          // Confere lendo de volta: a máscara do portal pode ter mudado o valor.
          const ok = acao.campo === 'unitario' ? LHX.mesmoValor(final, acao.valor, a.casas) : String(final).trim() === acao.valor;
          if (!ok) {
            p.status = 'conferir';
            p.avisos.push(`O portal deixou "${final}" no campo de ${acao.campo} (esperado ${acao.valor}).`);
          }
          marcar(el, ok ? CORES.preenchido : CORES.conferir);
        } catch (e) {
          p.status = 'conferir';
          p.avisos.push(`Não consegui escrever no campo de ${acao.campo}: ${e.message}`);
        }
      }
    }
    const r = relatorio(plano);
    log('Preenchimento concluído. Confira na tela antes de salvar/enviar no portal.');
    console.table(r.map((x) => ({ item: x.numero, status: x.status, avisos: x.avisos.join(' ') })));
    return { portal: { id: a.id, nome: a.nome, validado: a.validado }, itens: r };
  }

  /** Diagnóstico para validar um portal novo: o que a leitura enxerga em cada campo. */
  function mapear() {
    const a = adaptador();
    const campos = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].slice(0, 400).map((el) => ({
      tag: el.tagName.toLowerCase(), tipo: el.type, nome: el.name, id: el.id, pista: a.pistaDoCampo(el).slice(0, 160),
      linhaItem: a.numeroDaLinha(el.closest(a.seletorLinha) || el.parentElement),
    }));
    log(`Mapa da página (${a.nome}): ${campos.length} campo(s). Use isto para ajustar o adaptador.`);
    console.table(campos);
    return { portal: { id: a.id, nome: a.nome, validado: a.validado }, campos: campos.length, linhas: a.lerLinhas(document).length };
  }

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
    const acoes = { 'lhx:analisar': analisar, 'lhx:preencher': preencher, 'lhx:mapear': mapear, 'lhx:limpar': () => { limpar(); return { ok: true }; } };
    const fn = acoes[msg?.tipo];
    if (!fn) return false;
    Promise.resolve().then(() => fn(msg.dados || {}))
      .then((r) => responder({ ok: true, ...r }))
      .catch((e) => { console.error('[LicitaHub]', e); responder({ ok: false, erro: e.message }); });
    return true; // resposta assíncrona
  });
  log('Pronto nesta página.');
}(globalThis));
