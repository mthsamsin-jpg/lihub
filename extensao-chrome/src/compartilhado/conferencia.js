// Regras puras (sem DOM) usadas pela página do portal e testadas no Node:
// números no formato brasileiro, comparação de descrições e o PLANO de
// preenchimento item a item com o relatório (Preenchido / Conferir / Não encontrado).
// Script clássico: expõe tudo em globalThis.LHX.
(function (raiz) {
  const LHX = (raiz.LHX = raiz.LHX || {});

  /** "1.234,56" | "1234.56" | "R$ 10,5" -> número (ou null). */
  function lerNumero(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v ?? '').replace(/[^\d,.-]/g, '');
    if (!s) return null;
    const temVirgula = s.includes(',');
    if (temVirgula) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, ''); // 1.234.567
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** número -> "1234,56" (sem separador de milhar: as máscaras dos portais costumam aceitar melhor). */
  function formatarValor(n, casas = 2) {
    return Number(n).toFixed(casas).replace('.', ',');
  }

  /** Iguais até a última casa pedida (evita erro de vírgula/arredondamento). */
  function mesmoValor(a, b, casas = 2) {
    const x = lerNumero(a);
    const y = lerNumero(b);
    if (x == null || y == null) return false;
    return Math.round(x * 10 ** casas) === Math.round(y * 10 ** casas);
  }

  const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'com', 'para', 'por', 'a', 'o', 'as', 'os', 'um', 'uma', 'tipo', 'cor', 'ref']);
  function palavras(t) {
    return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .split(/[^a-z0-9]+/).filter((p) => p.length > 1 && !PARADAS.has(p));
  }

  /** Semelhança entre descrições (0 a 1): palavras em comum sobre as da menor. */
  function semelhanca(a, b) {
    const A = new Set(palavras(a));
    const B = new Set(palavras(b));
    if (!A.size || !B.size) return 0;
    let comum = 0;
    for (const p of A) if (B.has(p)) comum++;
    return comum / Math.min(A.size, B.size);
  }

  const LIMIAR_DESCRICAO = 0.35;

  /**
   * Monta o plano de preenchimento.
   * @param {Array<{ numero, descricao, quantidade, unidade, unitario, marca, modelo? }>} itens  da proposta
   * @param {Array<{ numero, descricao?, quantidade?, unidade?, campos: Record<string, { atual: string } | undefined> }>} linhas  lidas da página
   * @param {{ casas?: number, sobrescrever?: boolean }} opcoes
   * @returns {Array<{ item, linha, status: 'preenchido'|'conferir'|'nao_encontrado', acoes: Array<{ campo, valor }>, avisos: string[] }>}
   *   status aqui é o PREVISTO; depois de escrever, a página confirma lendo o campo de volta.
   */
  function planejar(itens, linhas, { casas = 2, sobrescrever = false } = {}) {
    const usadas = new Set();
    const porNumero = new Map(linhas.map((l, i) => [String(l.numero ?? '').replace(/^0+/, ''), i]));
    return itens.map((item) => {
      const avisos = [];
      // 1) pelo número do item; 2) pela descrição mais parecida ainda livre
      let i = porNumero.get(String(item.numero ?? '').replace(/^0+/, ''));
      if (i === undefined || usadas.has(i)) {
        let melhor = -1;
        let nota = 0;
        linhas.forEach((l, k) => {
          if (usadas.has(k)) return;
          const s = semelhanca(item.descricao, l.descricao);
          if (s > nota) { nota = s; melhor = k; }
        });
        if (melhor >= 0 && nota >= LIMIAR_DESCRICAO) {
          i = melhor;
          avisos.push(`Achado pela descrição (o número do item na tela é ${linhas[melhor].numero ?? '?'}).`);
        } else i = undefined;
      }
      if (i === undefined) return { item, linha: null, status: 'nao_encontrado', acoes: [], avisos: ['Item não encontrado nesta página.'] };
      usadas.add(i);
      const linha = linhas[i];

      if (linha.descricao && item.descricao && semelhanca(item.descricao, linha.descricao) < LIMIAR_DESCRICAO) {
        avisos.push('A descrição da tela é bem diferente da proposta: confira se é o mesmo item.');
      }
      if (linha.quantidade != null && item.quantidade != null && lerNumero(linha.quantidade) !== lerNumero(item.quantidade)) {
        avisos.push(`Quantidade diferente: proposta ${item.quantidade}, tela ${linha.quantidade}.`);
      }
      if (linha.unidade && item.unidade && palavras(linha.unidade)[0] !== palavras(item.unidade)[0]) {
        avisos.push(`Unidade diferente: proposta ${item.unidade}, tela ${linha.unidade}.`);
      }

      const acoes = [];
      const querer = (campo, valor, rotulo) => {
        if (valor == null || valor === '') return;
        const alvo = linha.campos?.[campo];
        if (!alvo) { avisos.push(`Campo de ${rotulo} não encontrado na tela.`); return; }
        const atual = String(alvo.atual ?? '').trim();
        const igual = campo === 'unitario' ? mesmoValor(atual, valor, casas) : atual.toLowerCase() === String(valor).trim().toLowerCase();
        if (igual) return; // já está certo
        if (atual && !sobrescrever) { avisos.push(`O campo de ${rotulo} já tem "${atual}": não sobrescrevi (marque "sobrescrever" para trocar).`); return; }
        acoes.push({ campo, valor: campo === 'unitario' ? formatarValor(valor, casas) : String(valor).trim() });
      };

      const unit = lerNumero(item.unitario);
      if (!(unit > 0)) avisos.push('Valor unitário vazio ou zero na proposta: não preenchi o valor.');
      else querer('unitario', unit, 'valor unitário');
      querer('marca', item.marca, 'marca');
      querer('modelo', item.modelo, 'modelo');
      querer('descricao', item.descricaoProposta, 'descrição/especificação');

      return { item, linha, status: avisos.length ? 'conferir' : 'preenchido', acoes, avisos };
    });
  }

  Object.assign(LHX, { lerNumero, formatarValor, mesmoValor, semelhanca, planejar, LIMIAR_DESCRICAO });
}(typeof globalThis !== 'undefined' ? globalThis : window));
