// Aviso diário por e-mail dos novos editais dos radares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisarRadares, filtrosDoRadar, montarEmailRadar } from '../src/radar/avisos.js';

const AGORA = Date.parse('2026-11-20T10:00:00Z');
const silencioso = { info() {}, aviso() {}, erro() {} };
const LIC = (n) => ({ id: n, objeto: `Papel A4 lote ${n}`, orgao: 'Pref. X', uf: 'SC', municipio: 'Joinville', modalidade: 'Pregão - Eletrônico', valor: 0, encerra_em: '2026-11-25T13:00:00Z', link_pncp: `https://pncp.gov.br/app/editais/1/2026/${n}` });

function supabaseFalso({ radares, destinatarios, novidades }) {
  const t = { radares: radares.map((r) => ({ ...r })) };
  const pedidos = [];
  return {
    t, pedidos,
    from() {
      const f = [];
      let valor = null;
      const q = {
        select() { return q; },
        update(v) { valor = v; return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
        then(ok, falha) {
          const alvo = t.radares.filter((r) => f.every((x) => x(r)));
          if (valor) alvo.forEach((r) => Object.assign(r, valor));
          return Promise.resolve({ data: alvo.map((r) => (valor ? { id: r.id } : { ...r })), error: null }).then(ok, falha);
        },
      };
      return q;
    },
    async rpc(nome, args) {
      pedidos.push({ nome, args });
      if (nome === 'radar_destinatarios') return { data: destinatarios, error: null };
      return { data: novidades(args), error: null };
    },
  };
}

const RADARES = [
  { id: 'r1', nome: 'Papel SC', ativo: true, palavras: ['papel a4', 'sulfite'], ufs: ['SC'], municipios: [], modalidades: ['Pregão Eletrônico', 'Dispensa'], canais: { email: true }, criado_em: '2026-11-01T00:00:00Z', ultimo_aviso_em: '2026-11-19T10:00:00Z' },
  { id: 'r2', nome: 'Toner', ativo: true, palavras: ['toner'], ufs: [], municipios: [], modalidades: [], canais: { email: true }, criado_em: '2026-11-19T22:00:00Z', ultimo_aviso_em: null },
  { id: 'r3', nome: 'Sem e-mail', ativo: true, palavras: ['x'], ufs: [], municipios: [], modalidades: [], canais: { email: false }, criado_em: '2026-11-01T00:00:00Z', ultimo_aviso_em: null },
];
const DEST = [
  { radar_id: 'r1', email: 'ana@exemplo.com', nome: 'Ana' },
  { radar_id: 'r2', email: 'ana@exemplo.com', nome: 'Ana' },
];

test('filtrosDoRadar: palavras, locais e nomes de modalidade viram códigos do PNCP', () => {
  assert.deepEqual(filtrosDoRadar(RADARES[0]), { p_termo: 'papel a4, sulfite', p_ufs: ['SC'], p_municipios: null, p_modalidades: [6, 8] });
  assert.equal(filtrosDoRadar({ palavras: [] }).p_termo, null);
});

test('avisarRadares: um e-mail por pessoa com os radares dela, período reservado e respeitado', async () => {
  const sb = supabaseFalso({ radares: RADARES, destinatarios: DEST, novidades: (a) => (a.p_termo === 'toner' ? { total: 12, itens: [LIC(1), LIC(2)] } : { total: 1, itens: [LIC(3)] }) });
  const enviados = [];
  const r = await avisarRadares({ supabase: sb, enviar: async (m) => { enviados.push(m); }, agora: AGORA, log: silencioso, site: 'https://x.test' });
  assert.deepEqual({ radares: r.radares, comNovidade: r.comNovidade, emails: r.emails, licitacoes: r.licitacoes, falhas: r.falhas }, { radares: 2, comNovidade: 2, emails: 1, licitacoes: 13, falhas: 0 });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].para, 'ana@exemplo.com');
  assert.match(enviados[0].assunto, /^13 licitações novas/);
  assert.match(enviados[0].html, /Papel SC/);
  assert.match(enviados[0].html, /Valor sigiloso/);
  assert.match(enviados[0].texto, /e mais 10/);
  // desde: último aviso (r1) ou a criação (r2)
  const desde = Object.fromEntries(sb.pedidos.filter((p) => p.nome === 'radar_novidades').map((p) => [p.args.p_termo, p.args.p_desde]));
  assert.equal(desde['papel a4, sulfite'], '2026-11-19T10:00:00.000Z');
  assert.equal(desde.toner, '2026-11-19T22:00:00.000Z');
  assert.ok(sb.t.radares.slice(0, 2).every((x) => x.ultimo_aviso_em === new Date(AGORA).toISOString()));
  assert.equal(sb.t.radares[2].ultimo_aviso_em, null, 'radar com e-mail desligado não é tocado');
});

