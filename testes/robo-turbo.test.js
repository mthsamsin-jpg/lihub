// Robô Turbo 2.0, alta performance: leitura por MutationObserver (diferenciador),
// sniper nos segundos finais, margem mínima, reconexão automática e seletores com
// autocorreção. Nenhum portal é acessado (adaptadores e páginas falsos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Disputa } from '../src/robo/motor.js';
import { criarDiferenciador, AdaptadorPorSeletores } from '../worker/adaptadores/playwright.js';
import { SessaoReal } from '../worker/sessao.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('diferenciador: só avisa novidades; prazo só quando muda de verdade', () => {
  const ev = [];
  const dif = criarDiferenciador((e) => ev.push(e));
  const t0 = 1_000_000;
  dif({ fase: 'aberta', fimEm: t0, lances: [{ autor: 'F2', valor: 99, hora: '10:00:01' }], mensagens: [{ autor: 'P', texto: 'oi', hora: '10:00' }] });
  assert.deepEqual(ev.map((e) => e.tipo), ['fase', 'lance'], 'mensagens antigas não entram; o lance vem marcado como inicial');
  assert.equal(ev[1].inicial, true);
  ev.length = 0;
  dif({ fase: 'aberta', fimEm: t0 + 400, lances: [{ autor: 'F2', valor: 99, hora: '10:00:01' }], mensagens: [] });
  assert.deepEqual(ev, [], 'mesma sala, cronômetro andando normal: nada novo');
  dif({ fase: 'aberta', fimEm: t0 + 120_000, lances: [{ autor: 'F2', valor: 99, hora: '10:00:01' }, { autor: 'F5', valor: 97, hora: '10:00:09' }], mensagens: [{ autor: 'P', texto: 'Prorrogado', hora: '10:01' }] });
  assert.deepEqual(ev.map((e) => e.tipo), ['tempo', 'lance', 'mensagem']);
  assert.equal(ev[0].fimEm, t0 + 120_000);
  assert.equal(ev[1].inicial, false);
});

/** Sala mínima: o teste empurra eventos; os lances enviados ficam em "enviados". */
function salaFalsa() {
  const fila = []; let espera = null;
  return {
    enviados: [], latenciaMs: 0,
    empurrar(ev) { if (espera) { const r = espera; espera = null; r(ev); } else fila.push(ev); },
    proximoEvento() { return fila.length ? Promise.resolve(fila.shift()) : new Promise((r) => { espera = r; }); },
    async enviarLance(v) { this.enviados.push(v); },
    fechar() { this.empurrar({ tipo: 'encerrada' }); },
  };
}

test('sniper: segura o lance e dispara só na janela final (descontando a latência)', async () => {
  const sala = salaFalsa();
  sala.latenciaMs = 50;
  const avisos = [];
  const d = new Disputa({ sala, piso: 90, teto: 100, decremento: 0.01, sniperMs: 100, aoSniper: (ms) => avisos.push(ms) });
  d.fase = 'aberta';
  d.fimEm = Date.now() + 400; // janela abre em ~250 ms (400 - 50 de latência - 100)
  d.registrarConcorrente('F2', 99);
  d.iniciar();
  await esperar(80);
  assert.deepEqual(sala.enviados, [], 'fora da janela: nada enviado');
  assert.equal(avisos.length, 1);
  assert.ok(avisos[0] > 150 && avisos[0] <= 250, `agendado para ~250 ms (foi ${avisos[0]})`);
  await esperar(260);
  assert.deepEqual(sala.enviados, [98.99], 'disparou na janela final');
  d.parar();
});

