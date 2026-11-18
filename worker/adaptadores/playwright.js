// Adaptador genérico com Playwright, guiado pelo mapa de seletores do portal.
// Os adaptadores de cada portal (ex.: BllAdapter) herdam daqui e só mudam o que
// for diferente. Para mapear um portal novo, preencha worker/adaptadores/seletores.js.
import { ErroAdaptador, PortalAdapter } from './base.js';
import { camposPendentes } from './seletores.js';

const TEMPO_PADRAO_MS = 20_000;
// Diferença mínima no fim previsto da etapa para avisar o motor (o cronômetro anda
// todo segundo; só interessa quando o prazo MUDA: prorrogação, ajuste do pregoeiro).
const SALTO_CRONOMETRO_MS = 1500;

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

/**
 * Recebe "fotos" da sala e chama callback só com as novidades:
 * lances e mensagens novos, mudança de fase e mudança do prazo (tipo 'tempo').
 * A primeira foto marca os lances como inicial: true.
 */
export function criarDiferenciador(callback) {
  const vistos = new Set();
  let fase = null;
  let fimEm = null;
  let primeira = true;
  const chave = (x) => JSON.stringify(x);
  return (sala) => {
    if (sala.fase && sala.fase !== fase) {
      fase = sala.fase;
      fimEm = sala.fimEm ?? fimEm;
      callback({ tipo: 'fase', fase, fimEm: sala.fimEm ?? null });
    } else if (sala.fimEm != null && (fimEm == null || Math.abs(sala.fimEm - fimEm) > SALTO_CRONOMETRO_MS)) {
      fimEm = sala.fimEm;
      callback({ tipo: 'tempo', fimEm });
    }
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
  };
}

// Roda DENTRO da página: liga um MutationObserver na sala e empurra uma foto nova
// para o Node (pela função exposta "nome") a cada mudança do DOM. Várias mutações
// no mesmo ciclo viram uma foto só (microtask): a reação fica em milissegundos
// sem inundar o worker.
function instalarObservador({ nome, sel, raiz }, ler) {
  const chave = `${nome}__obs`;
  window[chave]?.disconnect();
  let agendado = false;
  const enviar = () => {
    agendado = false;
    try { window[nome]?.(ler(sel)); } catch { /* a página está trocando de tela */ }
  };
  const obs = new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    queueMicrotask(enviar);
  });
  obs.observe(document.querySelector(raiz) || document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'value'],
  });
  window[chave] = obs;
  enviar();
}

// Plano B quando um seletor configurado sumiu (o portal mudou o layout): procura
// pelo papel e pelo texto do elemento, como uma pessoa faria. Só vale se achar
// exatamente UM elemento visível.
const HEURISTICAS = {
  'lance.campo': (p) => p.getByRole('textbox', { name: /lance|valor|oferta/i }),
  'lance.enviar': (p) => p.getByRole('button', { name: /enviar lance|dar lance|registrar lance|ofertar|enviar oferta/i }),
  'lance.confirmar': (p) => p.getByRole('button', { name: /^\s*(confirmar|sim|ok)\s*$/i }),
};

export class AdaptadorPorSeletores extends PortalAdapter {
  /**
   * @param {object} deps
   * @param {string} deps.portal
   * @param {object} deps.seletores           ver seletores.js
   * @param {object} deps.credencial          { tipo:'senha', login, senha } | { tipo:'certificado', pfx (base64), senhaCertificado, login? }
   * @param {() => Promise<object>} deps.carregarPlaywright   import('playwright') (carregado só quando precisa)
   * @param {boolean} [deps.permitirNaoValidado]  usar seletores ainda não conferidos (só para mapear; nunca envia lance)
   */
  constructor({ portal, seletores, credencial, carregarPlaywright, permitirNaoValidado = false, headless = true, executavel = null, intervaloSegurancaMs = 5000, log }) {
    super({ portal, credencial, log });
    Object.assign(this, { sel: seletores, carregarPlaywright, permitirNaoValidado, headless, executavel, intervaloSegurancaMs });
    this.navegador = null;
    this.pagina = null;
    this.curados = new Map(); // "grupo.campo" -> seletor que funcionou por último
    this.aoCurar = null; // (campo, de, para): avisa o operador
  }

