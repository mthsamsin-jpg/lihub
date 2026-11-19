// Chat Unificado Multiportal: detecção, caixa de entrada, conectores e monitor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarGatilhos, hashMensagem, nucleoDoNome, papelDoAutor } from '../src/chat/detectar.js';
import { enviarWebhook, registrarMensagens, textoDoAlerta } from '../src/chat/caixa.js';
import { chaveComprasnet, criarObtedor, mensagemDoPortal } from '../src/chat/conectores.js';
import { monitorarChats } from '../src/chat/monitorar.js';

const PERFIL = { cnpjs: ['10936713000115'], nomes: ['COPIAR BRASIL COPIADORAS LTDA', 'Copiar'], palavras: ['diligência'] };

test('detecção: menção ao CNPJ (com e sem pontuação) e ao nome sem sufixo societário', () => {
  assert.ok(detectarGatilhos('Fornecedor 10.936.713/0001-15, envie a proposta ajustada em 2 horas.', PERFIL, 'pregoeiro').gatilhos.includes('mencao_cnpj'));
  assert.ok(detectarGatilhos('cnpj 10936713000115 arrematante', PERFIL).gatilhos.includes('mencao_cnpj'));
  const r = detectarGatilhos('Convocamos a empresa Copiar Brasil Copiadoras para anexar o catálogo.', PERFIL, 'pregoeiro');
  assert.ok(r.gatilhos.includes('mencao_nome'));
  assert.ok(r.gatilhos.includes('anexo'));
  assert.equal(r.relevante, true);
  assert.equal(nucleoDoNome('COPIAR BRASIL COPIADORAS LTDA'), 'copiar brasil copiadoras');
});

test('detecção: convocação, prazo, suspensão e palavra; conversa comum não é relevante', () => {
  const conv = detectarGatilhos('Senhor fornecedor, encaminhe a planilha no prazo de 2 horas.', PERFIL, 'pregoeiro');
  assert.deepEqual(['anexo', 'convocacao', 'prazo'].every((g) => conv.gatilhos.includes(g)), true);
  assert.equal(conv.relevante, true);
  assert.equal(detectarGatilhos('A sessão está suspensa e será reaberta amanhã às 9h.', PERFIL, 'pregoeiro').relevante, true);
  assert.ok(detectarGatilhos('Abriremos diligência no item 3.', PERFIL).gatilhos.includes('palavra'));
  assert.equal(detectarGatilhos('Bom dia a todos, vamos iniciar.', PERFIL, 'pregoeiro').relevante, false);
  assert.equal(detectarGatilhos('Envie o anexo', PERFIL, 'fornecedor').relevante, false, 'outro fornecedor pedindo não é alerta');
});

test('papel do autor e identidade da mensagem', () => {
  assert.equal(papelDoAutor('Pregoeiro'), 'pregoeiro');
  assert.equal(papelDoAutor('Agente de Contratação'), 'pregoeiro');
  assert.equal(papelDoAutor('Sistema'), 'sistema');
  assert.equal(papelDoAutor('Fornecedor 10.936.713/0001-15'), 'fornecedor');
  const a = hashMensagem({ autor: 'Pregoeiro', texto: 'Boa  tarde', enviadaEm: '2026-11-19T10:00:30Z' });
  assert.equal(a, hashMensagem({ autor: 'pregoeiro', texto: 'Boa tarde', enviadaEm: '2026-11-19T10:00:59Z' }));
  assert.notEqual(a, hashMensagem({ idExterno: 7, texto: 'Boa tarde' }));
});

test('caixa: grava sem repetir, marca relevantes e manda só elas ao webhook', async () => {
  const gravadas = [];
  const atualizadas = [];
  const supabase = {
    from: () => ({
      upsert(linhas, opcoes) {
        assert.equal(opcoes.ignoreDuplicates, true);
        gravadas.push(...linhas);
        return { select: async () => ({ data: linhas.map((l, i) => ({ id: i + 1, ...l })), error: null }) };
      },
      update(campos) { return { eq: async (c, v) => { atualizadas.push([campos, v]); return { error: null }; } }; },
    }),
  };
  const enviados = [];
  const r = await registrarMensagens({
    organizacao_id: 'o1', portal: 'bll', compra_ref: '123/2026', fonte: 'robo',
    mensagens: [{ autor: 'Pregoeiro', texto: 'Bom dia.' }, { autor: 'Pregoeiro', texto: 'Empresa Copiar, anexe a proposta em 30 minutos.' }, { texto: '   ' }],
  }, { supabase, perfil: { ...PERFIL, webhook: 'https://discord.com/api/webhooks/x' }, enviar: async (url, m) => enviados.push(m.texto), log: {} });
  assert.deepEqual(r, { novas: 2, relevantes: 1 });
  assert.equal(gravadas.length, 2);
  assert.equal(gravadas[1].papel, 'pregoeiro');
  assert.deepEqual(enviados, ['Empresa Copiar, anexe a proposta em 30 minutos.']);
  assert.equal(atualizadas.length, 1);
});

