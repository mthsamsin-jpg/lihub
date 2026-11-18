// Robô de lances: cobertura por centavos e a trava do piso (nunca abaixo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidir, validarLimites, Disputa, SalaSimulada, STATUS, FASES, preferenciaLC123 } from '../src/robo/motor.js';

const base = { piso: 90, teto: 100, decremento: 0.01 };

test('decidir: entra com o teto, cobre por centavos e aguarda quando vence', () => {
  assert.deepEqual(decidir({ ...base }), { acao: 'lance', valor: 100 });
  assert.deepEqual(decidir({ ...base, melhorConcorrente: 95.5, nossoLance: 100 }), { acao: 'lance', valor: 95.49 });
  assert.equal(decidir({ ...base, melhorConcorrente: 95.5, nossoLance: 95.49 }).acao, 'aguardar');
  assert.deepEqual(decidir({ ...base, melhorConcorrente: 120 }), { acao: 'lance', valor: 100 }, 'nunca acima do teto');
  // 0,1 + 0,2: sem erro de arredondamento
  assert.deepEqual(decidir({ piso: 0.1, teto: 1, decremento: 0.1, melhorConcorrente: 0.3, nossoLance: 0.4 }), { acao: 'lance', valor: 0.2 });
});

test('decidir: TRAVA do piso', () => {
  // cobrir exigiria 89,99 e o piso (90) empata com a praça: para
  assert.deepEqual(decidir({ ...base, melhorConcorrente: 90, nossoLance: 91 }), { acao: 'parar', motivo: 'piso' });
  // cobrir por 0,05 daria 89,96: o piso (90) ainda cobre 90,01 -> lance exatamente no piso
  assert.deepEqual(decidir({ ...base, decremento: 0.05, melhorConcorrente: 90.01, nossoLance: 92 }), { acao: 'lance', valor: 90 });
  // já estamos no piso e o concorrente desceu abaixo: para
  assert.deepEqual(decidir({ ...base, melhorConcorrente: 89.5, nossoLance: 90 }), { acao: 'parar', motivo: 'piso' });
  // milhares de praças aleatórias: nenhum lance abaixo do piso nem acima do teto
  for (let i = 0; i < 5000; i++) {
    const piso = 10 + Math.random() * 500; const teto = piso + Math.random() * 500;
    const d = decidir({ piso, teto, decremento: 0.01 + Math.random(), melhorConcorrente: Math.random() * 1200, nossoLance: Math.random() < 0.3 ? null : Math.random() * 1200 });
    if (d.acao === 'lance') assert.ok(d.valor >= Math.round(piso * 100) / 100 && d.valor <= Math.round(teto * 100) / 100, JSON.stringify({ piso, teto, d }));
  }
});

test('validarLimites', () => {
  assert.deepEqual(validarLimites({ teto: 100, custo: 70, piso: 80 }), []);
  assert.match(validarLimites({ teto: 100, custo: 70, piso: 120 })[0], /maior que o preço teto/);
  assert.match(validarLimites({ teto: 100, custo: 85, piso: 80 })[0], /abaixo do custo/);
  assert.throws(() => new Disputa({ sala: {}, teto: 100, piso: 0 }), /mínimo de segurança/);
});

test('Disputa: cobre os concorrentes e para no piso com alerta', async () => {
  const enviados = []; const alertas = []; const status = [];
  const sala = new SalaSimulada({
    inicial: 100,
    eventos: [
      { tipo: 'lance', valor: 98, autor: 'F2' },
      { tipo: 'mensagem', autor: 'Pregoeiro', texto: 'Boa tarde' },
      { tipo: 'lance', valor: 95, autor: 'F5' },
      { tipo: 'lance', valor: 90.5, autor: 'F2' },
      { tipo: 'lance', valor: 89.9, autor: 'F5' },
      { tipo: 'lance', valor: 50, autor: 'F2' }, // lido só para acompanhar: o robô já parou no piso
    ],
  });
  const original = sala.enviarLance.bind(sala);
  sala.enviarLance = async (v) => { enviados.push(v); return original(v); };
  const d = new Disputa({ sala, ...base, aoAlerta: (t) => alertas.push(t), aoStatus: (s) => status.push(s) });
  await d.iniciar();
  assert.deepEqual(enviados, [100, 97.99, 94.99, 90.49]);
  assert.ok(enviados.every((v) => v >= base.piso));
  assert.equal(d.status, STATUS.PISO);
  assert.equal(alertas.length, 1);
  assert.match(alertas[0], /abaixo do piso/);
  assert.deepEqual(status, [STATUS.ATIVO, STATUS.PISO]);
});

test('Disputa: pausa não dá lances e o piso pode ser mudado durante a disputa', async () => {
  const enviados = [];
  const sala = { enviarLance: async (v) => { enviados.push(v); }, proximoEvento: async () => ({ tipo: 'encerrada' }) };
  const d = new Disputa({ sala, ...base, nossoLance: 99 });
  d.status = STATUS.PAUSADO;
  d.melhorConcorrente = 95;
  await d.avaliar();
  assert.deepEqual(enviados, [], 'pausado: nenhum lance');
  d.atualizarLimites({ piso: 96 });
  await d.retomar();
  assert.equal(d.status, STATUS.PISO, 'com o piso novo (96) não dá para cobrir 95');
  assert.deepEqual(enviados, []);
  assert.throws(() => d.atualizarLimites({ piso: 150 }), /maior que o preço teto/);
});

