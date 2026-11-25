// CNPJ alfanumérico: o exemplo oficial da Receita é 12.ABC.345/01DE-35.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { interpretarNumeroControle } from '../src/pncp/dominio.js';
import { registroPadrao } from '../src/services/collectors/esquema.js';

const ler = (f) => readFileSync(new URL(`../site/js/${f}`, import.meta.url), 'utf8');
const ctx = {};
ctx.window = ctx;
vm.runInNewContext(ler('propostas-regras.js'), ctx);
// De nucleo.js só o bloco do CNPJ (o resto precisa de navegador).
const nucleo = ler('nucleo.js').replace(/\r\n/g, '\n');
const inicio = nucleo.indexOf('  LH.cnpj = {');
vm.runInNewContext(`(function(){ const LH = window.LH;${nucleo.slice(inicio, nucleo.indexOf('\n  };', inicio) + 5)}}())`, ctx);
const { cnpj, propostasRegras: r } = ctx.LH;

test('site: valida, limpa e mascara os dois formatos', () => {
  for (const v of ['12.ABC.345/01DE-35', '12abc34501de35', '11.222.333/0001-81']) assert.ok(cnpj.valido(v), v);
  for (const v of ['12.ABC.345/01DE-36', '12ABC34501DE3A', '00000000000000', '11222333000180', '', '123']) assert.ok(!cnpj.valido(v), v);
  assert.equal(cnpj.limpar('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.equal(cnpj.mascara('12abc34501de35'), '12.ABC.345/01DE-35');
  assert.equal(cnpj.mascara('11222333000181'), '11.222.333/0001-81');
  for (const [a, b] of [['11', '11'], ['112', '11.2'], ['112223', '11.222.3'], ['112223330', '11.222.333/0'], ['1122233300018', '11.222.333/0001-8']]) assert.equal(cnpj.mascara(a), b);
});

test('Pix com CNPJ alfanumérico', () => {
  assert.ok(r.pixValido('cnpj', '12abc34501de35'));
  assert.ok(!r.pixValido('cnpj', '12ABC34501DE36'));
  assert.equal(r.pixTexto({ pixTipo: 'cnpj', pix: '12abc34501de35' }), '12.ABC.345/01DE-35 (CNPJ)');
  const pend = (c) => r.pendencias({ itens: [] }, { empresa: { cnpj: c }, banco: { pixTipo: 'cnpj', pix: '12ABC34501DE35' }, fim: {} }).filter((x) => x.campo.includes('Pix')).length;
  assert.equal(pend('12.ABC.345/01DE-35'), 0);
  assert.equal(pend('11.222.333/0001-81'), 1);
});

test('PNCP e coletores aceitam os dois formatos', () => {
  assert.deepEqual(interpretarNumeroControle('12ABC34501DE35-1-000026/2026'), { cnpj: '12ABC34501DE35', sequencial: 26, ano: 2026 });
  const reg = (c) => registroPadrao({ source: 'pncp', external_id: 'x', orgao: 'o', orgao_cnpj: c }).orgao_cnpj;
  assert.equal(reg('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.equal(reg('00.394.460/0001-41'), '00394460000141');
  assert.equal(reg('123'), null);
});

test('migração igual ao schema', () => {
  const sql = (f) => readFileSync(new URL(`../supabase/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const m = sql('atualizar-cnpj-alfanumerico.sql');
  const s = sql('schema.sql');
  const funcoes = m.match(/create or replace function[\s\S]*?\$\$;/g);
  assert.equal(funcoes.length, 3);
  for (const f of funcoes) assert.ok(s.includes(f));
});
