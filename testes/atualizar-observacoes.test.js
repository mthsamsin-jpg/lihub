// Testa o supabase/atualizar-observacoes.sql sobre o banco da versão anterior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const raiz = new URL('../', import.meta.url);
const ler = (caminho) => readFile(new URL(caminho, raiz), 'utf8');

test('atualizar-observacoes.sql sobre o banco atual (pode rodar duas vezes)', async (t) => {
  let antigo;
  try { antigo = execFileSync('git', ['show', 'ed8358d:supabase/schema.sql'], { cwd: raiz, encoding: 'utf8' }); } catch { return t.skip('histórico do git indisponível'); }
  const db = await PGlite.create({ extensions: { unaccent } });
  await db.exec(await ler('testes/supabase-simulado.sql'));
  await db.exec(antigo);
  const sql = (await ler('supabase/atualizar-observacoes.sql')).replace(/^notify pgrst.*$/m, '');
  await db.exec(sql);
  await db.exec(sql);
  const r = await db.query(`select relrowsecurity from pg_class where relname = 'licitacao_observacoes'`);
  assert.equal(r.rows[0]?.relrowsecurity, true, 'tabela criada com RLS ligado');
  await db.close();
});