test('webhook: formato do Discord, do Slack e genérico', async () => {
  const corpos = [];
  const f = async (url, o) => { corpos.push([url, JSON.parse(o.body)]); return { ok: true }; };
  const m = { portal: 'comprasnet', compra_ref: '94300105010632026', autor: 'Pregoeiro', texto: 'Anexe o catálogo.', gatilhos: ['anexo'] };
  await enviarWebhook('https://discord.com/api/webhooks/1/a', m, { fetch: f });
  await enviarWebhook('https://hooks.slack.com/services/x', m, { fetch: f });
  await enviarWebhook('https://exemplo.com/gancho', m, { fetch: f });
  assert.ok(corpos[0][1].content.includes('Compras.gov.br'));
  assert.ok(corpos[1][1].text.includes('pedido de anexo'));
  assert.equal(corpos[2][1].evento, 'chat.mensagem');
  assert.match(textoDoAlerta(m), /pregão 94300105010632026/);
});

test('conector Compras.gov.br: chave da compra e mensagens em formatos diferentes', () => {
  assert.equal(chaveComprasnet({ uasg: '943001', numero: '1063', ano: '2026' }), '94300105010632026');
  assert.equal(chaveComprasnet({ uasg: '160001', numero: '90012', ano: '2026', modalidade: '6' }), '16000106900122026');
  assert.equal(chaveComprasnet('https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras/acompanhamento-compra?compra=94300105010632026'), '94300105010632026');
  assert.equal(chaveComprasnet({ uasg: '1' }), null);
  const m = mensagemDoPortal({ mensagem: 'Anexe', remetente: { nome: 'Pregoeiro' }, dataHora: '2026-11-19T10:00:00Z', id: 9 });
  assert.deepEqual(m, { texto: 'Anexe', autor: 'Pregoeiro', enviadaEm: '2026-11-19T10:00:00.000Z', idExterno: 9 });
  assert.equal(mensagemDoPortal({ texto: 'x', data: 'inválida' }).enviadaEm, null);
});

test('obtedor: um pedido por vez e pausa geral depois de 429', async () => {
  let t = 0;
  const respostas = [{ status: 429 }, { status: 200, ok: true, json: async () => [1] }];
  const obter = criarObtedor({ intervaloMs: 0, pausa429Ms: 0, agora: () => t, fetch: async () => respostas.shift() });
  await assert.rejects(obter('https://x'), /429/);
  assert.deepEqual(await obter('https://x'), [1]);
  t += 1;
});

test('monitor: só conectores validados (ou permitidos), e entrega à caixa', async () => {
  const supabase = {
    from: (t) => {
      const q = { then: (ok) => ok({ data: t === 'monitoramentos' ? [{ organizacao_id: 'o1', pregoes: [{ uasg: '943001', numero: '1063', ano: '2026' }, { portal: 'bll', numero: '5' }], portais_publicos: true }] : [], error: null }) };
      for (const m of ['select', 'eq', 'maybeSingle']) q[m] = () => q;
      return q;
    },
  };
  const lotes = [];
  const deps = { supabase, log: {}, obter: async () => [{ texto: 'Anexe', remetente: 'Pregoeiro' }], registrar: async (l) => { lotes.push(l); return { novas: 1, relevantes: 0 }; } };
  const bloqueado = await monitorarChats({}, deps);
  assert.equal(bloqueado.salas, 0, 'Compras.gov.br ainda não validado: não lê sem permissão');
  const liberado = await monitorarChats({ permitirNaoValidados: true }, deps);
  assert.deepEqual([liberado.salas, liberado.novas, liberado.ignoradas], [1, 1, 1], 'BLL não tem leitura pública');
  assert.equal(lotes[0].compra_ref, '94300105010632026');
  assert.equal(lotes[0].fonte, 'publica');
});
