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
    this.exigir(['login']);
    const l = this.sel.login;
    const p = this.pagina;
    await p.goto(l.url);
    await p.fill(l.usuario, String(this.credencial.login ?? ''));
    const teclado = p.locator(l.tecladoVirtual);
    await teclado.first().waitFor({ state: 'visible' });
    const rotulos = await teclado.evaluateAll((els) => els.map((e) => e.value || e.name || e.textContent || ''));
    for (const i of teclasDaSenha(this.credencial.senha, rotulos)) await teclado.nth(i).click();
    await p.locator(l.entrar).first().click();
    const r = await Promise.race([
      p.waitForSelector(l.logado).then(() => 'ok'),
      p.waitForSelector(l.erro).then(() => 'erro'),
    ]).catch(() => 'tempo');
    if (r === 'ok') return;
    const texto = r === 'erro' ? (await p.textContent(l.erro).catch(() => '')).trim() : '';
    throw new ErroAdaptador(texto ? `O portal recusou o login: ${texto}` : 'Não consegui confirmar o login na BLL.', 'login');
  }

  // Na BLL o lote costuma ser escolhido dentro da sala do processo: depois de
  // entrar, seleciona o lote (se o seletor estiver mapeado).
  async joinAuctionRoom({ pregao, lote }) {
    await super.joinAuctionRoom({ pregao, lote });
    const seletorLote = this.sel.sala.lote;
    if (lote && seletorLote) await this.pagina.click(typeof seletorLote === 'function' ? seletorLote(lote) : seletorLote);
  }
}
