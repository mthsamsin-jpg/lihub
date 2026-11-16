/* =============================================================================
   LicitaHub · acesso.js
   Telas de Entrar, Criar conta e Recuperar senha (Supabase Auth).
   Só aparecem quando o site está ligado ao servidor (LH.nuvem.ativa).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone } = LH;
  let caixa = null;

  const LOGO = `<span class="logo"><span class="logo__marca" aria-hidden="true"><svg viewBox="0 0 32 32" width="34" height="34"><defs><linearGradient id="logo-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#0284c7"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#logo-a)"/><path d="M9 22V10h3v9h6v3z" fill="#040b16"/><circle cx="22" cy="11" r="3" fill="#040b16"/></svg></span><span class="logo__nome">Licita<b>Hub</b></span></span>`;

  const formularios = {
    entrar: () => `
      <form class="form" data-form="entrar">
        <label class="campo"><span class="campo__rotulo">E-mail</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="campo"><span class="campo__rotulo">Senha</span><input type="password" name="senha" autocomplete="current-password" required></label>
        <button class="btn btn--primario btn--grande" type="submit">Entrar</button>
        <button class="btn btn--fantasma btn--pequeno" type="button" data-ir="recuperar" style="justify-self:center">Esqueci a senha</button>
      </form>`,
    cadastrar: () => `
      <form class="form" data-form="cadastrar">
        <div class="form__linha">
          <label class="campo"><span class="campo__rotulo">Seu nome</span><input name="nome" autocomplete="name" required maxlength="120"></label>
          <label class="campo"><span class="campo__rotulo">Nome da sua empresa</span><input name="empresa" autocomplete="organization" required maxlength="160"></label>
        </div>
        <label class="campo"><span class="campo__rotulo">E-mail</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="campo"><span class="campo__rotulo">Senha (mínimo 8 caracteres)</span><input type="password" name="senha" autocomplete="new-password" required minlength="8"></label>
        <label class="marcar"><input type="checkbox" name="termos" required> <span>Li e aceito os <a href="#" data-legal="termos">Termos de uso</a> e a <a href="#" data-legal="privacidade">Política de privacidade</a>.</span></label>
        <label class="marcar"><input type="checkbox" name="marketing"> <span>Quero receber novidades e dicas por e-mail (opcional).</span></label>
        <button class="btn btn--primario btn--grande" type="submit">Criar conta grátis</button>
        <p class="fraco" style="text-align:center">Você começa no plano gratuito e assina o Completo (R$ 97/mês, 30 dias grátis) quando quiser.</p>
      </form>`,
    recuperar: () => `
      <form class="form" data-form="recuperar">
        <p class="suave">Digite o seu e-mail. Enviamos um link para você criar uma senha nova.</p>
        <label class="campo"><span class="campo__rotulo">E-mail</span><input type="email" name="email" autocomplete="email" required></label>
        <button class="btn btn--primario btn--grande" type="submit">Enviar link</button>
        <button class="btn btn--fantasma btn--pequeno" type="button" data-ir="entrar" style="justify-self:center">Voltar para entrar</button>
      </form>`,
  };

  function desenhar(aba = 'entrar', recado = '') {
    caixa.innerHTML = `
      <div class="acesso__cartao card--vidro" role="dialog" aria-modal="true" aria-labelledby="acesso-titulo">
        <div class="acesso__topo">${LOGO}</div>
        <h1 id="acesso-titulo" class="acesso__titulo">${aba === 'cadastrar' ? 'Crie a sua conta' : aba === 'recuperar' ? 'Recuperar senha' : 'Entre na sua conta'}</h1>
        <p class="acesso__sub">Gestão e inteligência em licitações públicas.</p>
        ${aba !== 'recuperar' ? `
        <div class="alternador acesso__abas" role="tablist">
          <button type="button" role="tab" data-ir="entrar" class="${aba === 'entrar' ? 'ativo' : ''}" aria-selected="${aba === 'entrar'}">Entrar</button>
          <button type="button" role="tab" data-ir="cadastrar" class="${aba === 'cadastrar' ? 'ativo' : ''}" aria-selected="${aba === 'cadastrar'}">Criar conta</button>
        </div>` : ''}
        <div class="acesso__recado" aria-live="polite">${recado}</div>
        ${formularios[aba]()}
      </div>`;
    caixa.querySelector('input')?.focus();
  }

  const recadoHtml = (tipo, texto) => `<p class="nota ${tipo === 'erro' ? 'nota--alerta' : ''}">${icone(tipo === 'erro' ? 'alerta' : 'checkCirculo')} ${esc(texto)}</p>`;

  async function enviar(form) {
    const d = Object.fromEntries(new FormData(form));
    const botao = form.querySelector('[type=submit]');
    const recado = caixa.querySelector('.acesso__recado');
    botao.disabled = true;
    recado.innerHTML = '';
    try {
      if (form.dataset.form === 'entrar') {
        await LH.nuvem.entrar(d.email.trim(), d.senha);
        LH.acesso.esconder();
        return;
      }
      if (form.dataset.form === 'cadastrar') {
        if (!/[A-Za-z]/.test(d.senha) || !/\d/.test(d.senha)) throw new Error('Use letras e números na senha.');
        const r = await LH.nuvem.cadastrar({ nome: d.nome.trim(), empresa: d.empresa.trim(), email: d.email.trim(), senha: d.senha, marketing: d.marketing === 'on' });
        if (r.confirmar) {
          desenhar('entrar', recadoHtml('ok', `Conta criada! Enviamos um link de confirmação para ${d.email.trim()}. Abra o e-mail, confirme e depois entre aqui.`));
          return;
        }
        LH.acesso.esconder();
        LH.aviso('Conta criada. Bem-vindo ao LicitaHub!', 'sucesso');
        return;
      }
      if (form.dataset.form === 'recuperar') {
        await LH.nuvem.recuperarSenha(d.email.trim());
        desenhar('entrar', recadoHtml('ok', 'Se este e-mail tiver conta, chega um link para criar a senha nova em alguns minutos.'));
      }
    } catch (e) {
      recado.innerHTML = recadoHtml('erro', e.message);
      botao.disabled = false;
    }
  }

  LH.acesso = {
    /** aba: 'entrar' ou 'cadastrar' (a página de apresentação manda ?acesso=cadastrar). */
    mostrar(recado = '', aba = 'entrar') {
      document.body.classList.add('sem-login');
      if (!caixa) {
        caixa = document.createElement('div');
        caixa.className = 'acesso';
        document.body.append(caixa);
        caixa.addEventListener('click', (e) => {
          const ir = e.target.closest('[data-ir]');
          if (ir) desenhar(ir.dataset.ir);
        });
        caixa.addEventListener('submit', (e) => { e.preventDefault(); enviar(e.target); });
      }
      caixa.hidden = false;
      desenhar(['entrar', 'cadastrar', 'recuperar'].includes(aba) ? aba : 'entrar', recado ? recadoHtml('ok', recado) : '');
    },
    esconder() {
      if (caixa) caixa.hidden = true;
      document.body.classList.remove('sem-login');
      LH.iniciarApp?.();
    },
    /** Depois do link de "esqueci a senha": pede a senha nova. */
    novaSenha() {
      LH.modal({
        titulo: 'Crie a sua senha nova',
        html: '<label class="campo"><span class="campo__rotulo">Senha nova (mínimo 8 caracteres, com letras e números)</span><input type="password" id="senha-nova" minlength="8" autocomplete="new-password"></label>',
        acoes: [
          { rotulo: 'Salvar senha', classe: 'btn--primario', acao: async (fechar, janela) => {
            const senha = janela.querySelector('#senha-nova').value;
            if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return LH.aviso('Use pelo menos 8 caracteres, com letras e números.', 'alerta');
            try {
              await LH.nuvem.trocarSenha(senha);
              fechar();
              LH.aviso('Senha nova salva.', 'sucesso');
            } catch (e) { LH.aviso(e.message, 'perigo'); }
          } },
        ],
      });
    },
  };
})();
