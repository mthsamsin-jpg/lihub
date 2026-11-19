// Extensão do Chrome (extensao-chrome/): regras de conferência, manifesto e adaptadores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// listas criadas dentro do vm são de outro "realm": copia antes de comparar
const local = (v) => JSON.parse(JSON.stringify(v));
const ler = (p) => readFileSync(new URL(`../extensao-chrome/${p}`, import.meta.url), 'utf8');
function carregar(...arquivos) {
  const ctx = { URL, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const a of arquivos) vm.runInContext(ler(a), ctx, { filename: a });
  return ctx.LHX;
}
const LHX = carregar('src/compartilhado/conferencia.js');

test('números no formato brasileiro e comparação até a última casa', () => {
  assert.equal(LHX.lerNumero('1.234,56'), 1234.56);
  assert.equal(LHX.lerNumero('R$ 10,5'), 10.5);
  assert.equal(LHX.lerNumero('1234.56'), 1234.56);
  assert.equal(LHX.lerNumero('1.234.567'), 1234567);
  assert.equal(LHX.lerNumero(''), null);
  assert.equal(LHX.formatarValor(1234.5), '1234,50');
  assert.equal(LHX.formatarValor(0.12345, 4), '0,1235');
  assert.equal(LHX.mesmoValor('1.234,50', 1234.5), true);
  assert.equal(LHX.mesmoValor('123,45', 1234.5), false, 'vírgula no lugar errado é pega');
});

test('semelhança de descrições ignora acento, caixa e palavras vazias', () => {
  assert.ok(LHX.semelhanca('Caneta esferográfica azul', 'CANETA ESFEROGRAFICA, COR AZUL, PONTA MÉDIA') >= 0.99);
  assert.ok(LHX.semelhanca('Papel A4 75g', 'Toner HP 85A') < LHX.LIMIAR_DESCRICAO);
});

const campo = (atual = '') => ({ atual });
const ITENS = [
  { numero: 1, descricao: 'Caneta esferográfica azul', quantidade: 100, unidade: 'UN', unitario: 1.2, marca: 'BIC' },
  { numero: 2, descricao: 'Papel A4 75g resma', quantidade: 50, unidade: 'RESMA', unitario: 25.9, marca: 'Chamex' },
  { numero: 3, descricao: 'Grampeador', quantidade: 5, unidade: 'UN', unitario: 0, marca: '' },
  { numero: 4, descricao: 'Toner HP 85A', quantidade: 2, unidade: 'UN', unitario: 300, marca: 'HP' },
];

test('planejar: casa por número, confere quantidade/unidade e não preenche às cegas', () => {
  const linhas = [
    { numero: '01', descricao: 'CANETA ESFEROGRÁFICA AZUL', quantidade: '100', unidade: 'UN', campos: { unitario: campo(), marca: campo() } },
    { numero: '2', descricao: 'Papel A4 75g resma', quantidade: '40', unidade: 'RESMA', campos: { unitario: campo('25,90'), marca: campo('Report') } },
    { numero: '3', descricao: 'Grampeador 26/6', quantidade: '5', unidade: 'UN', campos: { unitario: campo() } },
  ];
  const plano = LHX.planejar(ITENS, linhas);
  const [p1, p2, p3, p4] = plano;

  assert.equal(p1.status, 'preenchido');
  assert.deepEqual(local(p1.acoes.map((a) => [a.campo, a.valor])), [['unitario', '1,20'], ['marca', 'BIC']]);

  assert.equal(p2.status, 'conferir');
  assert.equal(p2.acoes.length, 0, 'valor já certo; marca diferente não é sobrescrita');
  assert.ok(p2.avisos.some((a) => /Quantidade diferente/.test(a)));
  assert.ok(p2.avisos.some((a) => /já tem "Report"/.test(a)));

  assert.equal(p3.status, 'conferir');
  assert.equal(p3.acoes.length, 0, 'valor zero na proposta não é escrito');

  assert.equal(p4.status, 'nao_encontrado');

  const comSobrescrever = LHX.planejar(ITENS, linhas, { sobrescrever: true })[1];
  assert.deepEqual(local(comSobrescrever.acoes.map((a) => [a.campo, a.valor])), [['marca', 'Chamex']]);
});

test('planejar: sem o número, acha pela descrição e avisa; descrição diferente vira "conferir"', () => {
  const linhas = [
    { numero: '7', descricao: 'TONER HP 85A ORIGINAL', campos: { unitario: campo() } },
    { numero: '1', descricao: 'Lápis preto nº 2', campos: { unitario: campo() } },
  ];
  const [caneta, , , toner] = LHX.planejar(ITENS, linhas);
  assert.equal(toner.status, 'conferir');
  assert.match(toner.avisos[0], /pela descrição/);
  assert.equal(toner.acoes[0].valor, '300,00');
  assert.equal(caneta.status, 'conferir', 'item 1 da tela é outro produto');
  assert.ok(caneta.avisos.some((a) => /descrição da tela é bem diferente/.test(a)));
  assert.equal(LHX.planejar(ITENS, linhas, { casas: 4 })[0].acoes[0].valor, '1,2000');
});

test('manifesto MV3 com permissões mínimas (sem acesso a todos os sites)', () => {
  const m = JSON.parse(ler('manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.type, 'module');
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'scripting', 'storage']);
  assert.ok(!m.host_permissions.some((h) => /<all_urls>|^\*:\/\/\*\/|^https:\/\/\*\/\*$/.test(h)));
  assert.equal(m.content_scripts, undefined, 'scripts só entram na aba quando a pessoa clica');
  const popup = ler('src/popup/popup.js');
  for (const arq of JSON.parse(`[${/ARQUIVOS_DA_PAGINA = \[([\s\S]*?)\]/.exec(popup)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`)) {
    assert.ok(ler(arq).length > 0, `${arq} existe`);
  }
});

test('adaptadores: cada portal reconhece só o próprio endereço; injeção repetida não duplica', () => {
  const arquivos = ['src/compartilhado/conferencia.js', 'src/content/adaptadores/base.js', 'src/content/adaptadores/comprasnet.js', 'src/content/adaptadores/bll.js'];
  const ctx = { URL, console };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (let vez = 0; vez < 2; vez++) for (const a of arquivos) vm.runInContext(ler(a), ctx, { filename: a });
  const ads = ctx.LHX.adaptadores;
  assert.deepEqual(local(ads.map((a) => a.id)), ['comprasnet', 'bll']);
  const dono = (url) => ads.find((a) => a.reconhece(url))?.id ?? null;
  assert.equal(dono('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/seguro/fornecedor/proposta'), 'comprasnet');
  assert.equal(dono('https://www.gov.br/compras/pt-br'), null);
  assert.equal(dono('https://bllcompras.com/Process/ProcessView'), 'bll');
  assert.equal(dono('https://bllcompras.com.golpe.net/'), null);
  const [cn] = ads;
  assert.ok(cn.pistas.unitario.test('Valor unitário (R$)'));
  assert.ok(cn.pistas.marca.test('Fabricante'));
  assert.equal(cn.casas, 4);
});
