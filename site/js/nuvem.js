/* =============================================================================
   Uso LicitaHub · nuvem.js
   Ligação com o back-end: login (Supabase Auth), contexto do usuário
   (perfil, organização, empresas, etapas do CRM, assinatura) e chamadas à API
   do servidor com o token de login.

   Aberto pelo servidor (http://localhost:8787) -> LH.nuvem.ativa = true.
   Aberto direto do arquivo (file://)           -> modo demonstração.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const VERSAO_TERMOS = '2026-11';
  const CHAVE_EMPRESA = 'licitahub:empresa-atual';

  const carregarScript = (src) => new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => falha(new Error(`não carregou ${src}`));
    document.head.append(s);
  });

  /** Mensagens do Supabase Auth em português. */
  function traduzir(erro) {
    const codigo = erro?.code || '';
    const msg = String(erro?.message || '');
    const mapa = [
      [/invalid_credentials|Invalid login credentials/i, 'E-mail ou senha incorretos.'],
      [/email_not_confirmed|Email not confirmed/i, 'Confirme o seu e-mail pelo link que enviamos antes de entrar.'],
      [/user_already_exists|already registered/i, 'Este e-mail já tem conta. Entre ou recupere a senha.'],
      [/weak_password|Password should be/i, 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.'],
      [/rate_limit|rate limit/i, 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'],
      [/Failed to fetch|NetworkError|fetch/i, 'Sem conexão com o servidor. Confira a internet.'],
    ];
    const achado = mapa.find(([re]) => re.test(codigo) || re.test(msg));
    return new Error(achado ? achado[1] : (msg || 'Não foi possível concluir. Tente de novo.'));
  }

  /** Endereço público do site (SITE_URL do servidor). Só cai no endereço atual se o servidor não informar. */
  const enderecoSite = () => (window.LH_CONFIG?.siteUrl || location.origin).replace(/\/+$/, '');
  /** Para onde os links dos e-mails do Supabase (confirmação e nova senha) levam. */
  const linkRetorno = () => `${enderecoSite()}/app.html`;

  const N = {
    ativa: false,
    cliente: null,
    usuario: null,
    /** { perfil, organizacao, papel, empresas, etapas, assinatura, empresaAtual } */
    ctx: null,
    traduzir,

    /** Liga ao back-end se o site foi aberto pelo servidor. Devolve true se ligou. */
    async iniciar() {
      if (!/^https?:$/.test(location.protocol)) return false;
      try {
        await carregarScript('/config.js');
        if (!window.LH_CONFIG?.supabaseUrl || !window.LH_CONFIG?.supabaseChave) return false;
        await carregarScript('/vendor/supabase.js');
      } catch {
        return false;
      }
      N.cliente = window.supabase.createClient(window.LH_CONFIG.supabaseUrl, window.LH_CONFIG.supabaseChave, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      N.ativa = true;
      const { data } = await N.cliente.auth.getSession();
      N.usuario = data.session?.user ?? null;
      if (N.usuario) await N.carregarContexto();

      N.cliente.auth.onAuthStateChange((evento, sessao) => {
        if (evento === 'SIGNED_OUT') {
          N.usuario = null;
          N.ctx = null;
          LH.acesso?.mostrar();
        }
        if (evento === 'PASSWORD_RECOVERY') {
          N.usuario = sessao?.user ?? N.usuario;
          setTimeout(() => LH.acesso?.novaSenha(), 0);
        }
        if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') N.usuario = sessao?.user ?? N.usuario;
      });
      return true;
    },

    async token() {
      const { data } = await N.cliente.auth.getSession();
      return data.session?.access_token ?? null;
    },

    /** Lê perfil, organização, papel, empresas, etapas e assinatura de quem está logado. */
    async carregarContexto() {
      const db = N.cliente;
      const uid = N.usuario.id;
      const { data: perfil, error } = await db.from('perfis').select('id, nome, telefone, organizacao_padrao_id').eq('id', uid).single();
      if (error) throw new Error(`Não consegui ler o seu perfil: ${error.message}`);
      let orgId = perfil.organizacao_padrao_id;
      if (!orgId) {
        const { data: m } = await db.from('membros').select('organizacao_id').eq('user_id', uid).limit(1);
        orgId = m?.[0]?.organizacao_id ?? null;
      }
      if (!orgId) throw new Error('A sua conta não tem organização. Fale com o suporte.');

      const [org, membro, empresas, etapas, assinatura] = await Promise.all([
        db.from('organizacoes').select('id, nome, cnpj, plano, limite_empresas, limite_analises_ia_mes').eq('id', orgId).single(),
        db.from('membros').select('papel').eq('organizacao_id', orgId).eq('user_id', uid).maybeSingle(),
        db.from('empresas').select('*').eq('organizacao_id', orgId).eq('ativo', true).order('criado_em'),
        db.from('kanban_etapas').select('id, nome, cor, posicao, tipo').eq('organizacao_id', orgId).order('posicao'),
        db.from('assinaturas').select('status, plano, ciclo, periodo_fim, teste_fim, cancelar_no_fim, stripe_cliente_id').eq('organizacao_id', orgId).maybeSingle(),
      ]);
      for (const r of [org, empresas, etapas]) if (r.error) throw new Error(`Não consegui ler os dados da organização: ${r.error.message}`);

      let empresaAtual = null;
      try { empresaAtual = localStorage.getItem(CHAVE_EMPRESA); } catch { /* sem armazenamento */ }
      const lista = empresas.data ?? [];
      if (!lista.some((e) => e.id === empresaAtual)) empresaAtual = lista[0]?.id ?? null;

      N.ctx = {
        perfil, organizacao: org.data, papel: membro.data?.papel ?? 'membro',
        empresas: lista, etapas: etapas.data ?? [], assinatura: assinatura.data ?? null, empresaAtual,
      };
      return N.ctx;
    },

    escolherEmpresa(id) {
      N.ctx.empresaAtual = id;
      try { localStorage.setItem(CHAVE_EMPRESA, id); } catch { /* fica só nesta visita */ }
    },

    podeGerenciar: () => ['dono', 'admin'].includes(N.ctx?.papel),

    async entrar(email, senha) {
      const { data, error } = await N.cliente.auth.signInWithPassword({ email, password: senha });
      if (error) throw traduzir(error);
      N.usuario = data.user;
      await N.carregarContexto();
    },

    /** Cria a conta. Devolve { confirmar: true } quando o Supabase pede confirmação por e-mail. */
    async cadastrar({ nome, empresa, email, senha, marketing }) {
      const { data, error } = await N.cliente.auth.signUp({
        email,
        password: senha,
        options: {
          emailRedirectTo: linkRetorno(),
          data: { nome, empresa, versao_termos: VERSAO_TERMOS, versao_privacidade: VERSAO_TERMOS, aceita_marketing: Boolean(marketing) },
        },
      });
      if (error) throw traduzir(error);
      // Com confirmação ligada, e-mail já cadastrado volta sem erro e sem identidades.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Este e-mail já tem conta. Entre ou recupere a senha.');
      }
      if (!data.session) return { confirmar: true };
      N.usuario = data.user;
      await N.carregarContexto();
      return { confirmar: false };
    },

    async recuperarSenha(email) {
      const { error } = await N.cliente.auth.resetPasswordForEmail(email, { redirectTo: linkRetorno() });
      if (error) throw traduzir(error);
    },

    async trocarSenha(nova) {
      const { error } = await N.cliente.auth.updateUser({ password: nova });
      if (error) throw traduzir(error);
    },

    async sair() {
      await N.cliente.auth.signOut();
    },

    /** Chama a API do servidor (mesmo endereço do site) com o token de login. */
    async api(caminho, { metodo = 'GET', corpo } = {}) {
      let resposta;
      try {
        resposta = await fetch(caminho, {
          method: metodo,
          headers: { authorization: `Bearer ${await N.token()}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
          body: corpo ? JSON.stringify(corpo) : undefined,
        });
      } catch {
        throw new Error('Sem conexão com o servidor do Uso LicitaHub.');
      }
      const json = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw Object.assign(new Error(json.erro || `O servidor respondeu ${resposta.status}.`), { status: resposta.status, codigo: json.codigo });
      return json;
    },
  };

  LH.nuvem = N;
})();
