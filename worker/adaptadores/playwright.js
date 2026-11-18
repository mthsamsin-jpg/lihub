// Adaptador genérico com Playwright, guiado pelo mapa de seletores do portal.
// Os adaptadores de cada portal (ex.: BllAdapter) herdam daqui e só mudam o que
// for diferente. Para mapear um portal novo, preencha worker/adaptadores/seletores.js.
import { ErroAdaptador, PortalAdapter } from './base.js';
import { camposPendentes } from './seletores.js';

const TEMPO_PADRAO_MS = 20_000;

/** "R$ 1.234,56" -> 1234.56 (null se não for número). */
export function lerReais(texto) {
  const limpo = String(texto ?? '').replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  const n = Number(limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 1234.5 -> "1234,50" (formato que os campos de lance aceitam). */
export const reaisParaCampo = (v) => Number(v).toFixed(2).replace('.', ',');

/** Texto da fase do portal -> fase do LicitaHub (null se não reconhecer). */
export function lerFase(texto, mapa = []) {
  const t = String(texto ?? '');
  for (const [re, fase] of mapa) if (re.test(t)) return fase;
  return null;
}

/** Porte pelo texto da linha (ME / EPP / demais). */
export function lerPorte(texto) {
  const t = String(texto ?? '').toUpperCase();
  if (/\bEPP\b/.test(t)) return 'epp';
  if (/\bME\b/.test(t)) return 'me';
  return 'demais';
}

// Roda DENTRO da página: lê a sala só com seletores (sem depender de bibliotecas).
function lerSalaNaPagina(sel) {
  const txt = (raiz, s) => (s ? (raiz.querySelector(s)?.textContent || '').trim() : '');
  const nossos = sel.lanceNosso ? new Set(document.querySelectorAll(sel.lanceNosso)) : new Set();
  const lances = [...document.querySelectorAll(sel.linhaLance)].map((linha) => ({
    valorTexto: txt(linha, sel.lanceValor),
    autor: txt(linha, sel.lanceAutor),
    porteTexto: sel.lancePorte ? txt(linha, sel.lancePorte) : linha.textContent || '',
    hora: txt(linha, sel.lanceHora),
    nosso: nossos.has(linha) || [...nossos].some((n) => n.contains(linha) || linha.contains(n)),
  }));
  const mensagens = sel.linhaMensagem ? [...document.querySelectorAll(sel.linhaMensagem)].map((linha) => ({
    autor: txt(linha, sel.mensagemAutor), texto: txt(linha, sel.mensagemTexto) || (linha.textContent || '').trim(), hora: txt(linha, sel.mensagemHora),
  })) : [];
  return { faseTexto: sel.fase ? (document.querySelector(sel.fase)?.textContent || '').trim() : '', tempoTexto: sel.tempo ? (document.querySelector(sel.tempo)?.textContent || '').trim() : '', lances, mensagens };
}

/** "02:15" ou "00:02:15" -> milissegundos (null se não reconhecer). */
export function lerCronometro(texto) {
  const m = String(texto ?? '').match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return ((Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3])) * 1000;
}

export class AdaptadorPorSeletores extends PortalAdapter {
  /**
   * @param {object} deps
   * @param {string} deps.portal
   * @param {object} deps.seletores           ver seletores.js
   * @param {object} deps.credencial          { tipo:'senha', login, senha } | { tipo:'certificado', pfx (base64), senhaCertificado, login? }
   * @param {() => Promise<object>} deps.carregarPlaywright   import('playwright') (carregado só quando precisa)
   * @param {boolean} [deps.permitirNaoValidado]  usar seletores ainda não conferidos (só para mapear; nunca envia lance)
   */
  constructor({ portal, seletores, credencial, carregarPlaywright, permitirNaoValidado = false, headless = true, executavel = null, intervaloLeituraMs = 1000, log }) {
    super({ portal, credencial, log });
    Object.assign(this, { sel: seletores, carregarPlaywright, permitirNaoValidado, headless, executavel, intervaloLeituraMs });
    this.navegador = null;
    this.pagina = null;
  }

  exigir(grupos) {
    const faltam = camposPendentes(this.sel, grupos);
    if (faltam.length) {
      throw new ErroAdaptador(`O portal ${this.portal} ainda não foi mapeado para o modo real (faltam: ${faltam.join(', ')}).`, 'seletores_pendentes', faltam);
    }
    if (!this.sel.validado && !this.permitirNaoValidado) {
      throw new ErroAdaptador(`Os seletores do portal ${this.portal} ainda não foram conferidos numa sessão real.`, 'seletores_pendentes');
    }
  }

  async abrir() {
    if (this.pagina) return;
    let pw;
    try { pw = await this.carregarPlaywright(); } catch {
      throw new ErroAdaptador('O Playwright não está instalado no servidor (npm i playwright && npx playwright install chromium).', 'sem_navegador');
    }
    // executavel: Chrome/Chromium já instalado (senão, o baixado por "npx playwright install chromium").
    this.navegador = await pw.chromium.launch({ headless: this.headless, ...(this.executavel ? { executablePath: this.executavel } : {}) });
    const opcoes = { locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' };
    if (this.credencial?.tipo === 'certificado') {
      // Certificado A1: o navegador apresenta o .pfx ao portal (TLS com certificado do cliente).
      opcoes.clientCertificates = [{ origin: this.sel.urlBase, pfx: Buffer.from(this.credencial.pfx, 'base64'), passphrase: this.credencial.senhaCertificado }];
    }
    const contexto = await this.navegador.newContext(opcoes);
    this.pagina = await contexto.newPage();
    this.pagina.setDefaultTimeout(TEMPO_PADRAO_MS);
  }

  async login() {
    const certificado = this.credencial?.tipo === 'certificado';
    this.exigir([]);
    const l = this.sel.login;
    const p = this.pagina;
    if (certificado) {
      if (!l.urlCertificado || !l.botaoCertificado || !l.logado) throw new ErroAdaptador(`Login por certificado no ${this.portal} ainda não foi mapeado.`, 'seletores_pendentes');
      await p.goto(l.urlCertificado);
      await p.click(l.botaoCertificado);
    } else {
      this.exigir(['login']);
      await p.goto(l.url);
      await p.fill(l.usuario, String(this.credencial.login ?? ''));
      await p.fill(l.senha, String(this.credencial.senha ?? ''));
      await p.click(l.entrar);
    }
    const resultado = await Promise.race([
      p.waitForSelector(l.logado).then(() => 'ok'),
      l.erro ? p.waitForSelector(l.erro).then(() => 'erro') : new Promise(() => {}),
    ]).catch(() => 'tempo');
    if (resultado === 'ok') return;
    const texto = resultado === 'erro' ? (await p.textContent(l.erro).catch(() => '')).trim() : '';
    throw new ErroAdaptador(texto ? `O portal recusou o login: ${texto}` : `Não consegui confirmar o login no ${this.portal}.`, 'login');
  }

  async joinAuctionRoom({ pregao, lote }) {
    this.exigir(['sala']);
    const s = this.sel.sala;
    const p = this.pagina;
    if (s.url) await p.goto(typeof s.url === 'function' ? s.url(pregao, lote) : s.url);
    else {
      await p.fill(s.busca, String(pregao));
      await p.click(s.buscar);
      await p.click(s.resultado);
    }
    await p.waitForSelector(s.pronta).catch(() => {
      throw new ErroAdaptador(`Não encontrei a sala de disputa do pregão ${pregao}${lote ? `, lote ${lote}` : ''} no ${this.portal}.`, 'sala');
    });
  }

  async lerSala() {
    const s = this.sel.sala;
    const bruto = await this.pagina.evaluate(lerSalaNaPagina, {
      linhaLance: s.linhaLance, lanceValor: s.lanceValor, lanceAutor: s.lanceAutor, lancePorte: s.lancePorte, lanceHora: s.lanceHora, lanceNosso: s.lanceNosso,
      fase: s.fase, tempo: s.tempo, linhaMensagem: s.linhaMensagem, mensagemAutor: s.mensagemAutor, mensagemTexto: s.mensagemTexto, mensagemHora: s.mensagemHora,
    });
    const restante = lerCronometro(bruto.tempoTexto);
    return {
      fase: lerFase(bruto.faseTexto, s.fases),
      fimEm: restante == null ? null : Date.now() + restante,
      lances: bruto.lances.map((l) => ({ valor: lerReais(l.valorTexto), autor: l.nosso ? 'nos' : (l.autor || 'Concorrente'), porte: lerPorte(l.porteTexto), nosso: l.nosso, hora: l.hora }))
        .filter((l) => l.valor != null),
      mensagens: bruto.mensagens.filter((m) => m.texto),
    };
  }

  /** Lê a sala a cada intervalo e avisa só as novidades. */
  watchBids(callback) {
    const vistos = new Set();
    let fase = null;
    let parado = false;
    let primeira = true;
    const chave = (x) => JSON.stringify(x);
    const ler = async () => {
      if (parado) return;
      try {
        const sala = await this.lerSala();
        if (sala.fase && sala.fase !== fase) { fase = sala.fase; callback({ tipo: 'fase', fase, fimEm: sala.fimEm }); }
        for (const l of sala.lances) {
          const k = chave(['l', l.autor, l.valor, l.hora]);
          if (vistos.has(k)) continue;
          vistos.add(k);
          callback({ tipo: 'lance', ...l, inicial: primeira });
        }
        for (const m of sala.mensagens) {
          const k = chave(['m', m.autor, m.texto, m.hora]);
          if (vistos.has(k)) continue;
          vistos.add(k);
          if (!primeira) callback({ tipo: 'mensagem', ...m });
        }
        primeira = false;
      } catch (e) {
        callback({ tipo: 'erro', texto: e.message });
      }
      if (!parado) setTimeout(ler, this.intervaloLeituraMs);
    };
    ler();
    return () => { parado = true; };
  }

  async placeBid(valor) {
    if (!this.sel.validado) throw new ErroAdaptador(`Lance bloqueado: os seletores do ${this.portal} ainda não foram conferidos.`, 'seletores_pendentes');
    this.exigir(['lance']);
    const l = this.sel.lance;
    const p = this.pagina;
    await p.fill(l.campo, reaisParaCampo(valor));
    await p.click(l.enviar);
    if (l.confirmar) await p.click(l.confirmar, { timeout: 3000 }).catch(() => {});
    if (l.sucesso || l.erro) {
      const r = await Promise.race([
        l.sucesso ? p.waitForSelector(l.sucesso, { timeout: 10_000 }).then(() => 'ok') : new Promise(() => {}),
        l.erro ? p.waitForSelector(l.erro, { timeout: 10_000 }).then(() => 'erro') : new Promise(() => {}),
      ]).catch(() => 'tempo');
      if (r === 'erro') throw new ErroAdaptador(`O portal recusou o lance: ${(await p.textContent(l.erro).catch(() => '')).trim() || 'sem detalhe'}`, 'lance');
      if (r === 'tempo') throw new ErroAdaptador('O portal não confirmou o lance a tempo.', 'lance');
    }
  }

  async close() {
    const n = this.navegador;
    this.navegador = null;
    this.pagina = null;
    await n?.close().catch(() => {});
  }
}
