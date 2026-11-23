// Modo ADM do site: login administrativo com credencial das variáveis de ambiente,
// sessão em cookie assinado e edição do conteúdo do site (textos, vídeos e fotos).
//
// Segurança:
//   - a senha nunca vai para o navegador; o servidor compara com um hash scrypt
//     (ADMIN_LOGIN_PASSWORD_HASH) ou, se não houver, com ADMIN_LOGIN_PASSWORD;
//   - sessão: cookie HttpOnly + Secure + SameSite=Strict, assinado (HMAC-SHA256) com
//     ADMIN_SESSION_SECRET, com validade (ADMIN_SESSION_HORAS);
//   - força bruta: 5 erros por IP a cada 15 min (depois bloqueio) + 30 tentativas/hora no
//     total + ~0,5 s em toda tentativa;
//   - rotas que alteram algo exigem a sessão E o cabeçalho X-LH-ADM (barra pedidos de
//     outros sites, junto com o SameSite=Strict);
//   - sem a credencial configurada, tudo responde 404 (modo ADM desligado).
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ligarAdmUsuarios } from './adm-usuarios.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'lh_adm';
const COOKIE_AVISO = 'lh_adm_on'; // sem segredo: só avisa o site para perguntar a sessão
const CHAVE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const BUCKET = 'site-midia';
const MIMES = { 'video/mp4': ['video', 'mp4'], 'video/webm': ['video', 'webm'], 'image/jpeg': ['imagem', 'jpg'], 'image/png': ['imagem', 'png'], 'image/webp': ['imagem', 'webp'] };
const MAX_BYTES = 50 * 1024 * 1024;

const iguais = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** "scrypt$N$r$p$sal$hash" (base64) — gerado por npm run adm:hash. */
export async function gerarHash(senha, { N = 16384, r = 8, p = 1 } = {}) {
  const sal = randomBytes(16);
  const h = await scrypt(String(senha), sal, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${sal.toString('base64')}$${h.toString('base64')}`;
}
export async function conferirHash(senha, hash) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(String(hash || ''));
  if (!m) return false;
  const esperado = Buffer.from(m[5], 'base64');
  const h = await scrypt(String(senha), Buffer.from(m[4], 'base64'), esperado.length, { N: +m[1], r: +m[2], p: +m[3], maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(h, esperado);
}

/** Lê a configuração do ambiente. null = modo ADM desligado. */
export function configAdm(env = process.env) {
  const t = (k) => env[k]?.trim() || '';
  const email = t('ADMIN_LOGIN_EMAIL').toLowerCase();
  const hash = t('ADMIN_LOGIN_PASSWORD_HASH');
  const senha = t('ADMIN_LOGIN_PASSWORD');
  const segredo = t('ADMIN_SESSION_SECRET');
  if (!email || !(hash || senha) || segredo.length < 32) return null;
  return { email, hash, senha, segredo, horas: Math.min(Math.max(Number(t('ADMIN_SESSION_HORAS')) || 8, 1), 72) };
}

/** Sessão assinada: base64url(json).base64url(hmac). */
export function criarToken(cfg, agora = Date.now()) {
  const corpo = Buffer.from(JSON.stringify({ role: 'admin', sub: cfg.email, exp: agora + cfg.horas * 3600_000 })).toString('base64url');
  return `${corpo}.${createHmac('sha256', cfg.segredo).update(corpo).digest('base64url')}`;
}
export function lerToken(cfg, token, agora = Date.now()) {
  const [corpo, assinatura] = String(token || '').split('.');
  if (!corpo || !assinatura) return null;
  if (!iguais(assinatura, createHmac('sha256', cfg.segredo).update(corpo).digest('base64url'))) return null;
  try {
    const s = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return s.role === 'admin' && s.sub === cfg.email && s.exp > agora ? s : null;
  } catch { return null; }
}

/** Limite de tentativas por IP e geral (memória do processo; zera ao reiniciar). */
export function criarLimitador({ porIp = 5, janelaIpMs = 15 * 60_000, geral = 30, janelaGeralMs = 60 * 60_000, agora = () => Date.now() } = {}) {
  const ips = new Map();
  let tentativas = [];
  return {
    /** Pode tentar? Devolve null ou os segundos até liberar. */
    bloqueado(ip) {
      const t = agora();
      tentativas = tentativas.filter((x) => t - x < janelaGeralMs);
      if (tentativas.length >= geral) return Math.ceil((janelaGeralMs - (t - tentativas[0])) / 1000);
      const r = ips.get(ip);
      if (r && r.falhas >= porIp && t - r.inicio < janelaIpMs) return Math.ceil((janelaIpMs - (t - r.inicio)) / 1000);
      return null;
    },
    tentou(ip, ok) {
      const t = agora();
      tentativas.push(t);
      if (ok) { ips.delete(ip); return; }
      const r = ips.get(ip);
      if (!r || t - r.inicio >= janelaIpMs) ips.set(ip, { falhas: 1, inicio: t });
      else r.falhas++;
    },
  };
}

function lerCookie(c, nome) {
  const m = new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`).exec(c.req.header('cookie') || '');
  return m ? decodeURIComponent(m[1]) : null;
}
const ipDe = (c) => (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || c.req.header('x-real-ip') || 'local';

/** YouTube/Vimeo -> endereço de incorporação (só desses dois sites). */
export function linkDeVideo(link) {
  let u;
  try { u = new URL(String(link).trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') || (/^\/(embed|shorts|live)\/([^/?]+)/.exec(u.pathname) || [])[2];
  }
  if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) return { tipo: 'youtube', url: `https://www.youtube-nocookie.com/embed/${id}` };
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = (/(\d{6,12})/.exec(u.pathname) || [])[1];
    if (v) return { tipo: 'vimeo', url: `https://player.vimeo.com/video/${v}` };
  }
  return null;
}

