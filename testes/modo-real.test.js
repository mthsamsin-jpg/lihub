// Modo real do Robô Turbo 2.0: cofre de credenciais, adaptadores e a sessão
// (com um adaptador FALSO no lugar do Playwright: nenhum portal é acessado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarCofre, gerarChave, mascararLogin, validarCertificado, ErroCofre } from '../src/cofre.js';
import { lerReais, lerFase, lerPorte, lerCronometro, reaisParaCampo, AdaptadorPorSeletores } from '../worker/adaptadores/playwright.js';
import { SELETORES, camposPendentes } from '../worker/adaptadores/seletores.js';
import { criarAdaptador, situacaoDosPortais } from '../worker/adaptadores/index.js';
import { BllAdapter } from '../worker/adaptadores/BllAdapter.js';
import { SalaReal, SessaoReal } from '../worker/sessao.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('cofre: cifra e abre; recusa texto alterado, outra chave, outro dono ou outro portal', () => {
  const cofre = criarCofre(gerarChave());
  const dono = { dono: 'u1', portal: 'bll' };
  const cifrado = cofre.cifrar({ login: 'ana', senha: 's3nh@' }, dono);
  assert.match(cifrado, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  assert.ok(!cifrado.includes('s3nh@'));
  assert.deepEqual(cofre.decifrar(cifrado, dono), { login: 'ana', senha: 's3nh@' });
  assert.notEqual(cofre.cifrar({ a: 1 }, dono), cofre.cifrar({ a: 1 }, dono), 'IV novo a cada vez');

  const [v, iv, tag, dados] = cifrado.split('.');
  const alterado = [v, iv, tag, Buffer.from(Buffer.from(dados, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64')].join('.');
  assert.throws(() => cofre.decifrar(alterado, dono), ErroCofre);
  assert.throws(() => criarCofre(gerarChave()).decifrar(cifrado, dono), /não consegui abrir/i);
  assert.throws(() => cofre.decifrar(cifrado, { dono: 'u2', portal: 'bll' }), ErroCofre);
  assert.throws(() => cofre.decifrar(cifrado, { dono: 'u1', portal: 'comprasnet' }), ErroCofre);
  assert.throws(() => criarCofre('curta'), /32 bytes/);
});

test('cofre: máscara do login e certificado inválido', () => {
  assert.equal(mascararLogin('123.456.789-09'), '123.***.***-09');
  assert.equal(mascararLogin('12345678000199'), '12.***.***/****-99');
  assert.equal(mascararLogin('joao@empresa.com'), 'jo***@empresa.com');
  assert.equal(mascararLogin(''), null);
  assert.throws(() => validarCertificado(Buffer.from('isto não é um pfx'), 'x'), ErroCofre);
});

test('adaptador: leitura de valores, fases, porte e cronômetro', () => {
  assert.equal(lerReais('R$ 1.234,56'), 1234.56);
  assert.equal(lerReais('4890'), 4890);
  assert.equal(lerReais('—'), null);
  assert.equal(reaisParaCampo(1234.5), '1234,50');
  const fases = SELETORES.bll.sala.fases;
  assert.equal(lerFase('Em prorrogação automática', fases), 'prorrogacao');
  assert.equal(lerFase('Disputa aberta', fases), 'aberta');
  assert.equal(lerFase('Negociação com o pregoeiro', fases), 'negociacao');
  assert.equal(lerPorte('Fornecedor X - EPP'), 'epp');
  assert.equal(lerPorte('ME'), 'me');
  assert.equal(lerPorte('LTDA'), 'demais');
  assert.equal(lerCronometro('Tempo restante 01:30'), 90_000);
});

test('adaptadores: BLL tem classe própria; nenhum portal está validado e o envio de lance fica travado', async () => {
  assert.ok(criarAdaptador('bll', { credencial: {} }) instanceof BllAdapter);
  assert.ok(criarAdaptador('licitanet', { credencial: {} }) instanceof AdaptadorPorSeletores);
  const s = situacaoDosPortais();
  assert.equal(s.bll.adaptador, 'BllAdapter');
  assert.ok(Object.values(s).every((p) => p.validado === false));
  assert.ok(camposPendentes(SELETORES.bll).includes('sala.linhaLance'));
  const a = new BllAdapter({ credencial: { tipo: 'senha', login: 'x', senha: 'y' }, carregarPlaywright: async () => { throw new Error('não deve abrir navegador'); } });
  await assert.rejects(a.placeBid(100), (e) => e.codigo === 'seletores_pendentes');
  await assert.rejects(a.joinAuctionRoom({ pregao: '1' }), (e) => e.codigo === 'seletores_pendentes');
});

test('SalaReal: trava de novo antes do placeBid e não envia no modo monitorar', async () => {
  const enviados = [];
  const adaptador = { placeBid: async (v) => { enviados.push(v); } };
  const monitor = new SalaReal({ adaptador, piso: 90, teto: 100, modo: 'monitorar' });
  await assert.rejects(monitor.enviarLance(95), (e) => e.codigo === 'somente_monitorar');
  const lances = new SalaReal({ adaptador, piso: 90, teto: 100, modo: 'lances' });
  await assert.rejects(lances.enviarLance(89.99), (e) => e.codigo === 'trava');
  await assert.rejects(lances.enviarLance(100.01), (e) => e.codigo === 'trava');
  await lances.enviarLance(90);
  assert.deepEqual(enviados, [90]);
});

/** Adaptador falso: a "sala" é controlada pelo teste. */
function adaptadorFalso({ inicial = { fase: 'aberta', lances: [], mensagens: [] }, recusar = false } = {}) {
  const a = {
    portal: 'bll', enviados: [], callback: null, fechado: false,
    abrir: async () => {}, login: async () => {}, joinAuctionRoom: async () => {},
    lerSala: async () => inicial,
    watchBids(cb) { a.callback = cb; return () => { a.callback = null; }; },
    async placeBid(v) {
      if (recusar) throw Object.assign(new Error('recusado'), { codigo: 'lance' });
      a.enviados.push(v);
      setTimeout(() => a.callback?.({ tipo: 'lance', valor: v, autor: 'nos', nosso: true, porte: 'demais' }), 0);
    },
    close: async () => { a.fechado = true; },
    emitir: (ev) => a.callback?.(ev),
  };
  return a;
}

function sessaoFalsa(adaptador, modo, item = {}) {
  const eventos = []; const sessao = []; const itemAtual = {};
  const s = new SessaoReal({
    sessao: { id: 's1', modo, pregao_ref: '90012/2026', lote_ref: '1' },
    item: { piso: 90, teto: 100, custo: 80, decremento: 0.01, intervaloSeg: 0, nossoPorte: 'demais', fugirEmpate: false, ...item },
    adaptador,
    gravar: async (ev) => { eventos.push(ev); },
    atualizarSessao: async (c) => { sessao.push(c.status); },
    atualizarItem: async (c) => { Object.assign(itemAtual, c); },
    log: { erro() {}, info() {} },
  });
  return { s, eventos, sessao, itemAtual };
}

test('SessaoReal (monitorar): transmite lances e fases e não envia nada', async () => {
  const a = adaptadorFalso();
  const { s, eventos, sessao, itemAtual } = sessaoFalsa(a, 'monitorar');
  await s.iniciar();
  a.emitir({ tipo: 'lance', valor: 98, autor: 'F2', porte: 'me' });
  a.emitir({ tipo: 'fase', fase: 'prorrogacao' });
  a.emitir({ tipo: 'mensagem', autor: 'Pregoeiro', texto: 'Boa tarde' });
  await esperar(20);
  assert.deepEqual(a.enviados, []);
  assert.deepEqual(sessao, ['iniciando', 'conectado']);
  assert.ok(eventos.some((e) => e.tipo === 'lance' && e.valor === 98 && e.porte === 'me'));
  assert.ok(eventos.some((e) => e.tipo === 'fase' && e.fase === 'prorrogacao'));
  assert.ok(eventos.some((e) => e.tipo === 'mensagem' && e.texto === 'Boa tarde'));
  assert.equal(itemAtual.melhor_lance, 98);
  await s.encerrar();
  assert.ok(a.fechado);
  assert.equal(sessao.at(-1), 'encerrada');
});

test('SessaoReal (lances): cobre por centavos, nunca fura o piso e para com "Preço mínimo atingido"', async () => {
  const a = adaptadorFalso({ inicial: { fase: 'aberta', lances: [{ valor: 99, autor: 'F2', porte: 'demais', nosso: false }], mensagens: [] } });
  const { s, eventos, itemAtual } = sessaoFalsa(a, 'lances');
  await s.iniciar();
  await esperar(10);
  assert.deepEqual(a.enviados, [98.99], 'cobre o lance que já estava na sala');
  a.emitir({ tipo: 'lance', valor: 95, autor: 'F5', porte: 'me' });
  await esperar(10);
  a.emitir({ tipo: 'lance', valor: 89.5, autor: 'F2', porte: 'demais' });
  await esperar(10);
  assert.deepEqual(a.enviados, [98.99, 94.99]);
  assert.ok(a.enviados.every((v) => v >= 90 && v <= 100));
  assert.equal(itemAtual.bid_status, 'stopped_at_floor');
  assert.ok(eventos.some((e) => e.tipo === 'alerta' && /Preço mínimo atingido/.test(e.texto)));
  await s.encerrar();
  assert.equal(itemAtual.bid_status, 'stopped_at_floor', 'continua marcado depois de encerrar');
});

test('SessaoReal: falha no login vira erro na sessão e fecha o navegador', async () => {
  const a = adaptadorFalso();
  a.login = async () => { throw new Error('O portal recusou o login: senha inválida'); };
  const { s, eventos, sessao } = sessaoFalsa(a, 'monitorar');
  await s.iniciar();
  assert.equal(sessao.at(-1), 'erro');
  assert.ok(a.fechado);
  assert.ok(eventos.some((e) => e.tipo === 'alerta' && /senha inválida/.test(e.texto)));
});

test('SessaoReal: lance recusado pelo portal (praça mudou) não derruba a sessão', async () => {
  const a = adaptadorFalso({ inicial: { fase: 'aberta', lances: [{ valor: 99, autor: 'F2', porte: 'demais', nosso: false }], mensagens: [] } });
  let recusar = true;
  const enviarOriginal = a.placeBid;
  a.placeBid = async (v) => {
    if (recusar) { recusar = false; throw Object.assign(new Error('O portal recusou o lance: Lance deve ser menor que o melhor lance'), { codigo: 'lance' }); }
    return enviarOriginal(v);
  };
  const { s, eventos, sessao } = sessaoFalsa(a, 'lances');
  await s.iniciar();
  await esperar(10);
  assert.deepEqual(a.enviados, [], 'o primeiro foi recusado');
  assert.equal(sessao.at(-1), 'conectado', 'a sessão continua');
  assert.ok(eventos.some((e) => e.tipo === 'status' && /recusou o lance/.test(e.texto)));
  a.emitir({ tipo: 'lance', valor: 97, autor: 'F5', porte: 'me' });
  await esperar(10);
  assert.deepEqual(a.enviados, [96.99], 'cobre a praça nova');
  await s.encerrar();
});
