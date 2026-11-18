// Testa a entrega do site pelo servidor (src/api/site.js) e a exclusão de
// conta (DELETE /api/conta), com um "banco" falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { criarApp } from '../src/api/app.js';
import { ehChaveSecreta, ligarSite } from '../src/api/site.js';
import { apagarPasta } from '../src/api/repositorio.js';

const USUARIO = { id: randomUUID(), email: 'ana@exemplo.com' };
const silencioso = { info() {}, aviso() {}, erro() {} };
const jwt = (dados) => `x.${Buffer.from(JSON.stringify(dados)).toString('base64url')}.y`;
const PUBLICA = jwt({ role: 'anon', ref: 'abc' });

async function montar() {
  const pasta = await mkdtemp(join(tmpdir(), 'licitahub-site-'));
  await mkdir(join(pasta, 'css'));
  await writeFile(join(pasta, 'index.html'), '<!doctype html><title>LicitaHub</title>');
  await writeFile(join(pasta, 'css', 'base.css'), 'body{}');
  const biblioteca = join(pasta, 'supabase-falso.js');
  await writeFile(biblioteca, 'window.supabase = {};');

  const excluidos = [];
  const repositorio = {
    usuarioDoToken: async (token) => (token === 'token-valido' ? USUARIO : null),
    comoUsuario: () => ({}),
    excluirUsuario: async (id) => { excluidos.push(id); },
  };
  const app = criarApp({ repositorio, analisar: async () => ({}), obterEdital: async () => ({}), log: silencioso });
  ligarSite(app, { pasta, publico: { supabaseUrl: 'https://abc.supabase.co', supabaseChave: PUBLICA, siteUrl: 'https://usolicitahub.com.br/' }, bibliotecaSupabase: biblioteca });
  return { app, excluidos, limpar: () => rm(pasta, { recursive: true, force: true }) };
}

test('o servidor entrega o site, a configuração pública e a biblioteca do Supabase', async (t) => {
  const { app, limpar } = await montar();
  t.after(limpar);

  const pagina = await app.request('/');
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /LicitaHub/);
  assert.equal((await app.request('/css/base.css')).status, 200);

  const config = await app.request('/config.js');
  assert.equal(config.status, 200);
  assert.match(config.headers.get('content-type'), /javascript/);
  const texto = await config.text();
  assert.match(texto, /window\.LH_CONFIG/);
  assert.match(texto, /https:\/\/abc\.supabase\.co/);
  // Os links dos e-mails usam o SITE_URL (sem barra no fim), nunca localhost.
  assert.match(texto, /"siteUrl":"https:\/\/usolicitahub\.com\.br"/);

  assert.match(await (await app.request('/vendor/supabase.js')).text(), /window\.supabase/);
  assert.equal((await app.request('/nao-existe.html')).status, 404);
  // A API continua respondendo JSON
  assert.equal((await app.request('/saude')).status, 200);
});

test('as voltas do Mercado Pago levam para a tela certa do site', async (t) => {
  const { app, limpar } = await montar();
  t.after(limpar);
  for (const [de, para] of [
    ['/assinatura/sucesso?payment_id=123&status=approved', '/app.html#/perfil?assinatura=sucesso'],
    ['/precos', '/app.html#/perfil'],
    ['/painel', '/app.html#/home'],
  ]) {
    const r = await app.request(de);
    assert.equal(r.status, 302, de);
    assert.equal(r.headers.get('location'), para, de);
  }
});

test('o site nunca recebe a chave secreta do Supabase', () => {
  assert.equal(ehChaveSecreta(jwt({ role: 'service_role' })), true);
  assert.equal(ehChaveSecreta('sb_secret_abc'), true);
  assert.equal(ehChaveSecreta(PUBLICA), false);
  assert.equal(ehChaveSecreta('sb_publishable_abc'), false);
  const app = criarApp({ repositorio: {}, analisar: async () => ({}), obterEdital: async () => ({}), log: silencioso });
  assert.throws(() => ligarSite(app, { pasta: tmpdir(), publico: { supabaseUrl: 'x', supabaseChave: jwt({ role: 'service_role' }) } }), /PÚBLICA/);
});

test('excluir a conta apaga os arquivos da organização em todas as subpastas (LGPD)', async () => {
  const arquivos = new Set(['org1/edital.pdf', 'org1/emp1/cnd.pdf', 'org1/emp1/balanco.pdf', 'org1/emp2/x/atestado.pdf', 'org2/manter.pdf']);
  // Storage simulado: list() devolve os filhos diretos (pasta = id null)
  const admin = {
    storage: {
      from: () => ({
        async list(prefixo) {
          const filhos = new Map();
          for (const p of arquivos) {
            if (!p.startsWith(`${prefixo}/`)) continue;
            const [primeiro, ...resto] = p.slice(prefixo.length + 1).split('/');
            filhos.set(primeiro, resto.length ? null : `id-${primeiro}`);
          }
          return { data: [...filhos].map(([name, id]) => ({ name, id })), error: null };
        },
        async remove(lista) {
          lista.forEach((p) => arquivos.delete(p));
          return { data: lista, error: null };
        },
      }),
    },
  };
  await apagarPasta(admin, 'documentos', 'org1');
  assert.deepEqual([...arquivos], ['org2/manter.pdf'], 'só a pasta da organização excluída some');
});

test('DELETE /api/conta exclui só a conta de quem está logado', async (t) => {
  const { app, excluidos, limpar } = await montar();
  t.after(limpar);
  assert.equal((await app.request('/api/conta', { method: 'DELETE' })).status, 401);
  const r = await app.request('/api/conta', { method: 'DELETE', headers: { authorization: 'Bearer token-valido' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { excluida: true });
  assert.deepEqual(excluidos, [USUARIO.id]);
});