/**
 * Liga as rotas. Chamar ANTES de ligarSite (o site é o "pega-tudo").
 * @param {import('hono').Hono} app
 * @param {{ supabase: any, cfg?: ReturnType<typeof configAdm>, log?: any, producao?: boolean, limitador?: ReturnType<typeof criarLimitador>, atraso?: number }} deps
 * @returns {{ sessaoAdm: (c) => object|null }}
 */
export function ligarAdm(app, { supabase, cfg = configAdm(), log = console, producao = true, limitador = criarLimitador(), atraso = 500 }) {
  const sessaoAdm = (c) => (cfg ? lerToken(cfg, lerCookie(c, COOKIE)) : null);
  const atributos = (maxAge) => `Path=/; Max-Age=${maxAge}; SameSite=Strict${producao ? '; Secure' : ''}`;
  let cache = null; // conteúdo público, 30 s

  async function conteudo() {
    if (cache && Date.now() - cache.em < 30_000) return cache.dados;
    const [{ data: textos }, { data: midias }] = await Promise.all([
      supabase.from('site_textos').select('chave, texto'),
      supabase.from('site_midias').select('chave, tipo, url, legenda'),
    ]);
    const dados = { textos: Object.fromEntries((textos || []).map((t) => [t.chave, t.texto])), midias: Object.fromEntries((midias || []).map((m) => [m.chave, m])) };
    cache = { em: Date.now(), dados };
    return dados;
  }

  // Conteúdo público do site (textos e mídias trocados pelo ADM).
  app.get('/api/site/conteudo', async (c) => {
    try {
      c.header('Cache-Control', 'public, max-age=30');
      return c.json(await conteudo());
    } catch (e) {
      log.erro?.(`Conteúdo do site: ${e.message}`);
      return c.json({ textos: {}, midias: {} });
    }
  });
  app.get('/adm', (c) => c.redirect('/adm.html', 302));

  if (!cfg) {
    app.all('/api/adm/*', (c) => c.json({ erro: 'Modo ADM desligado.' }, 404));
    return { sessaoAdm };
  }

  // Exige sessão ADM (e o cabeçalho X-LH-ADM nas alterações).
  const exigir = (fn) => async (c) => {
    if (!sessaoAdm(c)) return c.json({ erro: 'Entre no modo ADM.' }, 401);
    if (c.req.method !== 'GET' && c.req.header('x-lh-adm') !== '1') return c.json({ erro: 'Pedido recusado.' }, 403);
    return fn(c);
  };

  app.post('/api/adm/login', async (c) => {
    const ip = ipDe(c);
    const espera = limitador.bloqueado(ip);
    if (espera) return c.json({ erro: `Muitas tentativas. Tente de novo em ${Math.ceil(espera / 60)} min.` }, 429);
    const corpo = await c.req.json().catch(() => ({}));
    const email = String(corpo.email || '').trim().toLowerCase();
    const senha = String(corpo.senha || '');
    await esperar(atraso);
    const senhaOk = cfg.hash ? await conferirHash(senha, cfg.hash).catch(() => false) : iguais(senha, cfg.senha);
    const ok = iguais(email, cfg.email) && senhaOk && senha.length > 0;
    limitador.tentou(ip, ok);
    if (!ok) {
      log.aviso?.(`ADM: login recusado (IP ${ip}).`);
      return c.json({ erro: 'Identificador ou senha inválidos.' }, 401);
    }
    log.info?.(`ADM: login (IP ${ip}).`);
    const segundos = cfg.horas * 3600;
    c.header('Set-Cookie', `${COOKIE}=${criarToken(cfg)}; HttpOnly; ${atributos(segundos)}`, { append: true });
    c.header('Set-Cookie', `${COOKIE_AVISO}=1; ${atributos(segundos)}`, { append: true });
    return c.json({ ok: true, role: 'admin' });
  });

  // Painel de usuários (listar, acompanhar, bloquear e desbloquear).
  ligarAdmUsuarios(app, { supabase, exigir, ipDe, log });

  app.post('/api/adm/sair', (c) => {
    c.header('Set-Cookie', `${COOKIE}=; HttpOnly; ${atributos(0)}`, { append: true });
    c.header('Set-Cookie', `${COOKIE_AVISO}=; ${atributos(0)}`, { append: true });
    return c.json({ ok: true });
  });

  app.get('/api/adm/sessao', (c) => {
    const s = sessaoAdm(c);
    return s ? c.json({ admin: true, role: 'admin', expira: new Date(s.exp).toISOString() }) : c.json({ admin: false }, 401);
  });

  // Textos: { textos: { "hero.titulo": "..." } } (texto vazio = volta ao original do site)
  app.put('/api/adm/textos', exigir(async (c) => {
    const corpo = await c.req.json().catch(() => ({}));
    const pares = Object.entries(corpo.textos || {});
    if (!pares.length || pares.length > 200) return c.json({ erro: 'Nada para salvar.' }, 400);
    const gravar = [];
    const apagar = [];
    for (const [chave, texto] of pares) {
      if (!CHAVE.test(chave)) return c.json({ erro: `Chave inválida: ${chave}` }, 400);
      const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
      if (t.length > 2000) return c.json({ erro: `Texto longo demais em ${chave} (máx. 2000).` }, 400);
      if (t) gravar.push({ chave, texto: t, atualizado_em: new Date().toISOString() }); else apagar.push(chave);
    }
    if (gravar.length) {
      const { error } = await supabase.from('site_textos').upsert(gravar, { onConflict: 'chave' });
      if (error) return c.json({ erro: `Não consegui salvar: ${error.message}` }, 500);
    }
    if (apagar.length) await supabase.from('site_textos').delete().in('chave', apagar);
    cache = null;
    log.info?.(`ADM: ${gravar.length} texto(s) salvo(s), ${apagar.length} restaurado(s).`);
    return c.json({ ok: true, salvos: gravar.length, restaurados: apagar.length });
  }));

  // Mídia por link (YouTube/Vimeo).
  app.put('/api/adm/midias/:chave/link', exigir(async (c) => {
    const chave = c.req.param('chave');
    if (!CHAVE.test(chave)) return c.json({ erro: 'Espaço inválido.' }, 400);
    const corpo = await c.req.json().catch(() => ({}));
    const v = linkDeVideo(corpo.link);
    if (!v) return c.json({ erro: 'Cole um link do YouTube ou do Vimeo.' }, 400);
    await removerArquivo(chave);
    const { error } = await supabase.from('site_midias').upsert({ chave, ...v, caminho: null, legenda: legenda(corpo.legenda), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    if (error) return c.json({ erro: error.message }, 500);
    cache = null;
    return c.json({ ok: true, ...v });
  }));

  // Arquivo: 1) pede autorização de envio (o navegador manda DIRETO ao Storage); 2) confirma.
  app.post('/api/adm/midias/:chave/envio', exigir(async (c) => {
    const chave = c.req.param('chave');
    const corpo = await c.req.json().catch(() => ({}));
    const tipo = MIMES[corpo.mime];
    if (!CHAVE.test(chave)) return c.json({ erro: 'Espaço inválido.' }, 400);
    if (!tipo) return c.json({ erro: 'Formato não aceito. Use MP4, WebM, JPG, PNG ou WebP.' }, 400);
    if (!(Number(corpo.tamanho) > 0) || Number(corpo.tamanho) > MAX_BYTES) return c.json({ erro: 'O arquivo precisa ter até 50 MB. Para vídeos maiores, use um link do YouTube ou Vimeo.' }, 400);
    const caminho = `${chave}/${Date.now()}-${randomBytes(4).toString('hex')}.${tipo[1]}`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(caminho);
    if (error) return c.json({ erro: `Não consegui autorizar o envio: ${error.message}` }, 500);
    return c.json({ ok: true, url: data.signedUrl, caminho });
  }));

  app.put('/api/adm/midias/:chave/arquivo', exigir(async (c) => {
    const chave = c.req.param('chave');
    const corpo = await c.req.json().catch(() => ({}));
    const caminho = String(corpo.caminho || '');
    if (!CHAVE.test(chave) || !caminho.startsWith(`${chave}/`) || caminho.includes('..')) return c.json({ erro: 'Arquivo inválido.' }, 400);
    const ext = caminho.split('.').pop();
    const tipo = Object.values(MIMES).find(([, e]) => e === ext)?.[0];
    if (!tipo) return c.json({ erro: 'Arquivo inválido.' }, 400);
    // confere que o arquivo chegou ao Storage
    const pasta = caminho.slice(0, caminho.lastIndexOf('/'));
    const nome = caminho.slice(caminho.lastIndexOf('/') + 1);
    const { data: lista } = await supabase.storage.from(BUCKET).list(pasta, { search: nome });
    if (!lista?.some((f) => f.name === nome)) return c.json({ erro: 'O arquivo não chegou. Envie de novo.' }, 400);
    await removerArquivo(chave);
    const url = supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
    const { error } = await supabase.from('site_midias').upsert({ chave, tipo, url, caminho, legenda: legenda(corpo.legenda), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    if (error) return c.json({ erro: error.message }, 500);
    cache = null;
    log.info?.(`ADM: mídia "${chave}" trocada (${tipo}).`);
    return c.json({ ok: true, tipo, url });
  }));

  app.delete('/api/adm/midias/:chave', exigir(async (c) => {
    const chave = c.req.param('chave');
    if (!CHAVE.test(chave)) return c.json({ erro: 'Espaço inválido.' }, 400);
    await removerArquivo(chave);
    await supabase.from('site_midias').delete().eq('chave', chave);
    cache = null;
    return c.json({ ok: true });
  }));

  const legenda = (t) => (String(t || '').trim().slice(0, 300) || null);
  async function removerArquivo(chave) {
    const { data } = await supabase.from('site_midias').select('caminho').eq('chave', chave).maybeSingle();
    if (data?.caminho) await supabase.storage.from(BUCKET).remove([data.caminho]).catch(() => {});
  }

  log.info?.('Modo ADM ligado (/adm).');
  return { sessaoAdm };
}
