// Entrega o site (pasta site/) pelo mesmo servidor da API. Assim o navegador
// fala com um endereço só: sem problemas de CORS e com a volta da Stripe
// (/assinatura/sucesso, /precos, /painel) caindo no lugar certo.
//
//   GET /config.js           configuração PÚBLICA do site (URL do Supabase e chave publicável)
//   GET /vendor/supabase.js  biblioteca do Supabase para o navegador (do node_modules)
//   GET /assinatura/sucesso  volta da página de pagamento  -> /app.html#/perfil?assinatura=sucesso
//   GET /precos              pagamento cancelado          -> /app.html#/perfil
//   GET /painel              volta do portal da Stripe    -> /app.html#/home
//   GET /*                   arquivos do site (index.html = apresentação, app.html = painel)
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';

export const PASTA_SITE = fileURLToPath(new URL('../../site', import.meta.url));

/** Caminho do arquivo da biblioteca do Supabase para navegador (UMD). */
export function caminhoSupabaseNavegador() {
  const require = createRequire(import.meta.url);
  return require.resolve('@supabase/supabase-js/dist/umd/supabase.js');
}

/** true se a chave for SECRETA (sb_secret_... ou JWT com role service_role). */
export function ehChaveSecreta(chave = '') {
  if (chave.startsWith('sb_secret_')) return true;
  try {
    const dados = JSON.parse(Buffer.from(chave.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return dados.role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * @param {import('hono').Hono} app
 * @param {object} opcoes
 * @param {string} [opcoes.pasta]  pasta do site
 * @param {{ supabaseUrl: string, supabaseChave: string, siteUrl?: string }} opcoes.publico  só valores que podem ir ao navegador
 * @param {string} [opcoes.bibliotecaSupabase]  caminho do supabase.js (UMD)
 */
export function ligarSite(app, { pasta = PASTA_SITE, publico, bibliotecaSupabase = caminhoSupabaseNavegador() }) {
  // Nunca deixar escapar uma chave secreta por engano (service_role / sb_secret_).
  if (ehChaveSecreta(publico.supabaseChave)) {
    throw new Error('A chave do site precisa ser a PÚBLICA do Supabase (SUPABASE_PUBLISHABLE_KEY).');
  }
  const configJs = `window.LH_CONFIG = ${JSON.stringify({
    supabaseUrl: publico.supabaseUrl,
    supabaseChave: publico.supabaseChave,
    // Base dos links dos e-mails (cadastro e senha). Vem do SITE_URL.
    siteUrl: (publico.siteUrl ?? '').replace(/\/+$/, ''),
  })};\n`;

  app.get('/config.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    c.header('Cache-Control', 'no-store');
    return c.body(configJs);
  });

  let biblioteca;
  app.get('/vendor/supabase.js', async (c) => {
    biblioteca ??= await readFile(bibliotecaSupabase);
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(biblioteca);
  });

  app.get('/assinatura/sucesso', (c) => c.redirect('/app.html#/perfil?assinatura=sucesso', 302));
  app.get('/precos', (c) => c.redirect('/app.html#/perfil', 302));
  app.get('/painel', (c) => c.redirect('/app.html#/home', 302));

  app.use('/*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    await next();
    // Sem isto o navegador guarda HTML/JS/CSS por conta própria e o usuário segue vendo
    // a versão antiga depois de um deploy. "no-cache" = pode guardar, mas confere antes
    // (Last-Modified): se nada mudou, a resposta é um 304 rápido.
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', /\.(png|svg|ico|woff2?)$/i.test(c.req.path) ? 'public, max-age=86400' : 'no-cache');
  });
  app.use('/*', serveStatic({ root: pasta }));
  return app;
}
