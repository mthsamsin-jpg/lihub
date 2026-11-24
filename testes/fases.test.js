// Fases do modo real: etapa do portal x situação da credencial, teste de login e cautela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cautelaInicial, classificarFalhaLogin, etapaAtinge, etapaDoPortal, podeConectar } from '../worker/fases.js';
import { situacaoDosPortais } from '../worker/adaptadores/index.js';
import { CADASTRO_PENDENTE } from '../worker/adaptadores/BllAdapter.js';
import { ErroAdaptador } from '../worker/adaptadores/base.js';
import { criarGerenciador } from '../worker/gerenciador.js';

test('etapas: ordem e compatibilidade com validado: true', () => {
  assert.equal(etapaDoPortal({ validado: true }), 'lances');
  assert.equal(etapaDoPortal({ etapa: 'login' }), 'login');
  assert.equal(etapaDoPortal({}), 'mapeamento');
  assert.ok(etapaAtinge('leitura', 'login'));
  assert.ok(!etapaAtinge('login', 'leitura'));
});

test('BLL: login mapeado, sala e lances ainda não', () => {
  const bll = situacaoDosPortais().bll;
  assert.equal(bll.etapa, 'login');
  assert.equal(bll.validado, false);
  assert.equal(situacaoDosPortais().comprasnet.etapa, 'mapeamento');
});

test('travas: credencial pendente ou bloqueada nunca conecta', () => {
  for (const modo of ['monitorar', 'lances']) {
    assert.equal(podeConectar({ etapaPortal: 'lances', situacaoCredencial: 'aguardando_validacao', modo }).codigo, 'conta_pendente');
    assert.equal(podeConectar({ etapaPortal: 'lances', situacaoCredencial: 'bloqueada', modo }).codigo, 'credencial_bloqueada');
    assert.equal(podeConectar({ etapaPortal: 'lances', situacaoCredencial: 'sem_credencial', modo }).codigo, 'sem_credencial');
  }
});

test('travas: monitorar exige a leitura da sala conferida', () => {
  assert.equal(podeConectar({ etapaPortal: 'login', situacaoCredencial: 'credencial_ok', modo: 'monitorar' }).codigo, 'leitura_nao_validada');
  assert.ok(podeConectar({ etapaPortal: 'leitura', situacaoCredencial: 'nao_testada', modo: 'monitorar' }).ok);
  // Mapeamento em ambiente de teste (ROBO_SELETORES_NAO_VALIDADOS=permitir): só monitorar.
  assert.ok(podeConectar({ etapaPortal: 'login', situacaoCredencial: 'credencial_ok', modo: 'monitorar', permitirNaoValidado: true }).ok);
});

test('travas: lances só com portal liberado E login testado (nem o modo de mapeamento libera)', () => {
  assert.equal(podeConectar({ etapaPortal: 'leitura', situacaoCredencial: 'credencial_ok', modo: 'lances' }).codigo, 'lances_nao_liberados');
  assert.equal(podeConectar({ etapaPortal: 'leitura', situacaoCredencial: 'credencial_ok', modo: 'lances', permitirNaoValidado: true }).codigo, 'lances_nao_liberados');
  assert.equal(podeConectar({ etapaPortal: 'lances', situacaoCredencial: 'nao_testada', modo: 'lances' }).codigo, 'login_nao_testado');
  assert.ok(podeConectar({ etapaPortal: 'lances', situacaoCredencial: 'credencial_ok', modo: 'lances' }).ok);
});

test('falha de login vira situação da conta (rede e tela não mudam nada)', () => {
  assert.equal(classificarFalhaLogin(new ErroAdaptador('x', 'captcha')).situacao, 'bloqueada');
  assert.equal(classificarFalhaLogin(new ErroAdaptador('A BLL informou que o cadastro ainda está em análise.', 'conta_pendente')).situacao, 'aguardando_validacao');
  assert.equal(classificarFalhaLogin(new ErroAdaptador('O portal recusou o login: Cadastro aguardando aprovação', 'login')).situacao, 'aguardando_validacao');
  assert.equal(classificarFalhaLogin(new ErroAdaptador('O portal recusou o login: Senha inválida', 'login')).situacao, 'bloqueada');
  assert.equal(classificarFalhaLogin(new ErroAdaptador('Não consegui confirmar o login', 'login_sem_resposta')), null);
  assert.equal(classificarFalhaLogin(Object.assign(new Error('timeout'), { codigo: 'tempo' })), null);
});

test('BLL: reconhece cadastro pendente sem confundir com processos em análise', () => {
  assert.ok(CADASTRO_PENDENTE.test('Seu cadastro está em análise pela BLL'));
  assert.ok(CADASTRO_PENDENTE.test('Aguardando aprovação do cadastro'));
  assert.ok(CADASTRO_PENDENTE.test('Cadastro não foi homologado'));
  assert.ok(!CADASTRO_PENDENTE.test('Processos em análise: 3 · Meus lotes'));
});

