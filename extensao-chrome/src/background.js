// Service worker da extensão: fala com o LicitaHub (Supabase) em nome da pessoa.
//   - login com o MESMO e-mail e senha do LicitaHub (Supabase Auth);
//   - lê as propostas pela API do Supabase com o token da pessoa: o RLS do banco
//     garante que ela só vê as propostas da própria organização;
//   - nunca usa chave secreta: a chave pública vem do /config.js do site.
// Nada no backend do LicitaHub muda.

const SITE_PADRAO = 'https://usolicitahub.com.br';
const local = chrome.storage.local;
const sessao = chrome.storage.session; // some quando o navegador fecha

async function site() {
  const { site: s } = await local.get('site');
  return String(s || SITE_PADRAO).replace(/\/+$/, '');
}

/** Lê a URL e a chave PÚBLICA do Supabase publicadas pelo próprio site. */
async function configuracao() {
  const base = await site();
  const { config } = await sessao.get('config');
  if (config?.base === base) return config;
  const r = await fetch(`${base}/config.js`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Não consegui falar com o LicitaHub (${base}).`);
  const m = /window\.LH_CONFIG\s*=\s*(\{[\s\S]*?\});/.exec(await r.text());
  if (!m) throw new Error('Resposta inesperada do LicitaHub.');
  const c = JSON.parse(m[1]);
  if (!c.supabaseUrl || !c.supabaseChave) throw new Error('O LicitaHub não está configurado para login.');
  const novo = { base, url: c.supabaseUrl.replace(/\/+$/, ''), chave: c.supabaseChave };
  await sessao.set({ config: novo });
  return novo;
}

async function auth(caminho, corpo) {
  const c = await configuracao();
  const r = await fetch(`${c.url}/auth/v1/${caminho}`, {
    method: 'POST', headers: { apikey: c.chave, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (/invalid.*credentials|invalid_grant/i.test(`${j.error} ${j.error_description} ${j.msg} ${j.error_code}`)) throw new Error('E-mail ou senha incorretos.');
    if (/not.*confirmed/i.test(`${j.msg} ${j.error_description} ${j.error_code}`)) throw new Error('Confirme o seu e-mail antes de entrar.');
    throw new Error(j.msg || j.error_description || `Falha no login (${r.status}).`);
  }
  const s = { acesso: j.access_token, renovar: j.refresh_token, expira: Date.now() + (j.expires_in - 60) * 1000, email: j.user?.email };
  await sessao.set({ acesso: s.acesso, expira: s.expira });
  await local.set({ renovar: s.renovar, email: s.email });
  return s;
}

/** Token válido (renova sozinho). */
async function token() {
  const { acesso, expira } = await sessao.get(['acesso', 'expira']);
  if (acesso && expira > Date.now()) return acesso;
  const { renovar } = await local.get('renovar');
  if (!renovar) throw Object.assign(new Error('Entre com a sua conta do LicitaHub.'), { codigo: 'sem_login' });
  try {
    return (await auth('token?grant_type=refresh_token', { refresh_token: renovar })).acesso;
  } catch {
    await sair();
    throw Object.assign(new Error('A sessão expirou: entre de novo.'), { codigo: 'sem_login' });
  }
}

async function rest(caminho) {
  const c = await configuracao();
  const r = await fetch(`${c.url}/rest/v1/${caminho}`, { headers: { apikey: c.chave, Authorization: `Bearer ${await token()}` } });
  if (r.status === 401) { await sair(); throw Object.assign(new Error('A sessão expirou: entre de novo.'), { codigo: 'sem_login' }); }
  if (!r.ok) throw new Error(`O LicitaHub respondeu ${r.status}.`);
  return r.json();
}

async function sair() {
  await sessao.remove(['acesso', 'expira']);
  await local.remove(['renovar', 'email']);
}

const COLUNAS = 'id,numero,status,licitacao_resumo,itens,total,atualizado_em';

/** Itens no formato que a conferência usa. */
function itensDaProposta(p) {
  return (p.itens || []).map((it, k) => ({
    numero: it.numero ?? k + 1, descricao: it.descricao || '', unidade: it.unidade || '', quantidade: Number(it.quantidade) || null,
    unitario: Number(it.unitario) || 0, marca: it.marca || '', modelo: it.modelo || '',
  }));
}

const ACOES = {
  async situacao() {
    const { renovar, email } = await local.get(['renovar', 'email']);
    return { logado: !!renovar, email: email || null, site: await site() };
  },
  async entrar({ email, senha }) {
    if (!email || !senha) throw new Error('Informe e-mail e senha.');
    const s = await auth('token?grant_type=password', { email: String(email).trim(), password: senha });
    return { logado: true, email: s.email };
  },
  async sair() { await sair(); return { logado: false }; },
  async definirSite({ site: s }) {
    const u = new URL(s); // valida
    if (!/^https:$|^http:$/.test(u.protocol)) throw new Error('Endereço inválido.');
    await local.set({ site: u.origin });
    await sessao.remove('config');
    await sair();
    return { site: u.origin };
  },
  async propostas() {
    const lista = await rest(`propostas?select=${COLUNAS}&order=atualizado_em.desc&limit=50`);
    return {
      propostas: lista.map((p) => ({
        id: p.id, numero: p.numero, status: p.status, total: Number(p.total) || 0, atualizado: p.atualizado_em,
        licitacao: p.licitacao_resumo || null, itens: itensDaProposta(p),
      })),
    };
  },
};

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  // Só o popup da própria extensão pode pedir dados (nunca uma página).
  if (remetente.id !== chrome.runtime.id || remetente.tab) return false;
  const fn = ACOES[msg?.tipo];
  if (!fn) return false;
  fn(msg.dados || {})
    .then((r) => responder({ ok: true, ...r }))
    .catch((e) => responder({ ok: false, erro: e.message, codigo: e.codigo || null }));
  return true;
});
