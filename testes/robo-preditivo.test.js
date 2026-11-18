// Robô Turbo 2.0, camada preditiva: perfil dos concorrentes, estimativa do
// fechamento, chance de vitória/margem, alertas e webhook. Sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfilConcorrentes, MonitorPreditivo, estimarFechamento, ritmoDaPraca, analisar, phi, inversaPhi } from '../src/robo/analise.js';
import { historicoParecido } from '../worker/gerenciador.js';
import { validarWebhook, enviarWebhook } from '../worker/webhook.js';
import { SessaoReal } from '../worker/sessao.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('estatística básica: normal e inversa', () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(phi(1.645) - 0.95) < 1e-3);
  for (const q of [0.01, 0.3, 0.5, 0.9, 0.999]) assert.ok(Math.abs(phi(inversaPhi(q)) - q) < 1e-4);
});

test('perfil: velocidade de resposta ao nosso lance e agressividade de preço', () => {
  const p = new PerfilConcorrentes();
  p.registrar({ autor: 'F2', valor: 100, em: 0 });
  p.nosso(99.99, 10_000);
  p.registrar({ autor: 'F2', valor: 97, em: 12_000 }); // respondeu em 2 s, desceu ~3%
  p.registrar({ autor: 'F9', valor: 96.95, em: 60_000 }); // 50 s depois, desceu ~0,05%
  const [f9, f2] = p.resumo();
  assert.equal(f2.autor, 'F2');
  assert.equal(f2.respostaMedianaMs, 2000);
  assert.ok(f2.agressividadePct > 2.9 && f2.agressividadePct < 3.1);
  assert.equal(f2.perfil, 'agressivo');
  assert.equal(f9.perfil, 'passivo');
  assert.equal(p.registrar({ autor: 'nos', valor: 1 }), null, 'o nosso lance não vira concorrente');
});

test('ritmo da praça: descidas encolhendo dão o ponto de parada e a inflexão; ritmo constante não extrapola', () => {
  const desacelerando = [100, 96, 93, 91, 90, 89.5, 89.25].map((valor, i) => ({ valor, em: i }));
  const r = ritmoDaPraca(desacelerando);
  assert.ok(r.previsto < 89.25 && r.previsto > 88.5, `para perto de 89 (foi ${r.previsto})`);
  assert.ok(r.inflexao, 'tem inflexão');
  const constante = [100, 99, 98, 97, 96, 95].map((valor, i) => ({ valor, em: i }));
  assert.equal(ritmoDaPraca(constante).previsto, null, 'sem desaceleração não há onde parar');
});

test('fechamento: histórico parecido puxa a previsão; nunca acima do melhor lance atual', () => {
  const hist = [{ desagioPct: 8 }, { desagioPct: 10 }, { desagioPct: 9 }, { desagioPct: 11 }];
  const so = estimarFechamento({ teto: 100, historico: hist });
  assert.ok(so.previsto > 88 && so.previsto < 93, `deságio ~9,5% (foi ${so.previsto})`);
  assert.equal(so.fonte.historico, 'historico');
  const comPraca = estimarFechamento({ teto: 100, historico: hist, lances: [{ valor: 85, em: 0 }] });
  assert.ok(comPraca.previsto <= 85 && comPraca.maximo <= 85, 'a praça já está em 85');
  assert.ok(comPraca.minimo < comPraca.previsto);
});

test('chance de vitória cai conforme a praça desce e zera quando passa do nosso piso', () => {
  const chance = (atual) => {
    const lances = [5000, 4900, 4800, 4700, 4600, 4500, 4400, 4300, 4200, 4100].filter((v) => v >= atual).map((valor, i) => ({ valor, em: i }));
    return analisar({ teto: 4890, piso: 4150, custo: 3720, estimativa: estimarFechamento({ teto: 4890, lances }) });
  };
  const a = chance(4700); const b = chance(4300); const c = chance(4100);
  assert.ok(a.probabilidadeVitoria > b.probabilidadeVitoria, `${a.probabilidadeVitoria} > ${b.probabilidadeVitoria}`);
  assert.equal(c.probabilidadeVitoria, 0);
  assert.ok(a.margemEstimadaPct > 0 && a.precoVitoriaEsperado >= 4150, 'margem sobre o custo, preço nunca abaixo do piso');
  assert.equal(a.tetoSeguroDesagioPct, 15.13);
});