  /**
   * Acha um elemento com autocorreção: tenta o seletor que funcionou por último, o
   * configurado, as alternativas do mapa (seletores.js: grupo.alternativas.campo) e,
   * por fim, a heurística por papel/texto. Guarda o que funcionou para a próxima vez.
   */
  async localizar(grupo, campo, { timeoutMs = 2500 } = {}) {
    const p = this.pagina;
    const id = `${grupo}.${campo}`;
    const configurado = this.sel[grupo]?.[campo] || null;
    const candidatos = [...new Set([this.curados.get(id), configurado, ...(this.sel[grupo]?.alternativas?.[campo] || [])]
      .filter((c) => c && !String(c).startsWith('heurística')))];
    const unico = async (loc) => (await loc.count().catch(() => 0)) === 1 && loc.isVisible().catch(() => false);
    for (const [i, c] of candidatos.entries()) {
      const loc = p.locator(c);
      // O primeiro candidato ganha uma espera curta (a tela pode estar desenhando).
      if (i === 0) await loc.first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
      if (await unico(loc)) { this.lembrar(id, configurado, c); return loc; }
    }
    const h = HEURISTICAS[id];
    if (h) {
      const loc = h(p);
      if (await unico(loc)) { this.lembrar(id, configurado, `heurística (${id})`); return loc; }
    }
    throw new ErroAdaptador(`O portal ${this.portal} mudou a tela: não achei "${id}" (nem pelas alternativas).`, 'seletor_quebrado', id);
  }

  lembrar(id, configurado, usado) {
    const antes = this.curados.get(id);
    this.curados.set(id, usado);
    if (usado !== configurado && usado !== antes) {
      this.log.aviso?.(`[${this.portal}] ${id}: o seletor configurado falhou; usando ${usado}.`);
      this.aoCurar?.(id, configurado, usado);
    }
  }