test('avisarRadares: radar parado há muito tempo manda só os últimos 3 dias; envio que falha devolve o período', async () => {
  const antigo = { ...RADARES[0], ultimo_aviso_em: '2026-10-01T00:00:00Z' };
  const sb = supabaseFalso({ radares: [antigo], destinatarios: [DEST[0]], novidades: () => ({ total: 2, itens: [LIC(1), LIC(2)] }) });
  const r = await avisarRadares({ supabase: sb, enviar: async () => { throw new Error('Resend fora'); }, agora: AGORA, log: silencioso });
  assert.equal(sb.pedidos.find((p) => p.nome === 'radar_novidades').args.p_desde, '2026-11-17T10:00:00.000Z');
  assert.equal(r.falhas, 1);
  assert.equal(r.emails, 0);
  assert.equal(sb.t.radares[0].ultimo_aviso_em, '2026-10-01T00:00:00Z', 'período devolvido');
});

test('avisarRadares: outro servidor já reservou -> não envia em dobro; sem novidade -> nenhum e-mail', async () => {
  const sb = supabaseFalso({ radares: [RADARES[0]], destinatarios: [DEST[0]], novidades: () => ({ total: 3, itens: [] }) });
  const original = sb.from.bind(sb);
  let primeira = true;
  sb.from = (...a) => {
    const q = original(...a);
    const upd = q.update;
    q.update = (v) => { if (primeira) { primeira = false; sb.t.radares[0].ultimo_aviso_em = '2026-11-20T09:59:00Z'; } return upd(v); };
    return q;
  };
  let envios = 0;
  const r = await avisarRadares({ supabase: sb, enviar: async () => { envios++; }, agora: AGORA, log: silencioso });
  assert.equal(envios, 0);
  assert.equal(r.comNovidade, 0);

  const vazio = supabaseFalso({ radares: [RADARES[1]], destinatarios: [DEST[1]], novidades: () => ({ total: 0, itens: [] }) });
  const r2 = await avisarRadares({ supabase: vazio, enviar: async () => { envios++; }, agora: AGORA, log: silencioso });
  assert.equal(envios, 0);
  assert.equal(r2.emails, 0);
});

test('avisarRadares: sem RESEND_API_KEY não mexe em nada; simular não envia nem reserva', async () => {
  const sb = supabaseFalso({ radares: RADARES, destinatarios: DEST, novidades: () => ({ total: 1, itens: [LIC(1)] }) });
  assert.match((await avisarRadares({ supabase: sb, enviar: null, agora: AGORA, log: silencioso })).parado, /RESEND_API_KEY/);
  const r = await avisarRadares({ supabase: sb, enviar: null, simular: true, agora: AGORA, log: silencioso });
  assert.equal(r.previa.length, 1);
  assert.equal(sb.t.radares[0].ultimo_aviso_em, '2026-11-19T10:00:00Z');
});

test('montarEmailRadar: escapa HTML e singular/plural', () => {
  const m = montarEmailRadar('Ana <b>', [{ radar: { nome: 'R<script>' }, total: 1, itens: [{ ...LIC(1), objeto: '<img src=x>' }] }]);
  assert.match(m.assunto, /^1 licitação nova/);
  assert.ok(!m.html.includes('<script>') && !m.html.includes('<img src=x>'));
});