test('alertas: só mudanças relevantes, com intervalo mínimo (sem inundar)', () => {
  let t = 0;
  const m = new MonitorPreditivo({ teto: 100, piso: 90, custo: 80, agora: () => t, intervaloAlertaMs: 15_000, saltoProbPts: 10 });
  const alertas = [];
  const lance = (autor, v) => { t += 3000; const r = m.concorrente(autor, v, 'demais'); if (r.alerta) alertas.push(r.alerta); };
  lance('F2', 99); lance('F5', 98);
  assert.equal(alertas.length, 0, 'com menos de 3 lances não alerta');
  lance('F2', 97.5);
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].motivo, 'primeira');
  assert.match(alertas[0].texto, /Chance de vitória: .+%\. Margem estimada/);
  lance('F5', 97.6); // acima do melhor lance: a praça não mudou
  assert.equal(alertas.length, 1, 'sem mudança relevante, sem alerta');
  lance('F2', 89); // a praça furou o nosso piso: chance despenca
  assert.equal(alertas.at(-1).motivo, 'sem_chance', 'avisa na hora, mesmo dentro do intervalo');
  assert.equal(m.previsao.probabilidadeVitoria, 0);
});

test('histórico parecido: casa pela descrição do produto', () => {
  const linhas = [
    { descricao: 'Notebook i5 16GB SSD 512', desagio_pct: 12 },
    { descricao: 'NOTEBOOK Core i5, 16 GB de RAM', desagio_pct: 9 },
    { descricao: 'Cadeira giratória de escritório', desagio_pct: 30 },
  ];
  const h = historicoParecido('Item 1 · Notebook 15,6" i5, 16 GB, SSD 512 GB', linhas);
  assert.deepEqual(h.map((x) => x.desagioPct), [12, 9]);
});

test('webhook: só https público; envia texto para Slack e Discord', async () => {
  assert.equal(validarWebhook('https://hooks.slack.com/services/T/B/x'), null);
  assert.match(validarWebhook('http://hooks.slack.com/x'), /https/);
  for (const ruim of ['https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://192.168.0.1/x', 'https://[::1]/x', 'https://metadata.google.internal/x', 'https://user:senha@site.com/x']) {
    assert.ok(validarWebhook(ruim), `recusa ${ruim}`);
  }
  let corpo = null;
  await enviarWebhook('https://discord.com/api/webhooks/1/x', { texto: 'Chance de vitória: 64%' }, { fetch: async (_u, o) => { corpo = JSON.parse(o.body); return { ok: true }; } });
  assert.equal(corpo.text, 'Chance de vitória: 64%');
  assert.equal(corpo.content, 'Chance de vitória: 64%');
  await assert.rejects(enviarWebhook('https://x.com/h', { texto: 'a' }, { fetch: async () => ({ ok: false, status: 404 }) }), /404/);
});

test('sessão real: previsão vai para o feed e o webhook; fim grava fechamento e perfis', async () => {
  const a = {
    portal: 'bll', callback: null,
    abrir: async () => {}, login: async () => {}, joinAuctionRoom: async () => {},
    lerSala: async () => ({ fase: 'aberta', lances: [], mensagens: [] }),
    watchBids(cb) { a.callback = cb; return () => {}; },
    placeBid: async () => {}, close: async () => {},
  };
  const feed = []; const webhooks = []; let fechamento = null; let perfis = null;
  const s = new SessaoReal({
    sessao: { id: 's1', modo: 'monitorar', pregao_ref: '90012/2026', lote_ref: null },
    item: { piso: 90, teto: 100, custo: 80, decremento: 0.01 },
    adaptador: a, gravar: async (e) => { feed.push(e); }, atualizarSessao: async () => {}, atualizarItem: async () => {},
    log: { erro() {} },
    notificar: async (d) => { webhooks.push(d); },
    salvarFechamento: async (f) => { fechamento = f; },
    salvarPerfis: async (p) => { perfis = p; },
  });
  await s.iniciar();
  for (const [autor, valor] of [['F2', 99], ['F5', 98], ['F2', 96.5], ['F7', 95]]) a.callback({ tipo: 'lance', autor, valor, porte: 'demais', hora: String(valor) });
  await esperar(10);
  assert.ok(feed.some((e) => e.tipo === 'alerta' && /Chance de vitória/.test(e.texto)), 'alerta no feed');
  assert.equal(webhooks.length, 1);
  assert.match(webhooks[0].texto, /pregão 90012\/2026/);
  assert.equal(typeof webhooks[0].probabilidadeVitoria, 'number');
  a.callback({ tipo: 'fase', fase: 'encerrada' });
  await esperar(10);
  assert.deepEqual(fechamento, { preco: 95, vencemos: null, lances: 4 });
  assert.deepEqual(perfis.map((p) => p.autor).sort(), ['F2', 'F5', 'F7']);
});
