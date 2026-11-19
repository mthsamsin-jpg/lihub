// Pirâmide de relevância da busca, versão do site (LH.termos.camada): mesmas regras
// da função buscar_licitacoes do banco (testada em schema.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function carregarTermos() {
  const nada = () => {};
  const ctx = { console, document: { addEventListener: nada, querySelector: () => null }, LH: { esc: String, icone: () => '', fmt: {} } };
  ctx.window = { addEventListener: nada, LH: ctx.LH };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../site/js/componentes.js', import.meta.url), 'utf8'), ctx);
  return ctx.LH.termos;
}
const T = carregarTermos();
const camada = (objeto, termo, secundario = '') => T.camada({ objeto, secundario }, T.grupos(termo)).camada;

test('radical leve: plural/singular sem juntar palavras diferentes', () => {
  assert.equal(T.radical('copos'), 'copo');
  assert.equal(T.radical('descartaveis'), 'descartave');
  assert.equal(T.radical('descartavel'), 'descartave');
  assert.equal(T.radical('papeis'), 'pape');
  assert.equal(T.radical('papel'), 'pape');
  assert.equal(T.radical('impressores'), 'impressor');
  assert.equal(T.radical('a4'), 'a4');
});

test('camadas para "copo descartável"', () => {
  const termo = 'copo descartável';
  assert.equal(camada('Aquisição de COPOS DESCARTÁVEIS 200 ml', termo), 1, 'frase (plural, caixa alta, acento)');
  assert.equal(camada('Copo para água descartável', termo), 1, 'todas as palavras no objeto');
  assert.equal(camada('Aquisição de copos de vidro', termo), 2, 'termo principal');
  assert.equal(camada('Material de copa e cozinha', termo, 'copo descartavel 180ml'), 2, 'todas só nos itens');
  assert.equal(camada('Pratos e talheres descartáveis', termo), 3, 'só a palavra secundária');
  assert.equal(camada('Canecas de porcelana', termo), 3, 'termo relacionado (caneca)');
  assert.equal(camada('Material de copa e cozinha', termo), 4, '"copo" não casa "copa"');
  assert.equal(camada('Qualquer coisa', ''), 0, 'sem termo = ordem normal');
  assert.equal(camada('Manutenção de ar condicionado', 'manutenção de ar condicionado'), 1, 'palavras vazias ignoradas');
});

test('vírgula: vale a melhor camada entre as alternativas', () => {
  assert.equal(camada('Toner HP 85A', 'papel a4, toner'), 1);
  assert.equal(camada('Resma de sulfite', 'papel a4, toner'), 3, 'correlato de papel');
});