  /** A sala continua de pé? (página aberta e o marcador "sala pronta" presente). */
  async saudavel() {
    if (!this.pagina || this.pagina.isClosed()) return false;
    const pronta = this.sel.sala?.pronta;
    if (!pronta) return true;
    return (await this.pagina.locator(pronta).count().catch(() => 0)) > 0;
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

  dadosDaSala() {
    const s = this.sel.sala;
    return {
      linhaLance: s.linhaLance, lanceValor: s.lanceValor, lanceAutor: s.lanceAutor, lancePorte: s.lancePorte, lanceHora: s.lanceHora, lanceNosso: s.lanceNosso,
      fase: s.fase, tempo: s.tempo, linhaMensagem: s.linhaMensagem, mensagemAutor: s.mensagemAutor, mensagemTexto: s.mensagemTexto, mensagemHora: s.mensagemHora,
    };
  }

  interpretar(bruto) {
    const restante = lerCronometro(bruto.tempoTexto);
    return {
      fase: lerFase(bruto.faseTexto, this.sel.sala.fases),
      fimEm: restante == null ? null : Date.now() + restante,
      lances: bruto.lances.map((l) => ({ valor: lerReais(l.valorTexto), autor: l.nosso ? 'nos' : (l.autor || 'Concorrente'), porte: lerPorte(l.porteTexto), nosso: l.nosso, hora: l.hora }))
        .filter((l) => l.valor != null),
      mensagens: bruto.mensagens.filter((m) => m.texto),
    };
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
    return this.interpretar(await this.pagina.evaluate(lerSalaNaPagina, this.dadosDaSala()));
  }

  /**
   * Acompanha a sala em tempo real:
   *  - um MutationObserver dentro da página empurra cada mudança do DOM (milissegundos);
   *  - uma leitura de segurança a cada intervaloSegurancaMs cobre o que o observador
   *    perder (tela redesenhada inteira, navegação) e confere se a sala segue de pé;
   *  - página fechada ou travada, navegador caído ou sala sumida viram { tipo: 'queda' },
   *    que a sessão usa para reconectar.
   */
  watchBids(callback) {
    const p = this.pagina;
    const novidade = criarDiferenciador(callback);
    const nome = `__lhSala_${Math.random().toString(36).slice(2, 10)}`;
    let parado = false;
    let caiu = false;
    let falhasSeguidas = 0;
    const queda = (motivo) => { if (parado || caiu) return; caiu = true; callback({ tipo: 'queda', motivo }); };
    const script = () => `(${instalarObservador})(${JSON.stringify({ nome, sel: this.dadosDaSala(), raiz: this.sel.sala.raiz || 'body' })}, ${lerSalaNaPagina})`;
    const instalar = () => p.evaluate(script()).catch(() => {});
    const aoCarregar = () => { if (!parado) instalar(); };
    const aoFechar = () => queda('A página do portal foi fechada.');
    const aoTravar = () => queda('A página do portal travou.');
    const aoDesconectar = () => queda('O navegador caiu.');
    p.on('domcontentloaded', aoCarregar);
    p.on('close', aoFechar);
    p.on('crash', aoTravar);
    this.navegador?.on?.('disconnected', aoDesconectar);
    p.exposeBinding(nome, (_origem, bruto) => {
      if (parado) return;
      try { novidade(this.interpretar(bruto)); } catch (e) { callback({ tipo: 'erro', texto: e.message }); }
    }).then(instalar).catch((e) => callback({ tipo: 'erro', texto: `Observador da sala: ${e.message}` }));

    let timer = null;
    const seguranca = async () => {
      if (parado) return;
      try {
        if (!(await this.saudavel())) {
          falhasSeguidas += 1;
          if (falhasSeguidas >= 2) { queda('A sala de disputa sumiu da tela (sessão expirada ou portal fora do ar).'); return; }
        } else {
          novidade(await this.lerSala());
          falhasSeguidas = 0;
        }
      } catch (e) {
        falhasSeguidas += 1;
        if (falhasSeguidas >= 3) { queda(`A leitura da sala falhou ${falhasSeguidas} vezes: ${e.message}`); return; }
        callback({ tipo: 'erro', texto: e.message });
      }
      if (!parado) timer = setTimeout(seguranca, this.intervaloSegurancaMs);
    };
    timer = setTimeout(seguranca, this.intervaloSegurancaMs);

    return () => {
      parado = true;
      clearTimeout(timer);
      p.off?.('domcontentloaded', aoCarregar);
      p.off?.('close', aoFechar);
      p.off?.('crash', aoTravar);
      this.navegador?.off?.('disconnected', aoDesconectar);
      if (!p.isClosed?.()) p.evaluate((k) => { window[k]?.disconnect(); }, `${nome}__obs`).catch(() => {});
    };
  }

  async placeBid(valor) {
    if (!this.sel.validado) throw new ErroAdaptador(`Lance bloqueado: os seletores do ${this.portal} ainda não foram conferidos.`, 'seletores_pendentes');
    this.exigir(['lance']);
    const l = this.sel.lance;
    const p = this.pagina;
    const campo = await this.localizar('lance', 'campo');
    const texto = reaisParaCampo(valor);
    await campo.fill(texto);
    // Confere o que ficou no campo: máscaras de moeda às vezes mexem no valor digitado.
    const ficou = lerReais(await campo.inputValue().catch(() => ''));
    if (ficou == null || Math.round(ficou * 100) !== Math.round(Number(valor) * 100)) {
      await campo.fill('').catch(() => {});
      throw new ErroAdaptador(`O campo de lance ficou com ${ficou ?? 'nada'} em vez de ${texto}: lance não enviado.`, 'lance');
    }
    const enviar = await this.localizar('lance', 'enviar');
    // Botão achado pela heurística: só envia se der para saber se o portal aceitou.
    if (String(this.curados.get('lance.enviar')).startsWith('heurística') && !l.sucesso && !l.erro) {
      throw new ErroAdaptador('O botão de lance mudou e não há como confirmar o envio: lance não enviado.', 'seletor_quebrado');
    }
    await enviar.click();
    if (l.confirmar) await this.localizar('lance', 'confirmar', { timeoutMs: 1500 }).then((b) => b.click()).catch(() => {});
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
