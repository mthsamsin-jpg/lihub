// Adaptador base: sabe LER a tabela de itens de uma página de proposta e ESCREVER
// num campo de forma que o formulário (Angular, React, máscaras jQuery) reconheça.
// Cada portal estende e ajusta só o que for diferente (seletores e pistas).
(function (raiz) {
  const LHX = (raiz.LHX = raiz.LHX || {});

  const visivel = (el) => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.disabled && !el.readOnly);
  const textoDe = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

  class AdaptadorBase {
    /** Identificador e nome mostrados no relatório. */
    id = 'generico';
    nome = 'Página genérica';
    /** Seletores ainda não conferidos numa sessão real: o popup avisa. */
    validado = false;
    /** Casas decimais aceitas no valor unitário. */
    casas = 2;
    /** Onde procurar as linhas de item. */
    seletorLinha = 'tr, [role="row"], .item, .card, li';
    /** Pistas (nome/id/placeholder/rótulo/cabeçalho) que identificam cada campo. */
    pistas = {
      unitario: /valor\s*unit|unit[aá]rio|pre[cç]o\s*unit|vl_?unit|valorunit|vlr_?unit|valor\s*ofertado|valor\s*proposto/i,
      marca: /marca|fabricante/i,
      modelo: /modelo|vers[aã]o/i,
      descricao: /descri|especifica|detalhamento/i,
    };

    /** Esta página é deste portal? */
    reconhece(_url) { return false; }

    /** Texto que descreve um campo: atributos, <label>, aria e o cabeçalho da coluna. */
    pistaDoCampo(el) {
      const partes = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('formcontrolname'), el.title];
      if (el.id) partes.push(textoDe(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)));
      partes.push(textoDe(el.closest('label')));
      const celula = el.closest('td, th');
      const tabela = celula?.closest('table');
      if (celula && tabela) {
        const th = tabela.querySelectorAll('thead th, tr:first-child th')[celula.cellIndex];
        partes.push(textoDe(th));
      }
      return partes.filter(Boolean).join(' | ');
    }

    /** Número do item na linha ("1", "Item 01", "001 - Caneta..."). */
    numeroDaLinha(linha) {
      const t = textoDe(linha.querySelector('td, th, .numero, [class*="item"]') || linha);
      const m = /^\s*(?:item\s*n?[ºo°.]?\s*)?0*(\d{1,4})\b/i.exec(t) || /\bitem\s*n?[ºo°.]?\s*0*(\d{1,4})\b/i.exec(textoDe(linha));
      return m ? m[1] : null;
    }

    /** Descrição: a célula de texto mais longa que não tem campo. */
    descricaoDaLinha(linha) {
      let melhor = '';
      for (const c of linha.querySelectorAll('td, div, span, p')) {
        if (c.querySelector('input, textarea, select')) continue;
        const t = textoDe(c);
        if (t.length > melhor.length && t.length < 2000) melhor = t;
      }
      return melhor || null;
    }

    /** Quantidade/unidade, quando a linha mostra (para conferência). */
    extrasDaLinha(linha) {
      const t = textoDe(linha);
      const q = /(?:quantidade|qtd\.?|qtde)\s*:?\s*([\d.,]+)/i.exec(t);
      const u = /(?:unidade|und\.?|un\.?)\s*(?:de\s*fornecimento)?\s*:?\s*([A-Za-zÀ-ú]{1,20})/i.exec(t);
      return { quantidade: q ? q[1] : null, unidade: u ? u[1] : null };
    }

    /** Classifica os campos da linha pelas pistas. */
    camposDaLinha(linha) {
      const campos = {};
      for (const el of linha.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea')) {
        if (!visivel(el)) continue;
        const pista = this.pistaDoCampo(el);
        for (const [campo, re] of Object.entries(this.pistas)) {
          if (!campos[campo] && re.test(pista)) { campos[campo] = { el, atual: el.value, pista }; break; }
        }
      }
      return campos;
    }

    /** Lê as linhas de item da página (só as mais internas que têm campo editável). */
    lerLinhas(doc = document) {
      const candidatas = [...doc.querySelectorAll(this.seletorLinha)]
        .filter((l) => l.querySelector('input:not([type=hidden]), textarea'));
      const internas = candidatas.filter((l) => !candidatas.some((o) => o !== l && l.contains(o)));
      const linhas = [];
      for (const el of internas) {
        const campos = this.camposDaLinha(el);
        if (!Object.keys(campos).length) continue;
        linhas.push({ el, numero: this.numeroDaLinha(el), descricao: this.descricaoDaLinha(el), ...this.extrasDaLinha(el), campos });
      }
      return linhas;
    }

    /**
     * Escreve como uma pessoa: foco, valor pelo "setter" nativo (Angular/React percebem),
     * eventos input/change e saída do campo (blur), que dispara máscaras e validações.
     */
    async escrever(el, valor) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: valor, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' }));
      el.blur();
      el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60)); // tempo para a máscara reformatar
      return el.value;
    }
  }

  LHX.AdaptadorBase = AdaptadorBase;
  LHX.textoDe = textoDe;
}(globalThis));
