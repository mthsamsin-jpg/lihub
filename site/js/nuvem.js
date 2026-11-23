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

  const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

  const carregarUmaVez = (src) => new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => { s.remove(); falha(new Error(`não carregou ${src}`)); };
    document.head.append(s);
  });

  /** Carrega um script do servidor com novas tentativas (servidor acordando ou rede oscilando). */
  async function carregarScript(src, { tentativas = 4, aoTentar } = {}) {
    for (let i = 1; ; i++) {
      try {
        return await carregarUmaVez(i === 1 ? src : `${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`);
      } catch (e) {
        if (i >= tentativas) throw e;
        aoTentar?.(i + 1, tentativas);
        await esperar(1000 * 2 ** (i - 1)); // 1 s, 2 s, 4 s
      }
    }
  }

  // Leituras que podem ser repetidas sem risco (não gravam nada no banco).
  const RPC_LEITURA = /\/rest\/v1\/rpc\/(buscar_licitacoes|radar_contagem|mercado_[a-z_]+)(\?|$)/;
  const TRANSITORIO = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);
  /**
   * fetch do Supabase com novas tentativas SÓ em leituras (GET/HEAD e RPCs de consulta) e só
   * em falha passageira: rede, tempo esgotado ou servidor sobrecarregado. Gravações nunca
   * são repetidas (evita registro duplicado).
   */
  async function fetchResiliente(entrada, opcoes = {}) {
    const url = String(entrada?.url ?? entrada);
    const metodo = String(opcoes.method || entrada?.method || 'GET').toUpperCase();
    const leitura = !url.includes('/auth/v1/') && (metodo === 'GET' || metodo === 'HEAD' || (metodo === 'POST' && RPC_LEITURA.test(url)));
    const maximo = leitura ? 3 : 1;
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(entrada, opcoes);
        if (i < maximo && TRANSITORIO.has(r.status)) { await esperar(500 * 2 ** (i - 1) + Math.random() * 300); continue; }
        return r;
      } catch (e) {
        if (e?.name === 'AbortError' || i >= maximo) throw e;
        await esperar(500 * 2 ** (i - 1) + Math.random() * 300);
      }
    }
  }

  /** Falha de conexão com o servidor (não é "sem configuração"): o app mostra a tela de reconexão. */
  class ErroConexao extends Error {}

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
      // O banco recusa o cadastro sem WhatsApp válido; o Supabase devolve um erro genérico.
      [/telefone_invalido|Database error (saving|creating) new user/i, 'Confira o seu WhatsApp com DDD, ex.: (11) 98765-4321.'],
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
    ErroConexao,
    /** { perfil, organizacao, papel, empresas, etapas, assinatura, empresaAtual } */
    ctx: null,
    traduzir,

    /** Liga ao back-end se o site foi aberto pelo servidor. Devolve true se ligou. */
    async iniciar({ aoTentar } = {}) {
      if (!/^https?:$/.test(location.protocol)) return false;
      // Falha ao carregar = servidor acordando/sem rede: NÃO cai no modo demonstração
      // (isso escondia os editais reais). Só sem configuração é que vira demonstração.
      try {
        await carregarScript('/config.js', { aoTentar });
        if (!window.LH_CONFIG?.supabaseUrl || !window.LH_CONFIG?.supabaseChave) return false;
        await carregarScript('/vendor/supabase.js', { aoTentar });
      } catch {
        throw new ErroConexao('Não consegui falar com o servidor do Uso LicitaHub. Confira a internet e tente de novo.');
      }
      N.cliente = window.supabase.createClient(window.LH_CONFIG.supabaseUrl, window.LH_CONFIG.supabaseChave, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: fetchResiliente },
      });
      N.ativa = true;
      // Link dos e-mails (confirmação e senha nova): aponta para o próprio domínio do site
      // (/app.html?token_hash=...&type=...), e não para o supabase.co, o que ajuda a não cair
      // no spam. Aqui o site confirma o código e limpa o endereço.
      const pedidoLink = new URLSearchParams(location.search);
      const tokenHash = pedidoLink.get('token_hash');
      const tipoLink = pedidoLink.get('type');
      if (tokenHash && ['email', 'signup', 'recovery', 'email_change', 'invite', 'magiclink'].includes(tipoLink)) {
        const { error } = await N.cliente.auth.verifyOtp({ token_hash: tokenHash, type: tipoLink });
        history.replaceState(null, '', location.pathname + location.hash);
        if (error) N.erroLink = /expired|invalid/i.test(error.message) ? 'Este link já foi usado ou expirou. Peça um novo.' : `Não consegui confirmar o link: ${error.message}`;
        else if (tipoLink === 'recovery') setTimeout(() => LH.acesso?.novaSenha(), 0);
        else N.linkConfirmado = true;
      }
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
        db.from('organizacoes').select('id, nome, cnpj, plano, isento, plano_ate, ciclo_inicio, robo_de, robo_ate, limite_empresas, limite_analises_ia_mes').eq('id', orgId).single(),
        db.from('membros').select('papel').eq('organizacao_id', orgId).eq('user_id', uid).maybeSingle(),
        db.from('empresas').select('*').eq('organizacao_id', orgId).eq('ativo', true).order('criado_em'),
        db.from('kanban_etapas').select('id, nome, cor, posicao, tipo').eq('organizacao_id', orgId).order('posicao'),
        db.from('assinaturas').select('status, plano, ciclo, periodo_fim, cancelar_no_fim, forma, mp_assinatura_id, status_pagamento, falhas_pagamento, proxima_cobranca').eq('organizacao_id', orgId).maybeSingle(),
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
    async cadastrar({ nome, empresa, email, telefone, senha, marketing }) {
      const { data, error } = await N.cliente.auth.signUp({
        email,
        password: senha,
        options: {
          emailRedirectTo: linkRetorno(),
          data: { nome, empresa, telefone, versao_termos: VERSAO_TERMOS, versao_privacidade: VERSAO_TERMOS, aceita_marketing: Boolean(marketing) },
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
      LH.roboAoVivo?.encerrar();
      await N.cliente.auth.signOut();
    },

    /** Chama a API do servidor (mesmo endereço do site) com o token de login. */
    async api(caminho, { metodo = 'GET', corpo, limiteMs } = {}) {
      let resposta;
      try {
        resposta = await fetch(caminho, {
          method: metodo,
          headers: { authorization: `Bearer ${await N.token()}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
          body: corpo ? JSON.stringify(corpo) : undefined,
          signal: limiteMs ? AbortSignal.timeout(limiteMs) : undefined,
        });
      } catch (e) {
        if (e?.name === 'TimeoutError') throw new Error('O portal do governo está demorando demais para responder. Tente de novo em alguns minutos.');
        throw new Error('Sem conexão com o servidor do Uso LicitaHub.');
      }
      const json = await resposta.json().catch(() => ({}));
      // Paywall: o servidor recusou por plano -> convite para o upgrade.
      if (resposta.status === 402 && json.codigo === 'plano_insuficiente') LH.plano?.pedirUpgrade(json.exigido);
      if (!resposta.ok) throw Object.assign(new Error(json.erro || `O servidor respondeu ${resposta.status}.`), { status: resposta.status, codigo: json.codigo });
      return json;
    },
  };

  LH.nuvem = N;
})();
