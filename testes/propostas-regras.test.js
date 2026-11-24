// Regras da proposta: declarações, snapshot da empresa, duplicação, numeração e centavos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
ctx.window = ctx;
vm.runInNewContext(readFileSync(new URL('../site/js/propostas-regras.js', import.meta.url), 'utf8'), ctx);
const r = ctx.LH.propostasRegras;
const igual = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const ativas = (l) => l.filter((d) => d.ativo).map((d) => d.id);
const ORIGINAIS = ['ciencia', 'exigencias', 'custos', 'validade', 'pagamento'];

test('proposta nova: ME/EPP desmarcada para qualquer porte ou regime', () => {
  for (const porte of ['MEI', 'ME', 'EPP', 'Demais']) {
    const lista = r.declaracoesDe({ empresaId: 'e', extras: { empresa: { id: 'e', razao: 'X', porte, regime: 'Simples Nacional' } } });
    assert.ok(!ativas(lista).includes('meepp'), porte);
    assert.equal(ativas(lista).length, 10);
  }
});

test('proposta antiga: declarações novas entram desmarcadas e as salvas não mudam', () => {
  const salvas = ORIGINAIS.map((id) => ({ id, titulo: id, texto: `texto ${id}`, ativo: id !== 'custos' }));
  const lista = r.declaracoesDe({ id: 'p1', extras: { declaracoes: salvas } });
  igual(ativas(lista), ['ciencia', 'exigencias', 'validade', 'pagamento']);
  assert.equal(lista.find((d) => d.id === 'ciencia').texto, 'texto ciencia');
  // Anterior às declarações editáveis: só a de custos, que já saía no documento.
  igual(ativas(r.declaracoesDe({ id: 'p0', extras: {} })), ['custos']);
});

test('ME/EPP marcada à mão continua marcada ao reabrir', () => {
  const lista = r.declaracoesDe({ id: 'p', extras: { declaracoes: [{ id: 'meepp', titulo: 'ME', texto: 't', ativo: true }] } });
  igual(ativas(lista), ['meepp']);
});

test('textos legais: artigos certos, sem marcador sobrando e iguais nos dois geradores', () => {
  const artigos = { habilitacao: 'art. 63, inciso I,', impeditivo: 'art. 14 da', menor: 'art. 68, inciso VI', reserva: 'art. 63, inciso IV', trabalhistas: 'art. 63, § 1º', meepp: 'art. 4º, § 2º' };
  const padrao = r.declaracoesPadrao();
  for (const d of r.LEGAIS) {
    const texto = padrao.find((x) => x.id === d.id).texto;
    assert.ok(texto.includes(artigos[d.id]), d.id);
    assert.ok(!/TODO|\{porte\}/.test(texto), d.id);
    assert.equal(texto, r.textoLegal(d, 'A proponente declara'));
  }
  assert.match(r.textoLegal(r.LEGAIS.find((d) => d.id === 'meepp'), 'DECLARA', 'EPP'), /enquadra como empresa de pequeno porte,/);
});

test('snapshot: mudar ou excluir a empresa não altera a proposta salva', () => {
  const cadastro = [{ id: 'a', razao: 'ANTIGA LTDA', banco: 'Banco 1', logo: 'data:x' }, { id: 'b', razao: 'OUTRA LTDA' }];
  const salva = { id: 'p', empresaId: 'a', extras: { empresa: r.snapshotEmpresa(cadastro[0]) } };
  cadastro[0].razao = 'NOVA LTDA';
  cadastro[0].banco = 'Banco 2';
  assert.equal(r.empresaDe(salva, cadastro).razao, 'ANTIGA LTDA');
  assert.equal(r.empresaDe(salva, cadastro).banco, 'Banco 1');
  assert.equal(r.empresaDe({ ...salva, empresaId: null }, [cadastro[1]]).razao, 'ANTIGA LTDA');
  // Escolher outra empresa troca os dados; sem empresa, nunca usa a de outra.
  assert.equal(r.empresaDe({ ...salva, empresaId: 'b' }, cadastro).razao, 'OUTRA LTDA');
  assert.equal(r.empresaDe({ id: 'q', empresaId: 'excluida' }, cadastro).razao, '');
  assert.equal(r.empresaDe({ id: 'q', empresaId: null }, cadastro).razao, '');
});

test('duplicar: data de hoje, novo número, rascunho, ME/EPP desmarcada e original intacta', () => {
  const original = { id: 'p', numero: 'PROP-2026-001', status: 'Enviada', criada: '2026-01-02', empresaId: 'a', itens: [],
    extras: { fechamento: { data: '2026-01-02', cidade: 'Campinas/SP' }, declaracoes: [{ id: 'meepp', ativo: true, texto: 't', titulo: 'ME' }], empresa: { id: 'a', razao: 'ANTIGA' } } };
  const antes = JSON.stringify(original);
  const c = r.duplicar(original, { numero: 'PROP-2026-009', hoje: '2026-11-24', empresas: [{ id: 'a', razao: 'ATUAL' }] });
  assert.equal(c.extras.fechamento.data, '2026-11-24');
  assert.equal(c.extras.fechamento.cidade, 'Campinas/SP');
  igual([c.id, c.criada, c.numero, c.status].map((x) => x ?? null), [null, null, 'PROP-2026-009', 'Rascunho']);
  igual(ativas(c.extras.declaracoes), []);
  assert.equal(c.extras.empresa.razao, 'ATUAL');
  assert.equal(JSON.stringify(original), antes);
  // Empresa excluída: a cópia mantém os dados salvos.
  assert.equal(r.duplicar(original, { numero: 'n', hoje: 'h', empresas: [] }).extras.empresa.razao, 'ANTIGA');
});

test('numeração (demonstração): não repete depois de excluir', () => {
  const n = r.proximoNumero(['PROP-2026-001', 'PROP-2026-003', 'PROP-2025-050', 'LIVRE'], 2026);
  assert.equal(n.numero, 'PROP-2026-004');
  assert.equal(r.proximoNumero(['PROP-2026-001'], 2026, n.ultimo).numero, 'PROP-2026-005');
  assert.equal(r.proximoNumero([], 2026, 999).numero, 'PROP-2026-1000');
});

test('centavos: o total é a soma exata das linhas exibidas', () => {
  assert.equal(r.totalLinha({ quantidade: 1, unitario: 1.005 }), 1.01);
  assert.equal(r.totalLinha({ quantidade: 3, unitario: 0.335 }), 1.01);
  assert.equal(r.totalProposta([{ quantidade: 1, unitario: 0.1 }, { quantidade: 1, unitario: 0.2 }]), 0.3);
  // 3 × 0,004 = 0,00 por linha: o total não pode mostrar 0,01.
  assert.equal(r.totalProposta(Array(3).fill({ quantidade: 1, unitario: 0.004 })), 0);
  const itens = Array.from({ length: 200 }, (_, k) => ({ quantidade: k + 0.5, unitario: 3.3333 + k / 7 }));
  const soma = itens.reduce((s, it) => s + BigInt(r.totalLinha(it).toFixed(2).replace('.', '')), 0n);
  assert.equal(r.totalProposta(itens).toFixed(2).replace('.', ''), soma.toString());
});