test('Disputa: respeita o intervalo mínimo entre os próprios lances', async () => {
  let relogio = 0; const esperas = [];
  const sala = new SalaSimulada({ inicial: 100, eventos: [{ tipo: 'lance', valor: 99, autor: 'F2' }, { tipo: 'lance', valor: 98, autor: 'F5' }] });
  const d = new Disputa({ sala, ...base, intervaloMs: 20000, agora: () => relogio, esperar: async (ms) => { esperas.push(ms); relogio += ms; } });
  await d.iniciar();
  assert.deepEqual(esperas, [20000, 20000]);
});

test('decidir: só dá lance na fase aberta e na prorrogação', () => {
  const praca = { ...base, melhorConcorrente: 95, nossoLance: 96 };
  assert.equal(decidir({ ...praca, fase: FASES.ABERTA }).acao, 'lance');
  assert.equal(decidir({ ...praca, fase: FASES.PRORROGACAO }).acao, 'lance');
  for (const fase of [FASES.DESEMPATE, FASES.NEGOCIACAO, FASES.HABILITACAO, FASES.ENCERRADA]) {
    assert.deepEqual(decidir({ ...praca, fase }), { acao: 'aguardar', motivo: 'fase' }, fase);
  }
});

test('preferenciaLC123: empate ficto quando a ME/EPP fica até 5% acima de quem não é ME/EPP', () => {
  const r = preferenciaLC123([
    { autor: 'nos', valor: 100, porte: 'demais' },
    { autor: 'F5', valor: 105, porte: 'me' },
    { autor: 'F9', valor: 105.01, porte: 'epp' },
    { autor: 'F2', valor: 101, porte: 'demais' },
  ]);
  assert.equal(r.empate, true);
  assert.equal(r.lider.autor, 'nos');
  assert.equal(r.beneficiada.autor, 'F5');
  assert.equal(r.limite, 105);
  assert.deepEqual([...r.faixa], ['F5'], 'F9 passou de 5%');
  // Se quem lidera já é ME/EPP, não há empate ficto.
  assert.equal(preferenciaLC123([{ autor: 'F5', valor: 99, porte: 'me' }, { autor: 'F9', valor: 100, porte: 'epp' }]).empate, false);
});

test('decidir: foge da faixa de 5% da ME/EPP só se o piso permitir', () => {
  const praca = { piso: 90, teto: 120, decremento: 0.01, nossoLance: 100, melhorConcorrente: 104, melhorMeEpp: 104, fugirEmpate: true };
  // 104 / 1,05 = 99,047... -> 99,04 (99,04 * 1,05 = 103,99 < 104)
  assert.deepEqual(decidir(praca), { acao: 'lance', valor: 99.04, motivo: 'fuga_empate' });
  assert.equal(decidir({ ...praca, fugirEmpate: false }).acao, 'aguardar', 'desligado: só aguarda na frente');
  assert.equal(decidir({ ...praca, nossoPorte: 'me' }).acao, 'aguardar', 'nós somos ME: não precisa fugir');
  assert.deepEqual(decidir({ ...praca, piso: 99.5 }), { acao: 'aguardar', motivo: 'empate_inevitavel' }, 'nunca abaixo do piso');
  assert.equal(decidir({ ...praca, melhorMeEpp: 106 }).acao, 'aguardar', 'fora da faixa: não mexe');
});

test('SalaSimulada: percorre as fases e o robô nunca fura o piso', async () => {
  const fases = []; const enviados = [];
  const sala = new SalaSimulada({ inicial: 103, minimoConcorrentes: 92, passoMs: 5, abertaMs: 120, prorrogacaoMs: 40, etapaMs: 5 });
  const original = sala.enviarLance.bind(sala);
  sala.enviarLance = async (v) => { enviados.push(v); return original(v); };
  const d = new Disputa({ sala, piso: 90, teto: 100, custo: 80, decremento: 0.01, fugirEmpate: true, aoFase: (f) => fases.push(f) });
  await d.iniciar();
  assert.equal(fases[0], FASES.ABERTA);
  for (const f of [FASES.DESEMPATE, FASES.NEGOCIACAO, FASES.HABILITACAO, FASES.ENCERRADA]) assert.ok(fases.includes(f), `faltou a fase ${f}: ${fases}`);
  assert.ok(enviados.length > 0);
  assert.ok(enviados.every((v) => v >= 90 && v <= 100), String(enviados));
  assert.equal(d.status, STATUS.PARADO);
  const ranking = d.ranking();
  assert.ok(ranking.some((x) => x.autor === 'nos'));
  assert.ok(ranking.every((x, i) => i === 0 || x.valor >= ranking[i - 1].valor));
});
