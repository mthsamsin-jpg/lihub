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

test('conferência: proposta completa não tem pendências', () => {
  const e = { id: 'a', razao: 'X', cnpj: '1', endereco: 'Rua' };
  const p = { licitacao: { orgao: 'O', numero: '1', objeto: 'Obj', abertura: '2026-12-10', hora: '09:00', limite: '2026-12-10', horaLimite: '09:00' },
    itens: [{ numero: '1', descricao: 'd', quantidade: 1, unitario: 2 }] };
  const ok = { empresa: e, banco: { banco: 'b', agencia: '1', conta: '2' }, fim: { cidade: 'c', representante: 'r', cpf: '529.982.247-25' } };
  igual(r.pendencias(p, ok), []);
  // Cada problema aparece sozinho.
  const campos = (mudaP, mudaC) => r.pendencias({ ...p, ...mudaP }, { ...ok, ...mudaC }).map((x) => x.campo);
  for (const k of ['orgao', 'numero', 'objeto']) assert.equal(campos({ licitacao: { ...p.licitacao, [k]: ' ' } }).length, 1, k);
  for (const k of ['razao', 'cnpj', 'endereco']) assert.equal(campos({}, { empresa: { ...e, [k]: '' } }).length, 1, k);
  for (const k of ['cidade', 'representante', 'cpf']) assert.equal(campos({}, { fim: { ...ok.fim, [k]: '' } }).length, 1, k);
  igual(campos({}, { fim: { ...ok.fim, cpf: '111.111.111-11' } }), ['CPF do representante inválido']);
  igual(campos({ licitacao: { ...p.licitacao, horaLimite: '09:01' } }), ['Envio das propostas depois da abertura da sessão']);
  igual(campos({ itens: [...p.itens, { numero: '2', descricao: '', quantidade: 0, unitario: 0 }] }), ['Sem descrição: item 2', 'Sem quantidade: item 2', 'Sem valor unitário: item 2']);
  igual(campos({ itens: [p.itens[0], p.itens[0]] }), ['Número de item repetido']);
  assert.equal(campos({}, { banco: { banco: 'b', agencia: '', conta: '2' } }).length, 1);
});

test('banco: tipo de conta e Pix; proposta antiga continua como conta corrente, sem Pix', () => {
  const e = { banco: 'B', agencia: '1', conta: '2', tipoConta: 'Conta poupança', pixTipo: 'cnpj', pix: '11222333000181' };
  assert.equal(r.bancoDe({}, e).tipoConta, 'Conta poupança');
  const antiga = r.bancoDe({ extras: { banco: { origem: 'proposta', banco: 'X', agencia: '3', conta: '4' } } }, e);
  igual(antiga, { banco: 'X', agencia: '3', conta: '4', tipoConta: 'Conta corrente', pixTipo: '', pix: '' });
  assert.equal(r.pixTexto(antiga), '');
  igual([r.snapshotEmpresa(e).tipoConta, r.snapshotEmpresa(e).pix], ['Conta poupança', '11222333000181']);
  assert.equal(r.pixTexto(e), '11.222.333/0001-81 (CNPJ)');
  assert.equal(r.pixTexto({ pixTipo: 'telefone', pix: '+55 19 98888-7777' }), '(19) 98888-7777 (Telefone)');
  assert.equal(r.pixTexto({ pixTipo: 'cpf', pix: '52998224725' }), '529.982.247-25 (CPF)');
});

test('Pix: formato por tipo e pendências', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  for (const [t, v] of [['cnpj', '11.222.333/0001-81'], ['cpf', '529.982.247-25'], ['email', 'a@exemplo.invalid'], ['telefone', '(19) 98888-7777'], ['aleatoria', uuid]]) assert.ok(r.pixValido(t, v), t);
  for (const [t, v] of [['cnpj', '11222333000180'], ['cpf', '52998224724'], ['email', 'a@b'], ['telefone', '123'], ['telefone', 'x19988887777'], ['aleatoria', 'abc'], ['', uuid], ['cpf', '']]) assert.ok(!r.pixValido(t, v), t + v);
  const campos = (pix, cnpj = '11.222.333/0001-81') => r.pendencias({ itens: [] }, { empresa: { cnpj }, banco: pix, fim: {} }).map((x) => x.campo).filter((c) => c.includes('Pix'));
  igual(campos({}), []);
  igual(campos({ pixTipo: 'cnpj', pix: '11222333000181' }), []);
  igual(campos({ pixTipo: 'cnpj', pix: '' }), ['Chave Pix']);
  igual(campos({ pixTipo: 'cpf', pix: '1' }), ['Chave Pix inválida para o tipo escolhido']);
  igual(campos({ pixTipo: 'cnpj', pix: '11222333000181' }, '11444777000161'), ['Chave Pix com CNPJ diferente do da empresa']);
});

test('CPF e validade', () => {
  assert.ok(r.cpfValido('52998224725'));
  for (const c of ['', '123', '529.982.247-24', '00000000000']) assert.ok(!r.cpfValido(c), c);
  for (const v of ['1', 60, '365']) assert.ok(r.validadeOk(v), String(v));
  for (const v of ['', '0', '366', '10,5', 'abc', '-3']) assert.ok(!r.validadeOk(v), v);
});
