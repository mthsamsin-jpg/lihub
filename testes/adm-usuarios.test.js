// Painel ADM de usuários: proteção das rotas, listagem, resumo, bloquear e desbloquear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { configAdm, criarToken, ligarAdm } from '../src/api/adm.js';

const silencioso = { info() {}, aviso() {}, erro() {} };
const ID = '11111111-2222-4333-8444-555555555555';

function supabaseFalso({ semMigracao = false } = {}) {
  const chamadas = { rpc: [], ban: [], auditoria: [] };
  const usuarios = { [ID]: { id: ID, email: 'cliente@exemplo.com' } };
  const erroMigracao = { code: 'PGRST202', message: 'Could not find the function public.adm_usuarios in the schema cache' };
  return {
    chamadas,
    rpc: async (nome, args) => {
      chamadas.rpc.push([nome, args]);
      if (semMigracao) return { data: null, error: erroMigracao };
      if (nome === 'adm_usuarios_resumo') return { data: { total: 2, ativos: 1, bloqueados: 1 }, error: null };
      if (nome === 'adm_usuarios') return { data: [{ id: ID, email: 'cliente@exemplo.com', nome: 'Ana', plano: 'max', bloqueado: false, total: 1 }], error: null };
      if (nome === 'adm_encerrar_sessoes') return { data: 2, error: null };
      return { data: null, error: { message: 'rpc desconhecida' } };
    },
    auth: { admin: {
      getUserById: async (id) => (usuarios[id] ? { data: { user: usuarios[id] }, error: null } : { data: { user: null }, error: { message: 'not found' } }),
      updateUserById: async (id, atributos) => { chamadas.ban.push([id, atributos.ban_duration]); return { data: {}, error: null }; },
    } },
    from: (tabela) => ({
      insert: async (linha) => { chamadas.auditoria.push({ tabela, ...linha }); return { error: null }; },
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
    }),
  };
}

function montar(opcoes) {
  const cfg = configAdm({ ADMIN_LOGIN_EMAIL: 'adm@x.local', ADMIN_LOGIN_PASSWORD: 'senha-forte-123', ADMIN_SESSION_SECRET: 'y'.repeat(40) });
  const app = new Hono();
  const supabase = supabaseFalso(opcoes);
  ligarAdm(app, { supabase, cfg, log: silencioso, atraso: 0 });
  const cookie = `lh_adm=${criarToken(cfg)}`;
  const pedir = (metodo, url, { corpo, comSessao = true, adm = true } = {}) => app.request(url, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(comSessao ? { cookie } : {}), ...(adm ? { 'x-lh-adm': '1' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { pedir, supabase };
}

test('rotas de usuários exigem sessão ADM e o cabeçalho nas alterações', async () => {
  const { pedir, supabase } = montar();
  assert.equal((await pedir('GET', '/api/adm/usuarios', { comSessao: false })).status, 401);
  assert.equal((await pedir('GET', '/api/adm/usuarios/resumo', { comSessao: false })).status, 401);
  assert.equal((await pedir('POST', `/api/adm/usuarios/${ID}/bloquear`, { comSessao: false })).status, 401);
  assert.equal((await pedir('POST', `/api/adm/usuarios/${ID}/bloquear`, { adm: false })).status, 403);
  assert.equal(supabase.chamadas.ban.length, 0);
});

test('lista e resumo', async () => {
  const { pedir, supabase } = montar();
  const r = await pedir('GET', '/api/adm/usuarios?busca=ana&estado=bloqueados&pagina=2');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.total, 1);
  assert.equal(j.usuarios[0].email, 'cliente@exemplo.com');
  assert.equal(j.usuarios[0].bloqueado, false);
  const [, args] = supabase.chamadas.rpc.find(([n]) => n === 'adm_usuarios');
  assert.deepEqual(args, { p_busca: 'ana', p_estado: 'bloqueados', p_limite: 25, p_offset: 25 });
  // estado desconhecido vira "todos"
  await pedir('GET', '/api/adm/usuarios?estado=hack');
  assert.equal(supabase.chamadas.rpc.at(-1)[1].p_estado, 'todos');
  const resumo = await (await pedir('GET', '/api/adm/usuarios/resumo')).json();
  assert.equal(resumo.bloqueados, 1);
});

test('bloquear: ban, encerra sessões e registra na auditoria', async () => {
  const { pedir, supabase } = montar();
  const r = await pedir('POST', `/api/adm/usuarios/${ID}/bloquear`, { corpo: { motivo: '  uso   indevido ' } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, id: ID, bloqueado: true, sessoesEncerradas: 2 });
  assert.deepEqual(supabase.chamadas.ban, [[ID, '876000h']]);
  assert.ok(supabase.chamadas.rpc.some(([n, a]) => n === 'adm_encerrar_sessoes' && a.p_user === ID));
  assert.equal(supabase.chamadas.auditoria[0].acao, 'bloquear');
  assert.equal(supabase.chamadas.auditoria[0].motivo, 'uso indevido');
  assert.equal(supabase.chamadas.auditoria[0].alvo_email, 'cliente@exemplo.com');
});

test('desbloquear: tira o ban e registra', async () => {
  const { pedir, supabase } = montar();
  const r = await pedir('POST', `/api/adm/usuarios/${ID}/desbloquear`);
  assert.equal(r.status, 200);
  assert.deepEqual(supabase.chamadas.ban, [[ID, 'none']]);
  assert.ok(!supabase.chamadas.rpc.some(([n]) => n === 'adm_encerrar_sessoes'));
  assert.equal(supabase.chamadas.auditoria[0].acao, 'desbloquear');
});

test('id inválido, usuário inexistente e banco sem a migração', async () => {
  const { pedir } = montar();
  assert.equal((await pedir('POST', '/api/adm/usuarios/abc/bloquear')).status, 400);
  assert.equal((await pedir('POST', '/api/adm/usuarios/99999999-2222-4333-8444-555555555555/bloquear')).status, 404);
  const sem = montar({ semMigracao: true });
  const r = await sem.pedir('GET', '/api/adm/usuarios');
  assert.equal(r.status, 503);
  assert.match((await r.json()).erro, /atualizar-adm-usuarios\.sql/);
});
