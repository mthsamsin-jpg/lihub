// Robô de lances: cobertura por centavos e a trava do piso (nunca abaixo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidir, validarLimites, Disputa, SalaSimulada, STATUS } from '../src/robo/motor.js';

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
      { tipo: 'lance', valor: 50, autor: 'F2' }, // não deve ser lido: o robô já parou
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