test('cautela: primeiras disputas reais só com itens de valor baixo', () => {
  assert.ok(cautelaInicial({ teto: 100, quantidade: 10, sessoesConcluidas: 0 }).ok);
  assert.equal(cautelaInicial({ teto: 500, quantidade: 10, sessoesConcluidas: 0 }).codigo, 'cautela_inicial');
  assert.ok(cautelaInicial({ teto: 500, quantidade: 10, sessoesConcluidas: 3 }).ok);
  assert.ok(cautelaInicial({ teto: 500, quantidade: 10, sessoesConcluidas: 0, limite: 0 }).ok);
});

// --- Gerenciador com banco e adaptador falsos -----------------------------------
function bancoFalso(credencial) {
  const gravados = [];
  const sessoes = [];
  const from = (tabela) => {
    const q = { tabela, op: 'select', campos: null };
    const b = {
      select: () => b, eq: () => b, is: () => b, order: () => b, limit: () => b,
      update: (campos) => { q.op = 'update'; q.campos = campos; return b; },
      insert: (campos) => { q.op = 'insert'; q.campos = campos; return b; },
      maybeSingle: () => b, single: () => b,
      then: (ok) => {
        if (q.op === 'update' && tabela === 'portal_credentials') { gravados.push(q.campos); Object.assign(credencial || {}, q.campos); }
        if (q.op === 'insert' && tabela === 'robo_sessoes') sessoes.push(q.campos);
        const data = tabela === 'portal_credentials' && q.op === 'select' ? credencial : null;
        return Promise.resolve({ data, error: null, count: 0 }).then(ok);
      },
    };
    return b;
  };
  return { admin: { from }, gravados, sessoes };
}
const cofreFalso = { decifrar: () => ({ tipo: 'senha', login: 'a@b.c', senha: '1234' }) };
const adaptadorFalso = (falha) => () => ({
  abrir: async () => {}, close: async () => {},
  login: async () => { if (falha) throw falha; },
});
const usuario = { id: 'u1', email: 'a@b.c' };

test('teste de login: sucesso marca credencial_ok e respeita o intervalo entre testes', async () => {
  const banco = bancoFalso({ id: 'c1', segredo_cifrado: 'x', situacao: 'nao_testada' });
  const g = criarGerenciador({ admin: banco.admin, cofre: cofreFalso, fabricaAdaptador: adaptadorFalso(null), log: {} });
  const r = await g.testarLogin({ usuario, portal: 'bll' });
  assert.equal(r.ok, true);
  assert.equal(banco.gravados.at(-1).situacao, 'credencial_ok');
  assert.ok(banco.gravados.at(-1).testado_em);
  await assert.rejects(g.testarLogin({ usuario, portal: 'bll' }), (e) => e.codigo === 'teste_recente');
});

test('teste de login: conta pendente marca aguardando_validacao', async () => {
  const banco = bancoFalso({ id: 'c1', segredo_cifrado: 'x', situacao: 'nao_testada' });
  const g = criarGerenciador({ admin: banco.admin, cofre: cofreFalso, fabricaAdaptador: adaptadorFalso(new ErroAdaptador('A BLL informou que o cadastro ainda está em análise.', 'conta_pendente')), log: {} });
  const r = await g.testarLogin({ usuario, portal: 'bll' });
  assert.equal(r.ok, false);
  assert.equal(r.situacao, 'aguardando_validacao');
  assert.equal(banco.gravados.at(-1).situacao, 'aguardando_validacao');
});

test('teste de login: portal sem login mapeado é recusado antes de abrir o navegador', async () => {
  const banco = bancoFalso({ id: 'c1', segredo_cifrado: 'x', situacao: 'nao_testada' });
  const g = criarGerenciador({ admin: banco.admin, cofre: cofreFalso, fabricaAdaptador: () => { throw new Error('não devia abrir'); }, log: {} });
  await assert.rejects(g.testarLogin({ usuario, portal: 'comprasnet' }), (e) => e.codigo === 'login_nao_mapeado');
});

test('conexão: BLL hoje não abre sessão (nem monitorar nem lances) e não cria linha no banco', async () => {
  const item = { id: 'i1', organizacao_id: 'o1', plataforma: 'bll', descricao: 'X', max_price: 10, min_floor_price: 5, quantidade: 1 };
  for (const [situacao, modo, codigo] of [
    ['aguardando_validacao', 'monitorar', 'conta_pendente'],
    ['credencial_ok', 'monitorar', 'leitura_nao_validada'],
    ['credencial_ok', 'lances', 'lances_nao_liberados'],
  ]) {
    const banco = bancoFalso({ id: 'c1', segredo_cifrado: 'x', situacao });
    const g = criarGerenciador({ admin: banco.admin, cofre: cofreFalso, fabricaAdaptador: adaptadorFalso(null), log: {} });
    await assert.rejects(g.iniciar({ usuario, item, pregao: '1/2026', modo }), (e) => e.codigo === codigo, `${situacao}/${modo}`);
    assert.equal(banco.sessoes.length, 0);
  }
});
