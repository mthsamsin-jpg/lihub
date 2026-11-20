// Modo ADM: login por variáveis de ambiente, sessão em cookie, limite de tentativas,
// e edição do conteúdo do site (textos, vídeos e fotos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { configAdm, conferirHash, criarLimitador, criarToken, gerarHash, lerToken, ligarAdm, linkDeVideo } from '../src/api/adm.js';

const silencioso = { info() {}, aviso() {}, erro() {} };
const SEGREDO = 'x'.repeat(40);

function supabaseFalso() {
  const t = { site_textos: [], site_midias: [] };
  const storage = { arquivos: new Set(), removidos: [] };
  const consulta = (tabela) => {
    const f = [];
    let acao = 'select';
    let valor;
    const q = {
      select() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      in(c, v) { f.push((r) => v.includes(r[c])); return q; },
      upsert(v) { acao = 'upsert'; valor = Array.isArray(v) ? v : [v]; return q; },
      delete() { acao = 'delete'; return q; },
      maybeSingle() { return q.then((r) => ({ data: r.data?.[0] ?? null, error: null })); },
      then(ok, falha) {
        if (acao === 'upsert') {
          for (const l of valor) { const i = t[tabela].findIndex((r) => r.chave === l.chave); if (i >= 0) t[tabela][i] = { ...t[tabela][i], ...l }; else t[tabela].push({ ...l }); }
          return Promise.resolve({ data: null, error: null }).then(ok, falha);
        }
        if (acao === 'delete') { t[tabela] = t[tabela].filter((r) => !f.every((x) => x(r))); return Promise.resolve({ error: null }).then(ok, falha); }
        return Promise.resolve({ data: t[tabela].filter((r) => f.every((x) => x(r))).map((r) => ({ ...r })), error: null }).then(ok, falha);
      },
    };
    return q;
  };
  return {
    t, storage, from: consulta,
    storage: {
      _: storage,
      from: () => ({
        createSignedUploadUrl: async (c) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/upload/sign/site-midia/${c}?token=abc` }, error: null }),
        list: async (pasta, { search }) => ({ data: [...storage.arquivos].filter((a) => a === `${pasta}/${search}`).map(() => ({ name: search })) }),
        getPublicUrl: (c) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/site-midia/${c}` } }),
        remove: async (lista) => { storage.removidos.push(...lista); return { data: null }; },
      }),
    },
  };
}

