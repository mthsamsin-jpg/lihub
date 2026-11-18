/* =============================================================================
   Robô Turbo 2.0 · camada analítica (preditiva). Só calcula: não envia lance.
   Usada no navegador (sala simulada, LH.roboAnalise) e no worker do modo real
   (src/robo/analise.js), como o motor.

   1. PerfilConcorrentes: comportamento de cada concorrente na disputa
      (tempo de resposta depois do nosso lance e agressividade de preço).
      Na etapa de lances os portais escondem o CNPJ ("Fornecedor 7"): o perfil é
      por apelido dentro do pregão. Quando o portal mostra o CNPJ (ou depois da
      homologação), o identificador passa a ser o CNPJ e o perfil acumula entre pregões.
   2. estimarFechamento: preço de fechamento previsto, com intervalo, cruzando
      o deságio das homologações parecidas (histórico) com o ritmo da praça agora
      (as descidas encolhem perto do fim: extrapolação geométrica).
   3. analisar: probabilidade estatística de vitória e margem estimada sobre o custo.
   ============================================================================= */
(function (raiz) {
  'use strict';

  const centavos = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const reais = (c) => Math.round(c) / 100;
  const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const mediana = (xs) => {
    if (!xs.length) return null;
    const o = [...xs].sort((a, b) => a - b);
    const m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  };
  const desvio = (xs) => {
    if (xs.length < 2) return null;
    const m = media(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  };
  // Função de distribuição da normal padrão (aproximação de Abramowitz-Stegun, erro < 1e-7).
  function phi(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z >= 0 ? 1 - p : p;
  }

  // Inversa da normal padrão (Acklam), para os percentis da faixa prevista.
  function inversaPhi(p) {
    const q = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155211639];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    const lo = 0.02425;
    if (q < lo) { const t = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1); }
    if (q > 1 - lo) { const t = Math.sqrt(-2 * Math.log(1 - q)); return -(((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1); }
    const t = q - 0.5; const r = t * t;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // Sem histórico parecido, parte de um deságio genérico de pregão eletrônico e
  // deixa a incerteza larga: a previsão se apoia cada vez mais na praça ao vivo.
  const DESAGIO_PADRAO = { media: 20, desvio: 12, n: 0, fonte: 'padrao' };

  /* ---------------------------------------------------------------------------
     1. Perfil dos concorrentes
     --------------------------------------------------------------------------- */
  class PerfilConcorrentes {
    constructor() {
      this.por = new Map(); // autor -> dados
      this.melhor = null;   // menor lance da praça (centavos)
      this.nossoEm = null;  // quando saiu o nosso último lance
    }

    nosso(valor, em = Date.now()) {
      this.nossoEm = em;
      const c = centavos(valor);
      if (c != null && (this.melhor == null || c < this.melhor)) this.melhor = c;
    }

    registrar({ autor, valor, porte = 'demais', em = Date.now(), cnpj = null }) {
      const c = centavos(valor);
      if (!autor || autor === 'nos' || c == null) return null;
      let p = this.por.get(autor);
      if (!p) { p = { autor, cnpj, porte, lances: 0, respostas: [], descidas: [], primeiroEm: em, ultimoEm: em, menor: c }; this.por.set(autor, p); }
      if (cnpj) p.cnpj = cnpj;
      // Agressividade: quanto este lance desceu abaixo do melhor da praça (em % do melhor).
      if (this.melhor != null && c < this.melhor) p.descidas.push(((this.melhor - c) / this.melhor) * 100);
      // Velocidade: quanto tempo levou para responder ao nosso lance.
      if (this.nossoEm != null && em >= this.nossoEm && (p.ultimaRespostaA !== this.nossoEm)) {
        p.respostas.push(em - this.nossoEm);
        p.ultimaRespostaA = this.nossoEm;
      }
      p.lances += 1;
      p.ultimoEm = em;
      p.menor = Math.min(p.menor, c);
      if (this.melhor == null || c < this.melhor) this.melhor = c;
      return this.resumoDe(p);
    }

    resumoDe(p) {
      const resp = mediana(p.respostas);
      const agr = media(p.descidas);
      // Agressivo: desce forte (≥ 1% por lance) ou responde em até 5 s.
      const perfil = (agr != null && agr >= 1) || (resp != null && resp <= 5000) ? 'agressivo'
        : (agr != null && agr < 0.2) && (resp == null || resp > 20000) ? 'passivo' : 'moderado';
      return {
        autor: p.autor, cnpj: p.cnpj || null, porte: p.porte, lances: p.lances, menor: reais(p.menor),
        respostaMedianaMs: resp == null ? null : Math.round(resp), agressividadePct: agr == null ? null : Math.round(agr * 100) / 100, perfil,
      };
    }

    resumo() {
      return [...this.por.values()].map((p) => this.resumoDe(p)).sort((a, b) => a.menor - b.menor);
    }
  }

  /* ---------------------------------------------------------------------------
     2. Estimativa do preço de fechamento
     --------------------------------------------------------------------------- */

  /** Deságio (%) das homologações parecidas: média, desvio e quantas entraram. */
  function desagioHistorico(historico = []) {
    const xs = historico.map((h) => Number(h.desagioPct)).filter((x) => Number.isFinite(x) && x >= 0 && x < 95);
    if (xs.length < 3) return { ...DESAGIO_PADRAO, n: xs.length };
    return { media: media(xs), desvio: Math.max(2, desvio(xs) ?? 0), n: xs.length, fonte: 'historico' };
  }

  /**
   * Ritmo da praça: sequência do melhor lance ao longo do tempo. Se as descidas estão
   * encolhendo (razão r < 1), a soma do que ainda falta é d·r/(1−r) e dá o ponto onde
   * a praça deve parar. A inflexão é o primeiro lance a partir do qual as descidas
   * passam a encolher de forma consistente.
   */
  function ritmoDaPraca(lances = []) {
    const melhores = [];
    for (const l of [...lances].sort((a, b) => (a.em ?? 0) - (b.em ?? 0))) {
      const c = centavos(l.valor);
      if (c == null) continue;
      if (!melhores.length || c < melhores[melhores.length - 1].c) melhores.push({ c, em: l.em ?? null });
    }
    const desc = melhores.slice(1).map((m, i) => melhores[i].c - m.c).filter((d) => d > 0);
    if (melhores.length < 4 || desc.length < 3) return { atual: melhores.length ? reais(melhores[melhores.length - 1].c) : null, previsto: null, inflexao: null, n: melhores.length };
    const razoes = desc.slice(1).map((d, i) => d / desc[i]);
    const r = mediana(razoes.slice(-6));
    const atual = melhores[melhores.length - 1].c;
    // Sem desaceleração clara (descidas do mesmo tamanho ou crescendo), a soma geométrica
    // não converge: a praça ainda não dá pista de onde para e não extrapola nada.
    if (!(r < 0.85)) return { atual: reais(atual), previsto: null, inflexao: null, razao: Math.round(r * 1000) / 1000, n: melhores.length };
    // O que falta descer, limitado a 10% do preço atual (proteção contra séries curtas).
    const falta = Math.min((desc[desc.length - 1] * r) / (1 - r), atual * 0.1);
    // Inflexão: primeiro ponto a partir do qual todas as razões seguintes ficam < 1.
    let k = razoes.length;
    while (k > 0 && razoes[k - 1] < 1) k -= 1;
    const inflexao = k < razoes.length ? melhores[k + 1] : null;
    return {
      atual: reais(atual), previsto: reais(Math.max(1, atual - falta)), razao: Math.round(r * 1000) / 1000,
      inflexao: inflexao ? { valor: reais(inflexao.c), em: inflexao.em } : null, n: melhores.length,
    };
  }

  /**
   * Preço de fechamento previsto (por unidade).
   * @param {{ teto:number, lances:Array<{valor:number, em?:number}>, historico?:Array<{desagioPct:number}> }} p
   * @returns {{ previsto, minimo, maximo, desvio, desagioPrevistoPct, inflexao, confianca, fonte }}
   */
  function estimarFechamento({ teto, lances = [], historico = [] }) {
    const t = Number(teto);
    if (!(t > 0)) return null;
    const h = desagioHistorico(historico);
    const precoHist = t * (1 - h.media / 100);
    const sigmaHist = t * (h.desvio / 100);
    const ritmo = ritmoDaPraca(lances);
    let previsto = precoHist;
    let sigma = sigmaHist;
    let pesoPraca = 0;
    if (ritmo.previsto != null) {
      // Quanto mais lances, mais a praça ao vivo pesa. Com histórico de verdade, metade a
      // metade em 5 lances; só com o deságio genérico, a praça manda já a partir de 2.
      pesoPraca = ritmo.n / (ritmo.n + (h.fonte === 'historico' ? 5 : 2));
      const sigmaPraca = Math.max(t * 0.01, Math.abs(ritmo.atual - ritmo.previsto) * 0.6);
      previsto = (1 - pesoPraca) * precoHist + pesoPraca * ritmo.previsto;
      sigma = Math.sqrt(((1 - pesoPraca) * sigmaHist) ** 2 + (pesoPraca * sigmaPraca) ** 2);
    }
    // A praça nunca fecha acima do melhor lance que já existe: a distribuição é cortada
    // ali (normal truncada). O previsto mostrado é a média já com esse corte.
    sigma = Math.max(sigma, t * 0.002);
    const limite = ritmo.atual ?? t;
    const mu = previsto;
    const b = (limite - mu) / sigma;
    const cauda = Math.max(phi(b), 1e-9);
    previsto = Math.max(0.01, Math.min(limite, mu - sigma * (0.3989422804014327 * Math.exp(-b * b / 2)) / cauda));
    // Faixa de 90% dentro do corte (percentis 5% e 95% da normal truncada).
    const quantil = (q) => mu + sigma * inversaPhi(q * cauda);
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      previsto: r2(previsto), desvio: r2(sigma), media: r2(mu), limite: r2(limite),
      minimo: r2(Math.max(0.01, quantil(0.05))), maximo: r2(Math.min(limite, quantil(0.95))),
      desagioPrevistoPct: r2((1 - previsto / t) * 100), inflexao: ritmo.inflexao, ritmo: ritmo.razao ?? null,
      confianca: pesoPraca >= 0.5 || h.fonte === 'historico' ? (pesoPraca >= 0.5 && h.fonte === 'historico' ? 'alta' : 'media') : 'baixa',
      fonte: { historico: h.fonte, homologacoes: h.n, lancesNaPraca: ritmo.n },
    };
  }

  /* ---------------------------------------------------------------------------
     3. Probabilidade de vitória e margem estimada
     --------------------------------------------------------------------------- */

  /**
   * @param {{ teto, piso, custo?, decremento?, estimativa }} p  piso = piso efetivo (o robô nunca vai abaixo)
   * Vencemos se a praça (sem nós) parar acima do nosso piso: P = 1 − Φ((piso − previsto)/σ).
   * O preço de vitória esperado é ~ um decremento abaixo de onde os outros param,
   * nunca abaixo do piso; a margem é calculada sobre o custo.
   */
  function analisar({ teto, piso, custo = null, decremento = 0.01, estimativa }) {
    if (!estimativa) return null;
    // X = onde os concorrentes param: normal(media, desvio) cortada no melhor lance atual.
    const mu = estimativa.media ?? estimativa.previsto;
    const sigma = Math.max(estimativa.desvio, 0.01);
    const limite = estimativa.limite ?? Number(teto);
    const cauda = phi((limite - mu) / sigma);
    const pisoN = Number(piso);
    // Vencemos se a praça parar acima do nosso piso (aí dá para cobrir).
    const prob = limite <= pisoN || cauda <= 1e-9 ? 0 : Math.max(0, (cauda - phi((pisoN - mu) / sigma)) / cauda);
    // Esperança do nosso preço quando vencemos: integra X entre o piso e o limite.
    let soma = 0; let peso = 0;
    for (let z = -4; z <= 4; z += 0.05) {
      const x = mu + z * sigma;
      if (x <= pisoN || x > limite) continue;
      const w = Math.exp(-z * z / 2);
      soma += w * Math.max(Number(piso), Math.min(Number(teto), x - decremento));
      peso += w;
    }
    const precoVitoria = peso ? soma / peso : null;
    const margem = custo != null && precoVitoria != null && custo > 0 ? ((precoVitoria - custo) / custo) * 100 : null;
    const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
    return {
      probabilidadeVitoria: Math.round(prob * 1000) / 10, // %
      precoVitoriaEsperado: r2(precoVitoria), margemEstimadaPct: r2(margem),
      tetoSeguroDesagioPct: r2((1 - Number(piso) / Number(teto)) * 100), // o máximo que dá para descer sem furar o piso
    };
  }

  /* ---------------------------------------------------------------------------
     4. Monitor preditivo: junta tudo e decide QUANDO vale alertar
     (sem inundar o operador: só mudanças relevantes, com intervalo mínimo).
     --------------------------------------------------------------------------- */
  const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

  class MonitorPreditivo {
    /**
     * @param {{ teto, piso, custo?, decremento?, historico?, agora?, intervaloAlertaMs?, saltoProbPts? }} item
     *   piso: o piso EFETIVO (com a margem mínima, se houver)
     */
    constructor({ teto, piso, custo = null, decremento = 0.01, historico = [], agora = () => Date.now(), intervaloAlertaMs = 15000, saltoProbPts = 10 }) {
      Object.assign(this, { teto, piso, custo, decremento, historico, agora, intervaloAlertaMs, saltoProbPts });
      this.perfil = new PerfilConcorrentes();
      this.lances = [];
      this.ultimoAlerta = null; // { em, prob }
      this.previsao = null;
    }

    concorrente(autor, valor, porte, extra = {}) {
      const em = this.agora();
      const perfil = this.perfil.registrar({ autor, valor, porte, em, ...extra });
      this.lances.push({ valor, em });
      return { perfil, ...this.recalcular() };
    }

    // O nosso lance entra no perfil (para medir quanto tempo cada um leva para responder),
    // mas não na série da praça: a previsão é de onde os CONCORRENTES param.
    nosso(valor) {
      this.perfil.nosso(valor, this.agora());
      return this.recalcular();
    }

    limites({ piso, teto }) { if (piso != null) this.piso = piso; if (teto != null) this.teto = teto; return this.recalcular(); }

    recalcular() {
      const estimativa = estimarFechamento({ teto: this.teto, lances: this.lances, historico: this.historico });
      const chances = analisar({ teto: this.teto, piso: this.piso, custo: this.custo, decremento: this.decremento, estimativa });
      this.previsao = estimativa && chances ? { ...estimativa, ...chances, concorrentes: this.perfil.resumo() } : null;
      return { previsao: this.previsao, alerta: this.deveAlertar() };
    }

    /** Alerta quando a chance cruza 50%, muda muito, ou na primeira previsão com dados da praça. */
    deveAlertar() {
      const p = this.previsao;
      if (!p || p.fonte.lancesNaPraca < 3) return null;
      const agora = this.agora();
      const u = this.ultimoAlerta;
      const prob = p.probabilidadeVitoria;
      // Sem chance (a praça já passou do nosso piso): avisa na hora, sem esperar o intervalo.
      if (u && prob === 0 && u.prob > 0) { this.ultimoAlerta = { em: agora, prob }; return { motivo: 'sem_chance', texto: this.texto() }; }
      const cruzou = u && (u.prob >= 50) !== (prob >= 50);
      const salto = !u || Math.abs(prob - u.prob) >= this.saltoProbPts;
      if (!cruzou && !salto) return null;
      if (u && !cruzou && agora - u.em < this.intervaloAlertaMs) return null;
      this.ultimoAlerta = { em: agora, prob };
      return { motivo: !u ? 'primeira' : cruzou ? (prob >= 50 ? 'virou_favoravel' : 'virou_desfavoravel') : (prob > u.prob ? 'subiu' : 'caiu'), texto: this.texto() };
    }

    texto() {
      const p = this.previsao;
      if (!p) return '';
      const agressivos = p.concorrentes.filter((c) => c.perfil === 'agressivo').slice(0, 2)
        .map((c) => `${c.autor}${c.respostaMedianaMs != null ? ` responde em ~${Math.round(c.respostaMedianaMs / 1000)}s` : ''}`);
      return `Previsão: fechamento em ${brl(p.previsto)} (entre ${brl(p.minimo)} e ${brl(p.maximo)}, confiança ${p.confianca}). `
        + `Chance de vitória: ${pct(p.probabilidadeVitoria)}. Margem estimada: ${pct(p.margemEstimadaPct)}. `
        + `Deságio máximo seguro: ${pct(p.tetoSeguroDesagioPct)}.`
        + (agressivos.length ? ` Concorrente agressivo: ${agressivos.join('; ')}.` : '');
    }
  }

  const api = { PerfilConcorrentes, MonitorPreditivo, estimarFechamento, ritmoDaPraca, desagioHistorico, analisar, phi, inversaPhi, DESAGIO_PADRAO };
  raiz.LHRoboAnalise = api;
  if (raiz.LH) raiz.LH.roboAnalise = api;
}(typeof window !== 'undefined' ? window : globalThis));
