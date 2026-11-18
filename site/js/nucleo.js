/* =============================================================================
   Uso LicitaHub · nucleo.js
   Funções comuns: formatação, avisos, janela (modal), efeitos visuais
   (revelar ao rolar, brilho que segue o mouse, contagem dos números),
   validação de CNPJ e valor por extenso.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // --- Texto seguro: tudo o que vem do usuário passa por aqui antes de ir pro HTML
  const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  LH.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);

  // --- Formatação brasileira ----------------------------------------------------
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const numero = new Intl.NumberFormat('pt-BR');
  const dataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dataLonga = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

  LH.fmt = {
    moeda: (v) => moeda.format(Number(v) || 0),
    numero: (v) => numero.format(Number(v) || 0),
    data: (iso) => (iso ? dataCurta.format(LH.datas.paraData(iso)) : '—'),
    dataLonga: (iso) => dataLonga.format(LH.datas.paraData(iso)),
    diaSemana: (iso) => semana.format(LH.datas.paraData(iso)),
    /** "hoje", "amanhã", "em 5 dias", "há 3 dias" */
    relativo(iso) {
      const d = LH.datas.diasAte(iso);
      if (d === 0) return 'hoje';
      if (d === 1) return 'amanhã';
      if (d === -1) return 'ontem';
      return d > 0 ? `em ${d} dias` : `há ${-d} dias`;
    },
    /** Lê "1.234,56" ou "1234.56" e devolve número */
    lerNumero: (texto) => {
      const t = String(texto ?? '').trim();
      if (!t) return 0;
      const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
      const n = Number(normal.replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    },
  };

  // --- Utilidades ---------------------------------------------------------------
  /** Escuta eventos de vários elementos com um único ouvinte (delegação). */
  LH.ao = (raiz, evento, seletor, fn) => {
    raiz.addEventListener(evento, (e) => {
      const alvo = e.target.closest(seletor);
      if (alvo && raiz.contains(alvo)) fn(e, alvo);
    });
  };
  LH.atrasar = (fn, ms = 250) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  LH.idNovo = (prefixo = 'x') => `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  LH.opcoes = (lista, selecionado, vazio) =>
    (vazio !== undefined ? `<option value="">${LH.esc(vazio)}</option>` : '')
    + lista.map((v) => {
      const [valor, rotulo] = Array.isArray(v) ? v : [v, v];
      return `<option value="${LH.esc(valor)}"${String(valor) === String(selecionado ?? '') ? ' selected' : ''}>${LH.esc(rotulo)}</option>`;
    }).join('');

  // --- Avisos rápidos (toasts) -------------------------------------------------
  const ICONES_AVISO = { info: 'info', sucesso: 'checkCirculo', alerta: 'alerta', perigo: 'alerta' };
  LH.aviso = (texto, tipo = 'info', ms = 4200) => {
    const caixa = document.getElementById('avisos');
    if (!caixa) return;
    const el = document.createElement('div');
    el.className = `aviso aviso--${tipo}`;
    el.setAttribute('role', tipo === 'perigo' ? 'alert' : 'status');
    el.innerHTML = `${LH.icone(ICONES_AVISO[tipo] || 'info')}<div>${LH.esc(texto)}</div>`;
    caixa.append(el);
    setTimeout(() => {
      el.classList.add('saindo');
      setTimeout(() => el.remove(), 320);
    }, ms);
  };

  // --- Janela (modal) ----------------------------------------------------------
  /**
   * LH.modal({ titulo, html, acoes: [{ rotulo, classe, acao(fechar) }] })
   * Devolve a função que fecha a janela.
   */
  LH.modal = ({ titulo, html, acoes = [{ rotulo: 'Fechar' }] }) => {
    const anterior = document.activeElement;
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `
      <div class="modal card--vidro" role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
        <h2 id="modal-titulo">${LH.esc(titulo)}</h2>
        <div class="modal__corpo">${html}</div>
        <div class="modal__acoes">${acoes.map((a, i) => `<button type="button" class="btn ${a.classe || ''}" data-i="${i}">${LH.esc(a.rotulo)}</button>`).join('')}</div>
      </div>`;
    const fechar = () => {
      fundo.remove();
      document.removeEventListener('keydown', aoTeclar);
      anterior?.focus?.();
    };
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) return fechar();
      const botao = e.target.closest('[data-i]');
      if (!botao) return;
      const acao = acoes[Number(botao.dataset.i)].acao;
      if (acao) acao(fechar, fundo); else fechar();
    });
    document.addEventListener('keydown', aoTeclar);
    document.body.append(fundo);
    fundo.querySelector('input, select, textarea, .btn--primario, .btn')?.focus();
    return fechar;
  };

  LH.confirmar = (titulo, texto, rotuloSim = 'Confirmar', perigo = false) => new Promise((resolver) => {
    LH.modal({
      titulo,
      html: `<p>${LH.esc(texto)}</p>`,
      acoes: [
        { rotulo: 'Cancelar', classe: 'btn--fantasma', acao: (f) => { f(); resolver(false); } },
        { rotulo: rotuloSim, classe: perigo ? 'btn--perigo' : 'btn--primario', acao: (f) => { f(); resolver(true); } },
      ],
    });
  });

  // --- Efeitos: revelar ao rolar + contagem dos números ------------------------
  const contar = (el) => {
    const alvo = Number(el.dataset.contar);
    if (!Number.isFinite(alvo)) return;
    const inicio = performance.now();
    const duracao = 1200;
    const passo = (agora) => {
      const t = Math.min(1, (agora - inicio) / duracao);
      const suave = 1 - (1 - t) ** 3;
      el.textContent = LH.fmt.numero(Math.round(alvo * suave));
      if (t < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };

  /** Mostra um número contando até o valor (ou direto, se a animação estiver desligada). */
  LH.contar = (el) => {
    if (semMovimento) el.textContent = LH.fmt.numero(el.dataset.contar);
    else contar(el);
  };

  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const observador = 'IntersectionObserver' in window
    ? new IntersectionObserver((entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        const el = entrada.target;
        el.classList.add('revelado');
        el.querySelectorAll('[data-contar]').forEach(contar);
        if (el.hasAttribute('data-contar')) contar(el);
        observador.unobserve(el);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    : null;

  /** Prepara as animações de entrada dos elementos [data-reveal] dentro da raiz. */
  LH.revelar = (raiz) => {
    const itens = raiz.querySelectorAll('[data-reveal]');
    itens.forEach((el, i) => {
      if (!el.style.getPropertyValue('--atraso')) el.style.setProperty('--atraso', `${Math.min(i, 8) * 60}ms`);
      if (!observador || semMovimento) {
        el.classList.add('revelado');
        el.querySelectorAll('[data-contar]').forEach((n) => { n.textContent = LH.fmt.numero(n.dataset.contar); });
      } else {
        observador.observe(el);
      }
    });
  };

  // --- Efeito: brilho que segue o mouse nos cards (.spot) -------------------
  // Cada card recebe a posição do cursor relativa a ele (--mouse-x / --mouse-y).
  // Assim a borda dos cards vizinhos também acende quando o cursor passa perto.
  let pendente = false;
  let ultimo = null;
  const atualizarBrilho = () => {
    pendente = false;
    if (!ultimo) return;
    const { x, y } = ultimo;
    for (const card of document.querySelectorAll('.spot')) {
      const r = card.getBoundingClientRect();
      if (r.bottom < -300 || r.top > innerHeight + 300) continue; // fora da tela
      card.style.setProperty('--mouse-x', `${x - r.left}px`);
      card.style.setProperty('--mouse-y', `${y - r.top}px`);
    }
  };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    ultimo = { x: e.clientX, y: e.clientY };
    if (!pendente) { pendente = true; requestAnimationFrame(atualizarBrilho); }
  }, { passive: true });
  document.addEventListener('pointerleave', () => {
    ultimo = null;
    document.querySelectorAll('.spot').forEach((c) => { c.style.removeProperty('--mouse-x'); c.style.removeProperty('--mouse-y'); });
  });

  // --- CNPJ ----------------------------------------------------------------------
  LH.cnpj = {
    limpar: (v) => String(v ?? '').replace(/\D/g, '').slice(0, 14),
    mascara(v) {
      const d = LH.cnpj.limpar(v);
      return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
    },
    /** Confere os dígitos verificadores (mesma regra da função cnpj_valido do banco). */
    valido(v) {
      const d = LH.cnpj.limpar(v);
      if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
      const digito = (base) => {
        let soma = 0;
        let peso = base.length - 7;
        for (const n of base) { soma += Number(n) * peso--; if (peso < 2) peso = 9; }
        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
      };
      const d1 = digito(d.slice(0, 12));
      const d2 = digito(d.slice(0, 12) + d1);
      return d.endsWith(`${d1}${d2}`);
    },
  };

  // --- Valor por extenso (para propostas) -------------------------------------
  const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  const ate999 = (n) => {
    if (n === 100) return 'cem';
    const partes = [];
    const c = Math.floor(n / 100);
    const r = n % 100;
    if (c) partes.push(CENTENAS[c]);
    if (r) {
      if (r < 20) partes.push(UNIDADES[r]);
      else partes.push(DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ''));
    }
    return partes.join(' e ');
  };

  const inteiroPorExtenso = (n) => {
    if (n === 0) return 'zero';
    const grupos = [];
    let resto = n;
    while (resto > 0) { grupos.push(resto % 1000); resto = Math.floor(resto / 1000); }
    const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
    const partes = []; // [texto, valor do grupo], do maior para o menor
    for (let i = grupos.length - 1; i >= 0; i--) {
      const g = grupos[i];
      if (!g) continue;
      const texto = i === 1 && g === 1 ? 'mil' : `${ate999(g)}${i ? ` ${nomes[i][g === 1 ? 0 : 1]}` : ''}`;
      partes.push([texto, g]);
    }
    // Regra do "e": entra antes do último grupo quando ele é menor que 100 ou
    // uma centena redonda ("mil e quinhentos", "um milhão e duzentos mil").
    const ultimo = partes.length > 1 ? partes[partes.length - 1] : null;
    if (ultimo && (ultimo[1] < 100 || ultimo[1] % 100 === 0)) {
      partes.pop();
      return `${partes.map((p) => p[0]).join(' ')} e ${ultimo[0]}`;
    }
    return partes.map((p) => p[0]).join(' ');
  };

  /** 1234.5 -> "mil duzentos e trinta e quatro reais e cinquenta centavos" */
  LH.porExtenso = (valor) => {
    const centavosTotal = Math.round((Number(valor) || 0) * 100);
    const reais = Math.floor(centavosTotal / 100);
    const centavos = centavosTotal % 100;
    const milhaoRedondo = reais >= 1000000 && reais % 1000000 === 0;
    const partes = [];
    if (reais) partes.push(`${inteiroPorExtenso(reais)}${milhaoRedondo ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
    if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
    return partes.join(' e ') || 'zero real';
  };

  // --- Notificação no computador (alertas do monitoramento) ------------------------
  LH.notificar = (titulo, corpo) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    try { new Notification(titulo, { body: corpo }); return true; } catch { return false; }
  };
})();
