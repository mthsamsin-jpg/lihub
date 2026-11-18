/* =============================================================================
   Uso LicitaHub · acesso.js
   Telas de Entrar, Criar conta e Recuperar senha (Supabase Auth).
   Só aparecem quando o site está ligado ao servidor (LH.nuvem.ativa).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone } = LH;
  let caixa = null;

  const LOGO = `<span class="logo"><span class="logo__marca" aria-hidden="true"><svg class="logo__hex" viewBox="0 0 48 48" width="38" height="38" fill="none" stroke-linejoin="round" aria-hidden="true"><g class="logo__ciano" stroke="#22d3ee"><polygon points="24,3 42.19,13.5 42.19,34.5 24,45 5.81,34.5 5.81,13.5" stroke-width="2.2"/><polygon points="24,6.5 39.16,15.25 39.16,32.75 24,41.5 8.84,32.75 8.84,15.25" stroke-width="1.4" opacity=".75"/></g><g class="logo__roxo" stroke="#c084fc"><polygon points="24,11.5 34.83,17.75 34.83,30.25 24,36.5 13.17,30.25 13.17,17.75" stroke-width="2"/><polygon points="24,14.5 32.23,19.25 32.23,28.75 24,33.5 15.77,28.75 15.77,19.25" stroke-width="1.3" opacity=".75"/></g><circle class="logo__nucleo" cx="24" cy="24" r="3.6" fill="#fff"/></svg></span><span class="logo__nome">Uso Licita<b>Hub</b></span></span>`;

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
        <label class="campo"><span class="campo__rotulo">WhatsApp (com DDD)</span><input type="tel" name="telefone" autocomplete="tel-national" inputmode="numeric" required maxlength="15" placeholder="(00) 00000-0000" data-telefone></label>
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
    // Mensagem clara também com o campo vazio (a do navegador é genérica).
    const tel = caixa.querySelector('[data-telefone]');
    if (tel) conferirTelefone(tel);
    caixa.querySelector('input')?.focus();
  }

  // --- Telefone (WhatsApp) obrigatório: máscara (00) 00000-0000 e a mesma regra do
  // banco (public.telefone_br): DDD 11-99; celular 9 dígitos começando com 9; fixo 8
  // dígitos começando com 2 a 5. O banco confere de novo e recusa o cadastro inválido.
  const MSG_TELEFONE = 'Informe o seu WhatsApp com DDD, ex.: (11) 98765-4321.';
  const mascaraTelefone = (v) => {
    const d = String(v || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    const resto = d.slice(2);
    const corte = d.length === 11 ? 5 : 4;
    return resto.length > corte ? `(${d.slice(0, 2)}) ${resto.slice(0, corte)}-${resto.slice(corte)}` : `(${d.slice(0, 2)}) ${resto}`;
  };
  const telefoneValido = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    if (!/^\d{10,11}$/.test(d) || Number(d.slice(0, 2)) < 11) return false;
    const n = d.slice(2);
    return n.length === 9 ? n[0] === '9' : /^[2-5]/.test(n);
  };
  const conferirTelefone = (campo) => campo.setCustomValidity(telefoneValido(campo.value) ? '' : MSG_TELEFONE);

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
        if (!telefoneValido(d.telefone)) throw new Error(MSG_TELEFONE);
        if (!/[A-Za-z]/.test(d.senha) || !/\d/.test(d.senha)) throw new Error('Use letras e números na senha.');
        const r = await LH.nuvem.cadastrar({ nome: d.nome.trim(), empresa: d.empresa.trim(), email: d.email.trim(), telefone: mascaraTelefone(d.telefone), senha: d.senha, marketing: d.marketing === 'on' });
        if (r.confirmar) {
          desenhar('entrar', recadoHtml('ok', `Conta criada! Enviamos um link de confirmação para ${d.email.trim()}. Abra o e-mail, confirme e depois entre aqui.`));
          return;
        }
        LH.acesso.esconder();
        LH.aviso('Conta criada. Bem-vindo ao Uso LicitaHub!', 'sucesso');
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
        // Máscara enquanto digita; a mensagem de validação aparece ao tentar enviar.
        caixa.addEventListener('input', (e) => {
          const campo = e.target.closest?.('[data-telefone]');
          if (!campo) return;
          const fim = campo.selectionStart === campo.value.length;
          campo.value = mascaraTelefone(campo.value);
          if (fim) campo.setSelectionRange(campo.value.length, campo.value.length);
          conferirTelefone(campo);
        });
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