async function montar({ limitador } = {}) {
  const hash = await gerarHash('senha-forte-123', { N: 1024 });
  const cfg = configAdm({ ADMIN_LOGIN_EMAIL: 'ADM@licithub.local', ADMIN_LOGIN_PASSWORD_HASH: hash, ADMIN_SESSION_SECRET: SEGREDO });
  const app = new Hono();
  const supabase = supabaseFalso();
  ligarAdm(app, { supabase, cfg, log: silencioso, producao: true, atraso: 0, limitador });
  const pedir = (metodo, url, { corpo, cookie, adm = true, ip = '1.1.1.1' } = {}) => app.request(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}), ...(adm ? { 'x-lh-adm': '1' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const entrar = async () => {
    const r = await pedir('POST', '/api/adm/login', { corpo: { email: 'adm@licithub.local', senha: 'senha-forte-123' } });
    return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  };
  return { app, supabase, cfg, pedir, entrar };
}

test('hash scrypt e configuração: sem segredo forte ou sem senha = desligado', async () => {
  const h = await gerarHash('abc123456789', { N: 1024 });
  assert.match(h, /^scrypt\$1024\$8\$1\$/);
  assert.equal(await conferirHash('abc123456789', h), true);
  assert.equal(await conferirHash('errada', h), false);
  assert.equal(configAdm({ ADMIN_LOGIN_EMAIL: 'a@b', ADMIN_LOGIN_PASSWORD: 'x', ADMIN_SESSION_SECRET: 'curto' }), null);
  assert.equal(configAdm({ ADMIN_LOGIN_EMAIL: 'a@b', ADMIN_SESSION_SECRET: SEGREDO }), null);
  assert.equal(configAdm({ ADMIN_LOGIN_EMAIL: 'a@b', ADMIN_LOGIN_PASSWORD: 'x', ADMIN_SESSION_SECRET: SEGREDO }).horas, 8);
});

test('token: assinado, com validade e preso ao identificador', () => {
  const cfg = { email: 'adm@x', segredo: SEGREDO, horas: 1 };
  const tk = criarToken(cfg, 1000);
  assert.equal(lerToken(cfg, tk, 2000).role, 'admin');
  assert.equal(lerToken(cfg, tk, 1000 + 3600_001), null, 'expirado');
  assert.equal(lerToken({ ...cfg, segredo: 'y'.repeat(40) }, tk, 2000), null, 'outro segredo');
  assert.equal(lerToken({ ...cfg, email: 'outro@x' }, tk, 2000), null, 'identificador trocado');
  const [corpo, ass] = tk.split('.');
  const falso = Buffer.from(JSON.stringify({ role: 'admin', sub: 'adm@x', exp: 9e15 })).toString('base64url');
  assert.equal(lerToken(cfg, `${falso}.${ass}`, 2000), null, 'corpo adulterado');
  assert.equal(lerToken(cfg, corpo, 2000), null);
});

test('login: certo gera cookie HttpOnly/Secure/SameSite=Strict; errado é recusado', async () => {
  const { pedir } = await montar();
  const errado = await pedir('POST', '/api/adm/login', { corpo: { email: 'adm@licithub.local', senha: 'nao' } });
  assert.equal(errado.status, 401);
  assert.equal((await errado.json()).erro, 'Identificador ou senha inválidos.');
  const outroEmail = await pedir('POST', '/api/adm/login', { corpo: { email: 'x@licithub.local', senha: 'senha-forte-123' } });
  assert.equal(outroEmail.status, 401);

  const ok = await pedir('POST', '/api/adm/login', { corpo: { email: ' Adm@LicitHub.local ', senha: 'senha-forte-123' } });
  assert.equal(ok.status, 200);
  const cookies = ok.headers.getSetCookie();
  const sessao = cookies.find((c) => c.startsWith('lh_adm='));
  assert.match(sessao, /HttpOnly/);
  assert.match(sessao, /Secure/);
  assert.match(sessao, /SameSite=Strict/);
  assert.ok(cookies.some((c) => c.startsWith('lh_adm_on=1') && !/HttpOnly/.test(c)), 'aviso legível pelo site');
  assert.ok(!JSON.stringify(await ok.json()).includes('senha'), 'nada de senha na resposta');
});

test('força bruta: 5 erros por IP bloqueiam aquele IP; outro IP segue', async () => {
  let agora = 0;
  const { pedir } = await montar({ limitador: criarLimitador({ agora: () => agora }) });
  for (let i = 0; i < 5; i++) assert.equal((await pedir('POST', '/api/adm/login', { corpo: { email: 'a', senha: 'b' } })).status, 401);
  const bloqueado = await pedir('POST', '/api/adm/login', { corpo: { email: 'adm@licithub.local', senha: 'senha-forte-123' } });
  assert.equal(bloqueado.status, 429, 'nem a senha certa entra durante o bloqueio');
  assert.match((await bloqueado.json()).erro, /Muitas tentativas/);
  assert.equal((await pedir('POST', '/api/adm/login', { ip: '2.2.2.2', corpo: { email: 'adm@licithub.local', senha: 'senha-forte-123' } })).status, 200);
  agora += 15 * 60_000;
  assert.equal((await pedir('POST', '/api/adm/login', { corpo: { email: 'adm@licithub.local', senha: 'senha-forte-123' } })).status, 200, 'libera depois de 15 min');
});

test('ações ADM: sem sessão 401, sem cabeçalho X-LH-ADM 403; sair apaga a sessão', async () => {
  const { pedir, entrar } = await montar();
  assert.equal((await pedir('PUT', '/api/adm/textos', { corpo: { textos: { 'hero.titulo': 'x' } } })).status, 401);
  assert.equal((await pedir('GET', '/api/adm/sessao')).status, 401);
  const cookie = await entrar();
  assert.equal((await pedir('GET', '/api/adm/sessao', { cookie })).status, 200);
  assert.equal((await pedir('PUT', '/api/adm/textos', { cookie, adm: false, corpo: { textos: { 'hero.titulo': 'x' } } })).status, 403);
  const sair = await pedir('POST', '/api/adm/sair', { cookie });
  assert.ok(sair.headers.getSetCookie().every((c) => /Max-Age=0/.test(c)));
});

test('textos: salva, publica no conteúdo do site e texto vazio volta ao original', async () => {
  const { pedir, entrar, supabase } = await montar();
  const cookie = await entrar();
  let r = await pedir('PUT', '/api/adm/textos', { cookie, corpo: { textos: { 'hero.titulo': '  Novo   título  ', 'final.texto': 'Fim' } } });
  assert.deepEqual(await r.json(), { ok: true, salvos: 2, restaurados: 0 });
  assert.equal(supabase.t.site_textos.find((x) => x.chave === 'hero.titulo').texto, 'Novo título');
  const publico = await (await pedir('GET', '/api/site/conteudo', { adm: false })).json();
  assert.equal(publico.textos['hero.titulo'], 'Novo título');
  r = await pedir('PUT', '/api/adm/textos', { cookie, corpo: { textos: { 'final.texto': '' } } });
  assert.equal((await r.json()).restaurados, 1);
  assert.equal(supabase.t.site_textos.length, 1);
  assert.equal((await pedir('PUT', '/api/adm/textos', { cookie, corpo: { textos: { '../x': 'a' } } })).status, 400);
  assert.equal((await pedir('PUT', '/api/adm/textos', { cookie, corpo: { textos: { a: 'x'.repeat(2001) } } })).status, 400);
});

test('vídeo por link: só YouTube/Vimeo, convertido para incorporação', async () => {
  assert.deepEqual(linkDeVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), { tipo: 'youtube', url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
  assert.equal(linkDeVideo('https://youtu.be/dQw4w9WgXcQ').url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(linkDeVideo('https://youtube.com/shorts/dQw4w9WgXcQ').tipo, 'youtube');
  assert.deepEqual(linkDeVideo('https://vimeo.com/123456789'), { tipo: 'vimeo', url: 'https://player.vimeo.com/video/123456789' });
  assert.equal(linkDeVideo('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(linkDeVideo('javascript:alert(1)'), null);
  assert.equal(linkDeVideo('http://youtube.com/watch?v=dQw4w9WgXcQ'), null);

  const { pedir, entrar, supabase } = await montar();
  const cookie = await entrar();
  assert.equal((await pedir('PUT', '/api/adm/midias/hero/link', { cookie, corpo: { link: 'https://evil.com/x' } })).status, 400);
  assert.equal((await pedir('PUT', '/api/adm/midias/hero/link', { cookie, corpo: { link: 'https://youtu.be/dQw4w9WgXcQ', legenda: 'Apresentação' } })).status, 200);
  assert.equal(supabase.t.site_midias[0].tipo, 'youtube');
});

test('arquivo: autorização de envio validada, confirmação só se o arquivo chegou, troca apaga o antigo', async () => {
  const { pedir, entrar, supabase } = await montar();
  const cookie = await entrar();
  assert.equal((await pedir('POST', '/api/adm/midias/hero/envio', { cookie, corpo: { mime: 'application/x-msdownload', tamanho: 10 } })).status, 400);
  assert.equal((await pedir('POST', '/api/adm/midias/hero/envio', { cookie, corpo: { mime: 'video/mp4', tamanho: 60 * 1024 * 1024 } })).status, 400);
  const env = await (await pedir('POST', '/api/adm/midias/hero/envio', { cookie, corpo: { mime: 'video/mp4', tamanho: 1000 } })).json();
  assert.match(env.caminho, /^hero\/\d+-[0-9a-f]{8}\.mp4$/);
  assert.match(env.url, /upload\/sign\/site-midia/);
  assert.equal((await pedir('PUT', '/api/adm/midias/hero/arquivo', { cookie, corpo: { caminho: env.caminho } })).status, 400, 'ainda não chegou');
  assert.equal((await pedir('PUT', '/api/adm/midias/hero/arquivo', { cookie, corpo: { caminho: 'outro/../hero/x.mp4' } })).status, 400);
  supabase.storage._.arquivos.add(env.caminho);
  const ok = await (await pedir('PUT', '/api/adm/midias/hero/arquivo', { cookie, corpo: { caminho: env.caminho } })).json();
  assert.equal(ok.tipo, 'video');
  assert.match(ok.url, /object\/public\/site-midia\/hero\//);
  // trocar por link apaga o arquivo antigo do Storage
  await pedir('PUT', '/api/adm/midias/hero/link', { cookie, corpo: { link: 'https://vimeo.com/123456789' } });
  assert.deepEqual(supabase.storage._.removidos, [env.caminho]);
  assert.equal((await pedir('DELETE', '/api/adm/midias/hero', { cookie })).status, 200);
  assert.equal(supabase.t.site_midias.length, 0);
});

test('modo ADM desligado (sem configuração): rotas respondem 404; conteúdo público continua', async () => {
  const app = new Hono();
  ligarAdm(app, { supabase: supabaseFalso(), cfg: null, log: silencioso });
  assert.equal((await app.request('/api/adm/login', { method: 'POST' })).status, 404);
  assert.equal((await app.request('/api/site/conteudo')).status, 200);
});

test('no app completo: o login de cliente de /api/* não barra /api/adm, /api/site e /api/admin', async () => {
  const { criarApp } = await import('../src/api/app.js');
  const app = criarApp({ repositorio: { usuarioDoToken: async () => null, comoUsuario: () => ({}) }, analisar: async () => ({}), obterEdital: async () => ({}), log: silencioso });
  const hash = await gerarHash('senha-forte-123', { N: 1024 });
  ligarAdm(app, { supabase: supabaseFalso(), cfg: configAdm({ ADMIN_LOGIN_EMAIL: 'adm@x.local', ADMIN_LOGIN_PASSWORD_HASH: hash, ADMIN_SESSION_SECRET: SEGREDO }), log: silencioso, atraso: 0 });
  app.get('/api/admin/teste', (c) => c.json({ ok: true }));
  const login = await app.request('/api/adm/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'adm@x.local', senha: 'senha-forte-123' }) });
  assert.equal(login.status, 200);
  assert.equal((await app.request('/api/site/conteudo')).status, 200);
  assert.equal((await app.request('/api/admin/teste')).status, 200, 'a rota confere a própria autorização');
  const cliente = await app.request('/api/licitacoes/1');
  assert.equal(cliente.status, 401, 'rotas de cliente continuam exigindo login');
});