test('sniper: prorrogação (novo prazo) reprograma o disparo; sem cronômetro, lança na hora', async () => {
  const sala = salaFalsa();
  const d = new Disputa({ sala, piso: 90, teto: 100, sniperMs: 100 });
  d.fase = 'aberta';
  d.fimEm = Date.now() + 250;
  d.registrarConcorrente('F2', 99);
  d.iniciar();
  await esperar(20);
  sala.empurrar({ tipo: 'tempo', fimEm: Date.now() + 600 }); // prorrogou
  await esperar(250);
  assert.deepEqual(sala.enviados, [], 'o prazo andou: o disparo foi adiado');
  await esperar(330);
  assert.deepEqual(sala.enviados, [98.99]);
  d.parar();

  const sala2 = salaFalsa();
  const d2 = new Disputa({ sala: sala2, piso: 90, teto: 100, sniperMs: 100 });
  d2.fase = 'aberta';
  d2.registrarConcorrente('F2', 99);
  d2.iniciar();
  await esperar(20);
  assert.deepEqual(sala2.enviados, [98.99], 'sem prazo conhecido o sniper não tem como mirar: cobre na hora');
  d2.parar();
});

test('margem mínima: vira piso efetivo e nenhum lance fica abaixo de custo + margem', async () => {
  const sala = salaFalsa();
  const alertas = [];
  // custo 80 + 20% = 96 (acima do piso informado de 90)
  const d = new Disputa({ sala, piso: 90, teto: 100, custo: 80, margemMinPct: 20, aoAlerta: (t) => alertas.push(t) });
  d.fase = 'aberta';
  assert.equal(d.pisoEfetivo(), 96);
  d.registrarConcorrente('F2', 97);
  d.iniciar();
  await esperar(10);
  assert.deepEqual(sala.enviados, [96.99]);
  sala.empurrar({ tipo: 'lance', autor: 'F5', valor: 96.005, porte: 'demais' });
  await esperar(10);
  assert.deepEqual(sala.enviados, [96.99, 96], 'cobre com o próprio piso efetivo');
  sala.empurrar({ tipo: 'lance', autor: 'F2', valor: 95.9, porte: 'demais' });
  await esperar(10);
  assert.deepEqual(sala.enviados, [96.99, 96], 'abaixo de custo + margem: não cobre');
  assert.equal(d.status, 'stopped_at_floor');
  assert.match(alertas.at(-1), /96,00/);
  d.parar();
});

/** Adaptador falso que pode "cair". */
function adaptadorFalso(salas) {
  const a = {
    portal: 'bll', enviados: [], callback: null, aberturas: 0, falharAbrir: 0,
    async abrir() { a.aberturas += 1; if (a.falharAbrir > 0) { a.falharAbrir -= 1; throw new Error('portal fora do ar'); } },
    login: async () => {}, joinAuctionRoom: async () => {},
    lerSala: async () => salas[Math.min(a.aberturas - 1, salas.length - 1)],
    watchBids(cb) { a.callback = cb; return () => { if (a.callback === cb) a.callback = null; }; },
    async placeBid(v) { a.enviados.push(v); },
    close: async () => {},
    emitir: (ev) => a.callback?.(ev),
  };
  return a;
}

function sessao(adaptador, extra = {}) {
  const eventos = []; const status = []; const item = {};
  const s = new SessaoReal({
    sessao: { id: 's1', modo: 'lances', pregao_ref: '90012/2026', lote_ref: '1' },
    item: { piso: 90, teto: 100, custo: 80, decremento: 0.01, intervaloSeg: 0, nossoPorte: 'demais' },
    adaptador, gravar: async (e) => { eventos.push(e); }, atualizarSessao: async (c) => { status.push(c.status); },
    atualizarItem: async (c) => { Object.assign(item, c); }, log: { erro() {}, aviso() {} },
    esperar: async () => {}, ...extra,
  });
  return { s, eventos, status, item };
}

