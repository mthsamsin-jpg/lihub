// Testa o supabase/atualizar-radar.sql: aplicado sobre um banco na versão
// antiga do schema, cria a coluna, a busca por municípios e a contagem do mapa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const raiz = new URL('../', import.meta.url);
const ler = (caminho) => readFile(new URL(caminho, raiz), 'utf8');
/** schema.sql de um commit antigo (o banco de quem ainda não atualizou). */
const schemaDoCommit = (commit) => execFileSync('git', ['show', `${commit}:supabase/schema.sql`], { cwd: raiz, encoding: 'utf8' });

for (const [commit, descricao] of [['eec2c70', 'banco da primeira versão'], ['fbdc2be', 'banco da versão com municípios']]) {
  test(`atualizar-radar.sql sobre o ${descricao}`, async (t) => {
    let antigo;
    try { antigo = schemaDoCommit(commit); } catch { return t.skip('histórico do git indisponível'); }
    const db = await PGlite.create({ extensions: { unaccent } });
    await db.exec(await ler('testes/supabase-simulado.sql'));
    await db.exec(antigo);
    const atualizacao = (await ler('supabase/atualizar-radar.sql')).replace(/^notify pgrst.*$/m, '');
    await db.exec(atualizacao);
    await db.exec(atualizacao); // pode rodar duas vezes

    const funcoes = await db.query(`select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('buscar_licitacoes', 'radar_contagem') order by 1`);
    assert.deepEqual(funcoes.rows.map((r) => r.proname), ['buscar_licitacoes', 'radar_contagem'], 'uma de cada, sem versão duplicada');
    assert.match(funcoes.rows[0].args, /p_municipios text\[\]/);

    const coluna = await db.query(`select 1 from information_schema.columns where table_name = 'radares' and column_name = 'municipios'`);
    assert.equal(coluna.rows.length, 1);

    await db.query(`insert into public.licitacoes (fonte, numero_controle_pncp, uf, municipio, modalidade_id, objeto, data_encerramento_proposta)
      values ('pncp', 'x-1', 'SC', 'Florianópolis', 8, 'Cadeiras de escritório', now() + interval '3 days')`);
    const r = await db.query(`select uf, municipio, total from public.radar_contagem(p_termo => 'cadeiras', p_municipios => array['florianopolis'])`);
    assert.deepEqual(r.rows.map((x) => [x.uf, x.municipio, Number(x.total)]), [['SC', 'Florianópolis', 1]]);
    await db.close();
  });
}
