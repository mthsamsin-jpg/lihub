// Funções do site (site/js/repo.js) carregadas num contexto de navegador simulado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function carregar() {
  const erros = [];
  const LH = { datas: { paraIso: (d) => d.toISOString().slice(0, 10) }, dados: { licitacao: () => null }, cnpj: { limpar: (v) => v }, MODALIDADES: [[6, 'Pregão - Eletrônico']] };
  const ctx = { console: { error: (...a) => erros.push(a), log() {}, warn() {} }, crypto: globalThis.crypto };
  ctx.window = ctx;
  ctx.LH = LH;
  vm.runInNewContext(readFileSync(new URL('../site/js/repo.js', import.meta.url), 'utf8'), ctx);
  return { ...ctx.LH.repoInterno, erros };
}

test('licitação com valor estimado 0 (PNCP sem valor/sigiloso) vira "sem valor"', () => {
  const { normalizar } = carregar();
  const base = { id: 1, objeto: 'X', data_encerramento_proposta: '2026-12-01T13:00:00Z' };
  assert.equal(normalizar({ ...base, valor_estimado: '0.00' }).valor, null);
  assert.equal(normalizar({ ...base, id: 2, valor_estimado: null }).valor, null);
  assert.equal(normalizar({ ...base, id: 3, valor_estimado: '1500.50' }).valor, 1500.5);
});

test('erroBanco: regra do robô vira mensagem útil e o detalhe vai para o console', () => {
  const { erroBanco, erros } = carregar();
  const e = erroBanco({ code: '23514', message: 'new row for relation "robo_itens" violates check constraint "robo_itens_max_price_check"', details: 'Failing row...' }, 'Não consegui salvar o item');
  assert.equal(e.message, 'O preço teto precisa ser maior que zero.');
  assert.equal(erros.length, 1);
  assert.match(erros[0][0], /\[LicitaHub\] Não consegui salvar o item/);
  assert.equal(erros[0][1].code, '23514');

  assert.match(erroBanco({ code: '23514', message: 'violates check constraint "outra_regra"' }, 'Não consegui salvar o item').message, /fora do permitido/);
  assert.equal(erroBanco({ code: '42501', message: 'rls' }).message, 'Você não tem permissão para fazer isso nesta organização.');
  assert.match(erroBanco({ code: 'XX000', message: 'boom' }, 'Não consegui salvar o item').message, /Tente de novo em instantes/);
});
