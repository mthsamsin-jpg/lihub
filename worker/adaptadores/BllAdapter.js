// Adaptador da BLL Compras (primeiro portal do modo real).
// Usa o adaptador genérico de Playwright com o mapa de seletores da BLL
// (worker/adaptadores/seletores.js -> SELETORES.bll). Falta conferir os seletores
// da SALA numa sessão real e marcar validado: true.
//
// Login (conferido na página pública em 18/11/2026): e-mail em #Email e a senha
// digitada num TECLADO VIRTUAL. Cada botão mostra dois dígitos ("1 ou 5") e a
// ordem muda a cada carga; o campo de senha de verdade (#Password) é escondido.
// Por isso a senha não é "preenchida": o robô clica, dígito a dígito, no botão
// que contém aquele dígito.
import { ErroAdaptador } from './base.js';
import { AdaptadorPorSeletores } from './playwright.js';
import { SELETORES } from './seletores.js';

// Verificação humana (reCAPTCHA, hCaptcha, Turnstile): o robô para e avisa.
export const SELETOR_CAPTCHA = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile';
// Textos de cadastro ainda não aprovado (aparecem no erro do login ou numa página depois dele).
export const CADASTRO_PENDENTE = /cadastro.{0,60}(em an[aá]lise|aguardando|pendente|n[aã]o (foi )?(aprovad|validad|homologad|ativad))|aguardando (a )?(aprova|valida|homologa|ativa)|conta.{0,30}(n[aã]o (est[aá] )?ativ|pendente de ativa)/i;

/** Para cada dígito da senha, o botão do teclado (pelo texto "a ou b") que o contém. */
export function teclasDaSenha(senha, botoes) {
  const digitos = String(senha ?? '');
  if (!/^\d+$/.test(digitos)) {
    throw new ErroAdaptador('A senha da BLL é numérica (teclado virtual). Confira a senha salva no cofre.', 'login');
  }
  return [...digitos].map((d) => {
    const i = botoes.findIndex((b) => String(b).split(/\D+/).includes(d));
    if (i < 0) throw new ErroAdaptador(`O teclado virtual da BLL não mostrou o dígito ${d}. A tela de login pode ter mudado.`, 'seletor_quebrado');
    return i;
  });
}

export class BllAdapter extends AdaptadorPorSeletores {
  constructor(deps) {
    super({ ...deps, portal: 'bll', seletores: deps.seletores || SELETORES.bll });
  }

  async login() {
    if (this.credencial?.tipo === 'certificado') return super.login();
    // O login da BLL usa o teclado virtual: confere só os campos que ele usa.
    this.exigir([], 'login');
    const l = this.sel.login;
    const faltam = ['url', 'usuario', 'tecladoVirtual', 'entrar'].filter((k) => !l[k]);
    if (faltam.length) throw new ErroAdaptador(`Login da BLL incompleto no mapa (faltam: ${faltam.join(', ')}).`, 'seletores_pendentes', faltam);
    const p = this.pagina;
    await p.goto(l.url);
    await this.pararSeCaptcha();
    await p.fill(l.usuario, String(this.credencial.login ?? ''));
    const teclado = p.locator(l.tecladoVirtual);
    await teclado.first().waitFor({ state: 'visible' });
    const rotulos = await teclado.evaluateAll((els) => els.map((e) => e.value || e.name || e.textContent || ''));
    for (const i of teclasDaSenha(this.credencial.senha, rotulos)) await teclado.nth(i).click();
    await p.locator(l.entrar).first().click();
    // Sem o seletor "logado" mapeado, o sinal de sucesso é SAIR da página de login.
    const saiuDoLogin = (u) => !/\/Home\/Login/i.test(String(u));
    const r = await Promise.race([
      l.logado ? p.waitForSelector(l.logado).then(() => 'ok') : new Promise(() => {}),
      p.waitForURL(saiuDoLogin, { timeout: 30_000 }).then(() => 'ok'),
      l.erro ? p.waitForSelector(l.erro, { state: 'visible' }).then(() => 'erro') : new Promise(() => {}),
      p.waitForSelector(SELETOR_CAPTCHA, { state: 'attached' }).then(() => 'captcha'),
    ]).catch(() => 'tempo');
    if (r === 'captcha') await this.pararSeCaptcha();
    if (r === 'ok') {
      // Algumas contas entram, mas caem numa página dizendo que o cadastro está em análise.
      const corpo = (await p.locator('body').innerText().catch(() => '')).slice(0, 4000);
      if (CADASTRO_PENDENTE.test(corpo)) throw new ErroAdaptador('A BLL informou que o cadastro ainda está em análise.', 'conta_pendente');
      return;
    }
    const texto = r === 'erro' ? (await p.textContent(l.erro).catch(() => '') || '').replace(/\s+/g, ' ').trim() : '';
    if (texto && CADASTRO_PENDENTE.test(texto)) throw new ErroAdaptador(`A BLL informou: ${texto}`, 'conta_pendente');
    throw new ErroAdaptador(texto ? `O portal recusou o login: ${texto}` : 'Não consegui confirmar o login na BLL (a página não respondeu como esperado).', texto ? 'login' : 'login_sem_resposta');
  }

  /** Verificação humana na tela: o robô PARA (nunca tenta contornar). */
  async pararSeCaptcha() {
    const n = await this.pagina.locator(SELETOR_CAPTCHA).count().catch(() => 0);
    if (n) throw new ErroAdaptador('A BLL pediu uma verificação humana (captcha). O robô não contorna essa proteção.', 'captcha');
  }

  // Na BLL o lote costuma ser escolhido dentro da sala do processo: depois de
  // entrar, seleciona o lote (se o seletor estiver mapeado).
  async joinAuctionRoom({ pregao, lote }) {
    await super.joinAuctionRoom({ pregao, lote });
    const seletorLote = this.sel.sala.lote;
    if (lote && seletorLote) await this.pagina.click(typeof seletorLote === 'function' ? seletorLote(lote) : seletorLote);
  }
}