test('auto-healing: a sala caiu, o robô pausa, reconecta, pega o que mudou e volta a cobrir', async () => {
  const a = adaptadorFalso([
    { fase: 'aberta', lances: [{ valor: 99, autor: 'F2', porte: 'demais', nosso: false }], mensagens: [] },
    // Na volta: um concorrente deu lance enquanto o robô estava fora.
    { fase: 'aberta', lances: [{ valor: 99, autor: 'F2', porte: 'demais', nosso: false }, { valor: 95, autor: 'F7', porte: 'demais', nosso: false }], mensagens: [] },
  ]);
  const { s, eventos } = sessao(a);
  await s.iniciar();
  await esperar(10);
  assert.deepEqual(a.enviados, [98.99]);
  a.emitir({ tipo: 'queda', motivo: 'A página do portal travou.' });
  await esperar(20);
  assert.equal(a.aberturas, 2, 'reabriu o navegador');
  assert.equal(s.reconexoes, 1);
  assert.ok(eventos.some((e) => e.tipo === 'alerta' && /Reconectando/.test(e.texto)));
  assert.ok(eventos.some((e) => e.tipo === 'status' && /Reconectado/.test(e.texto)));
  assert.deepEqual(a.enviados, [98.99, 94.99], 'cobriu o lance dado durante a queda');
  assert.ok(a.callback, 'voltou a acompanhar a sala');
  await s.encerrar();
});

test('auto-healing: tentativas com espera crescente; esgotadas, a sessão encerra com erro', async () => {
  const a = adaptadorFalso([{ fase: 'aberta', lances: [], mensagens: [] }]);
  const esperas = [];
  const { s, status } = sessao(a, { esperar: async (ms) => { esperas.push(ms); }, maxReconexoes: 3, esperaBaseMs: 1000 });
  await s.iniciar();
  a.falharAbrir = 99;
  a.emitir({ tipo: 'queda', motivo: 'O navegador caiu.' });
  await esperar(20);
  assert.deepEqual(esperas, [1000, 2000, 4000]);
  assert.equal(status.at(-1), 'erro');
});

/** Página falsa: só os seletores em "existem" aparecem (com a quantidade dada). */
function paginaFalsa(existem) {
  const loc = (n) => ({ count: async () => n, isVisible: async () => n > 0, first: () => ({ waitFor: async () => {} }), fill: async () => {}, click: async () => {} });
  return { locator: (sel) => loc(existem[sel] || 0), getByRole: (papel) => loc(existem[`role:${papel}`] || 0) };
}

test('seletores com autocorreção: usa a alternativa quando o configurado some e lembra dela', async () => {
  const curas = [];
  const a = new AdaptadorPorSeletores({
    portal: 'bll', credencial: {}, carregarPlaywright: async () => ({}), log: { aviso() {} },
    seletores: { validado: true, urlBase: 'https://x', login: {}, sala: {}, lance: { campo: '#lance', enviar: '#btn-antigo', alternativas: { enviar: ['#btn-novo'] } } },
  });
  a.aoCurar = (...x) => curas.push(x);
  a.pagina = paginaFalsa({ '#lance': 1, '#btn-novo': 1 });
  await a.localizar('lance', 'enviar');
  assert.deepEqual(curas, [['lance.enviar', '#btn-antigo', '#btn-novo']]);
  await a.localizar('lance', 'enviar');
  assert.equal(curas.length, 1, 'na segunda vez já vai direto no que funcionou');

  // Heurística por papel só vale com UM elemento; dois botões parecidos = não arrisca.
  a.pagina = paginaFalsa({ 'role:button': 2 });
  a.curados.clear();
  await assert.rejects(a.localizar('lance', 'enviar'), (e) => e.codigo === 'seletor_quebrado');
  a.pagina = paginaFalsa({ 'role:button': 1 });
  await a.localizar('lance', 'enviar');
  assert.match(curas.at(-1)[2], /heurística/);
});

test('BLL: senha pelo teclado virtual (cada botão "a ou b", ordem muda a cada carga)', async () => {
  const { teclasDaSenha } = await import('../worker/adaptadores/BllAdapter.js');
  const teclas = ['0 ou 2', '8 ou 6', '3 ou 1', '9 ou 7', '5 ou 4'];
  assert.deepEqual(teclasDaSenha('1234', teclas), [2, 0, 2, 4]);
  assert.throws(() => teclasDaSenha('ab12', teclas), /numérica/);
  assert.throws(() => teclasDaSenha('1', ['0 ou 2']), /não mostrou o dígito 1/);
});
