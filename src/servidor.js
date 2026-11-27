// Servidor do Uso LicitaHub: API de análise de editais (Claude) + sincronização
// automática com o PNCP. Rode com: npm run servidor
import { serve } from '@hono/node-server';
import { criarApp } from './api/app.js';
import { criarRepositorio } from './api/repositorio.js';
import { ligarSite } from './api/site.js';
import { ligarAdm } from './api/adm.js';
import { config } from './config.js';
import { analisarEdital, provedorDaIa } from './ia/analisar-edital.js';
import { maxBytesPdf, obterEditalDoPncp } from './ia/documento.js';
import { criarPagamentos, modoDoToken } from './pagamentos/mercadopago.js';
import { criarDetalhes } from './pncp/detalhes.js';
import { sincronizarPncp } from './pncp/sincronizar.js';
import { executarColeta, situacaoColeta } from './services/collectors/index.js';
import { agendarCron } from './services/collectors/cron.js';
import { emHorarioDePico } from './pico.js';
import { configCiclo, roboLiberado } from './pagamentos/ciclo.js';
import { criarLogEstruturado } from './services/collectors/log.js';
import { fecharAbandonadas } from './services/collectors/execucoes.js';
import { timingSafeEqual } from 'node:crypto';
import { atualizarCapag } from './capag/atualizar.js';
import { criarClienteAdmin, criarClienteDoUsuario } from './supabase.js';
import { criarLog } from './util.js';
import { criarCofre } from './cofre.js';
import { ligarModoReal } from './api/modo-real.js';
import { ligarPncpAoVivo } from './api/pncp-ao-vivo.js';
import { criarGerenciador } from '../worker/gerenciador.js';
import { coletarResultados } from './mercado/coletar.js';
import { descobrirRetro, dentroDaJanela, termosRetro } from './mercado/retro.js';
import { avisarRadares, enviadorDoAmbiente } from './radar/avisos.js';
import { canaisDoAmbiente as canaisDeEmail } from '../worker/notificacoes.js';
import { lerEditaisAutomaticamente } from './ia/leitura-automatica.js';
import { configWhatsapp, ligarWhatsapp } from './whatsapp.js';

const log = criarLog('servidor');

let admin;
try {
  admin = criarClienteAdmin();
  criarClienteDoUsuario('verificacao'); // confere se a chave pública também está configurada
} catch (e) {
  log.erro(e.message);
  process.exit(1);
}
let ia;
try {
  ia = provedorDaIa();
} catch (e) {
  log.erro(e.message);
  process.exit(1);
}
if (ia.chaveConfigurada) log.info(`Leitura de edital: ${ia.nome}, modelo ${ia.modelo}.`);
else log.aviso(`${ia.variavelChave} não definida: o servidor sobe, mas as análises de edital (${ia.nome}) vão falhar.`);

const repositorio = criarRepositorio({ admin, criarClienteDoUsuario });

let pagamentos = null;
if (config.mercadoPago.token) {
  pagamentos = criarPagamentos({
    token: config.mercadoPago.token, segredoWebhook: config.mercadoPago.segredoWebhook,
    urlSite: config.site.url, repositorio, log: criarLog('pagamentos'),
  });
  const modo = modoDoToken(config.mercadoPago.token);
  log.info(`Assinaturas: Mercado Pago em ${modo === 'real' ? 'MODO REAL (cobra de verdade)' : 'modo de teste'}.`);
  if (!config.mercadoPago.segredoWebhook) log.aviso('MP_WEBHOOK_SECRET não definida: a assinatura dos avisos não é conferida (os pagamentos continuam sendo reconsultados na API).');
} else {
  log.aviso('MP_ACCESS_TOKEN não definida: assinaturas desligadas.');
}

// Planos pagos vencidos (15 dias sem novo pagamento) voltam ao Free. Isentas nunca.
async function expirarPlanos() {
  try {
    const n = await repositorio.expirarPlanos();
    if (n) log.info(`Planos: ${n} organização(ões) voltaram ao Free (prazo pago terminou).`);
  } catch (e) { log.erro(`Planos: ${e.message}`); }
}
setTimeout(expirarPlanos, 30_000).unref();
setInterval(expirarPlanos, 60 * 60_000).unref();

const app = criarApp({
  repositorio,
  analisar: (entrada) => analisarEdital(entrada),
  obterEdital: obterEditalDoPncp,
  pagamentos,
  detalhes: criarDetalhes({ baseIntegracao: config.pncp.urlIntegracao }),
  opcoes: {
    origens: config.servidor.origens,
    analisesSimultaneas: config.servidor.analisesSimultaneas,
    textoMaxCaracteres: config.servidor.textoMaxCaracteres,
    pdfMaxBytes: maxBytesPdf(),
  },
  log: criarLog('api'),
});

// O site (pasta site/) sai pelo mesmo endereço da API.
// Busca ao vivo no PNCP (por palavra) e itens de cada compra.
ligarPncpAoVivo(app);

// WhatsApp (API oficial da Meta): resposta automática do suporte e alertas.
const whatsapp = configWhatsapp();
ligarWhatsapp(app, { cfg: whatsapp, log: criarLog('whatsapp') });
if (!whatsapp) log.aviso('WHATSAPP_TOKEN não definida: resposta automática e alertas por WhatsApp desligados.');
else if (!whatsapp.segredoApp) log.aviso('WHATSAPP_SEGREDO_APP não definida: as mensagens recebidas no WhatsApp serão recusadas.');


// Robô Turbo 2.0, modo real: cofre de credenciais + sessões com Playwright.
let cofre = null;
if (config.roboReal.chaveCofre) {
  try { cofre = criarCofre(config.roboReal.chaveCofre); } catch (e) { log.erro(e.message); }
} else {
  log.aviso('CREDENCIAIS_CHAVE não definida: cofre de credenciais e modo real do robô desligados.');
}
const gerenciadorReal = cofre ? criarGerenciador({
  admin, cofre, maxSessoes: config.roboReal.maxSessoes, permitirNaoValidado: config.roboReal.permitirNaoValidado,
  headless: config.roboReal.headless, executavel: config.roboReal.executavel, log: criarLog('robo-real'),
  limiteInicial: config.roboReal.limiteInicial, sessoesMinimas: config.roboReal.sessoesIniciais,
}) : null;
ligarModoReal(app, {
  admin, cofre, gerenciador: gerenciadorReal,
  navegadorDisponivel: async () => { try { await import('playwright'); return true; } catch { return false; } },
});

// Janela do Robô Turbo 2.0: a cada minuto, fecha as sessões reais de quem saiu da janela
// (src/pagamentos/ciclo.js). A API e o banco também recusam o robô fora da janela.
if (gerenciadorReal) {
  setInterval(async () => {
    try {
      const n = await gerenciadorReal.encerrarSemAcesso(async (orgId) => {
        const { data } = await admin.from('organizacoes').select('plano, isento, plano_ate, robo_de, robo_ate').eq('id', orgId).maybeSingle();
        return roboLiberado(data);
      });
      if (n) log.info(`Robô: ${n} sessão(ões) encerrada(s) no fim da janela do ciclo.`);
    } catch (e) { log.erro(`Robô (janela do ciclo): ${e.message}`); }
  }, 60_000).unref();
}

const logColeta = criarLogEstruturado('coleta');

// Modo ADM do site (/adm): login com ADMIN_LOGIN_EMAIL + senha, conteúdo editável.
const { sessaoAdm } = ligarAdm(app, { supabase: admin, log: criarLog('adm'), producao: config.site.url.startsWith('https://') });

// Disparo manual protegido: Authorization: Bearer <SCRAPER_ADMIN_TOKEN> ou sessão ADM.
function tokenConfere(c) {
  if (sessaoAdm(c)) return true;
  const esperado = config.coletores.tokenAdmin;
  const recebido = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido); const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
app.get('/api/admin/coleta', (c) => (tokenConfere(c) ? c.json(situacaoColeta()) : c.json({ erro: 'Não autorizado.' }, 401)));
app.post('/api/admin/coleta', async (c) => {
  if (!tokenConfere(c)) return c.json({ erro: 'Não autorizado.' }, 401);
  const corpo = await c.req.json().catch(() => ({}));
  const permitidos = ['fontes', 'ufs', 'desde', 'ate', 'diasAtras', 'modo', 'modalidades', 'maxPaginas', 'simular'];
  const opcoes = Object.fromEntries(Object.entries(corpo || {}).filter(([k]) => permitidos.includes(k)));
  if (situacaoColeta().emExecucao) return c.json({ erro: 'Já existe uma coleta em andamento.', ...situacaoColeta() }, 409);
  const execucao = executarColeta(opcoes, { supabase: admin, log: logColeta, sinal: controleSync.signal });
  // erros de validação aparecem na hora; o resto roda em segundo plano
  const resultado = await Promise.race([execucao.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 50))]);
  if (resultado instanceof Error) return c.json({ erro: resultado.message }, 400);
  execucao.catch((e) => logColeta.erro('manual.falhou', { erro: e.message }));
  return c.json({ iniciada: true, ...situacaoColeta() }, 202);
});

ligarSite(app, { publico: { supabaseUrl: config.supabase.url, supabaseChave: config.supabase.chavePublica, siteUrl: config.site.url, assinatura: configCiclo() } });

// No Render (variável RENDER=true), localhost nos links é sempre engano.
if (process.env.RENDER && /localhost|127\.0\.0\.1/.test(config.site.url)) {
  log.erro(`SITE_URL está como ${config.site.url}. Os links de e-mail e do Mercado Pago vão apontar para localhost. `
    + 'Defina SITE_URL=https://usolicitahub.com.br nas variáveis do Render.');
}

const servidor = serve({ fetch: app.fetch, port: config.servidor.porta }, (info) => {
  log.info(`Site do Uso LicitaHub em http://localhost:${info.port}  (API em /api, teste: /saude)`);
  log.info(`Endereço público (SITE_URL), usado nos e-mails e no Mercado Pago: ${config.site.url}`);
  log.info(`Origens liberadas (CORS): ${config.servidor.origens.join(', ')}`);
});
servidor.on('error', (erro) => {
  if (erro.code === 'EADDRINUSE') {
    log.erro(`A porta ${config.servidor.porta} já está em uso: o Uso LicitaHub provavelmente já está aberto em outra janela. `
      + 'Use a janela que já está aberta (http://localhost:' + config.servidor.porta + ') ou feche-a antes de abrir de novo.');
    process.exit(1);
  }
  throw erro;
});

// Faxina: análises presas (ex.: servidor reiniciado no meio de uma análise).
setInterval(async () => {
  try {
    const n = await repositorio.encerrarTravadas(30);
    if (n) log.aviso(`${n} análise(s) presa(s) marcada(s) como erro.`);
  } catch (e) {
    log.erro(e.message);
  }
}, 10 * 60_000).unref();

// CAPAG do Tesouro: confere 1x por dia; só baixa de novo se o cache tiver mais de 7 dias.
async function capagAgora() {
  try { await atualizarCapag({ supabase: admin, log: criarLog('capag') }); } catch (e) { log.erro(`CAPAG: ${e.message}`); }
}
if (config.servidor.syncIntervaloMin > 0) {
  setTimeout(capagAgora, 60_000).unref();
  setInterval(capagAgora, 24 * 60 * 60_000).unref();
}

// Sincronização automática (incremental) com o PNCP.
const controleSync = new AbortController();
let sincronizando = false;
async function sincronizarAgora() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const r = await sincronizarPncp({ modo: 'atualizacao' }, { supabase: admin, log: criarLog('pncp'), sinal: controleSync.signal });
    log.info(`PNCP: ${r.gravados} licitação(ões) gravada(s), ${r.ignorados} ignorada(s), ${r.falhas.length} falha(s).`);
    if (r.status !== 'concluida') logColeta.erro('ALERTA_COLETA', { origem: 'sincronizador-antigo', status: r.status, falhas: r.falhas.length, gravados: r.gravados, primeiraFalha: r.interrompido || r.falhas[0]?.mensagem });
  } catch (e) {
    if (e.codigo === 'em_andamento') log.aviso(`Sincronização com o PNCP pulada: ${e.message}`);
    else if (!controleSync.signal.aborted) logColeta.erro('ALERTA_COLETA', { origem: 'sincronizador-antigo', status: 'erro', primeiraFalha: e.message });
  } finally {
    sincronizando = false;
  }
}
// Coletores próprios (src/services/collectors). Com ENABLE_SCRAPER_CRON ligado, o cron
// assume a sincronização incremental e o laço antigo (SYNC_INTERVALO_MIN) fica desligado.
async function coletarAgendado() {
  try {
    await executarColeta({ limpar: true }, { supabase: admin, log: logColeta, sinal: controleSync.signal });
  } catch (e) {
    if (e.codigo === 'em_andamento') logColeta.aviso('cron.pulado', { motivo: e.message });
    else if (!controleSync.signal.aborted) logColeta.erro('cron.falhou', { erro: e.message });
  }
}
// Na subida: fecha execuções que ficaram "executando" porque o servidor anterior caiu.
setTimeout(async () => {
  try {
    const n = await fecharAbandonadas(admin);
    if (n) logColeta.aviso('execucoes.abandonadas_fechadas', { quantidade: n });
  } catch (e) { logColeta.aviso('execucoes.abandonadas_falhou', { erro: e.message }); }
}, 5_000).unref();

if (config.coletores.cron) {
  if (config.servidor.syncIntervaloMin > 0) logColeta.info('sincronizador_antigo.desligado', { motivo: 'ENABLE_SCRAPER_CRON ligado: o coletor novo assume' });
  try {
    agendarCron(config.coletores.agenda, coletarAgendado, { log: logColeta });
    logColeta.info('cron.ligado', { agenda: config.coletores.agenda, fontes: config.coletores.fontes, ufs: config.coletores.ufs.length ? config.coletores.ufs : 'todas', modo: config.coletores.modo });
  } catch (e) {
    log.erro(`SCRAPER_CRON_SCHEDULE inválido: ${e.message}`);
  }
}

if (config.servidor.syncIntervaloMin > 0 && !config.coletores.cron) {
  setTimeout(sincronizarAgora, 15_000).unref();
  setInterval(sincronizarAgora, config.servidor.syncIntervaloMin * 60_000).unref();
  log.info(`Sincronização automática com o PNCP a cada ${config.servidor.syncIntervaloMin} min.`);
}

// Inteligência de mercado: resultados homologados do PNCP (vencedores e preços).
// MERCADO_INTERVALO_MIN=0 desliga. Cada rodada consulta até MERCADO_LOTE compras.
const mercadoMin = Number(process.env.MERCADO_INTERVALO_MIN ?? 30);
const mercadoLote = Number(process.env.MERCADO_LOTE ?? 25);
let coletando = false;
const retroLigada = process.env.MERCADO_RETRO !== '0';
const retroHoras = process.env.MERCADO_RETRO_HORAS ?? '0-6';
const retroMeses = Number(process.env.MERCADO_RETRO_MESES ?? 12);
const retroLimiteMb = Number(process.env.MERCADO_LIMITE_MB ?? 400);
const retroTermosExtras = (process.env.MERCADO_RETRO_TERMOS || '').split(',').map((t) => t.trim()).filter(Boolean);
let ultimaDescoberta = 0;
async function coletarMercado() {
  if (coletando) return;
  // Horário de pico (noite e fim de semana): a coleta pesada espera; a madrugada retroativa segue.
  if (emHorarioDePico() && !(retroLigada && dentroDaJanela(retroHoras))) return;
  coletando = true;
  try {
    // Fase 3: de madrugada (MERCADO_RETRO_HORAS), descobre compras antigas dos termos dos
    // clientes (no máximo 1 vez por hora) e completa os lotes com a fila retroativa.
    const noturno = retroLigada && dentroDaJanela(retroHoras);
    if (noturno && Date.now() - ultimaDescoberta >= 60 * 60_000) {
      ultimaDescoberta = Date.now();
      const termos = await termosRetro(admin, { extras: retroTermosExtras });
      const d = await descobrirRetro({ termos, meses: retroMeses, limiteMb: retroLimiteMb }, { supabase: admin, log: criarLog('mercado'), sinal: controleSync.signal });
      if (d.parado) logColeta.erro('ALERTA_COLETA', { origem: 'mercado-retro', status: 'parado', primeiraFalha: d.parado });
      else if (d.paginas) log.info(`Mercado retro: ${d.termos} termo(s), ${d.paginas} página(s), ${d.enfileiradas} compra(s) nova(s) na fila.`);
    }
    const r = await coletarResultados({ lote: noturno ? mercadoLote * 2 : mercadoLote, retro: noturno }, { supabase: admin, log: criarLog('mercado'), sinal: controleSync.signal });
    if (r.compras || r.erros) {
      log.info(`Mercado: ${r.compras} compra(s) consultada(s) (${r.retro} retroativa(s)), ${r.resultados} resultado(s) gravado(s), ${r.semResultado} ainda sem resultado, ${r.erros} erro(s).`);
    }
  } catch (e) {
    if (!controleSync.signal.aborted) log.erro(`Mercado: ${e.message}`);
  } finally {
    coletando = false;
  }
}
if (mercadoMin > 0) {
  setTimeout(coletarMercado, 5 * 60_000).unref();
  setInterval(coletarMercado, mercadoMin * 60_000).unref();
  log.info(`Inteligência de mercado: coleta de resultados do PNCP a cada ${mercadoMin} min.`);
}

// Aviso por e-mail dos NOVOS editais de cada radar (resumo diário).
// RADAR_AVISO=0 desliga; RADAR_AVISO_CRON muda o horário (Brasília; padrão 7h).
if (process.env.RADAR_AVISO !== '0') {
  const canaisEmail = canaisDeEmail();
  const enviarRadar = enviadorDoAmbiente(canaisEmail);
  if (!enviarRadar) {
    log.aviso('RESEND_API_KEY não definida: avisos do Radar por e-mail desligados.');
  } else {
    const agendaRadar = process.env.RADAR_AVISO_CRON || '0 7 * * *';
    let avisando = false;
    try {
      agendarCron(agendaRadar, async () => {
        if (avisando) return;
        avisando = true;
        try {
          const r = await avisarRadares({ supabase: admin, enviar: enviarRadar, site: canaisEmail.site, log: criarLog('radar') });
          log.info(`Radar: ${r.emails} e-mail(s) enviado(s), ${r.licitacoes} licitação(ões) nova(s) em ${r.comNovidade} de ${r.radares} radar(es), ${r.falhas} falha(s).`);
          if (r.falhas) logColeta.erro('ALERTA_COLETA', { origem: 'radar-avisos', status: 'parcial', falhas: r.falhas, emails: r.emails });
        } catch (e) {
          logColeta.erro('ALERTA_COLETA', { origem: 'radar-avisos', status: 'erro', primeiraFalha: e.message });
        } finally { avisando = false; }
      }, { log: logColeta });
      log.info(`Avisos do Radar por e-mail: ${agendaRadar} (horário de Brasília).`);
    } catch (e) { log.erro(`RADAR_AVISO_CRON inválido: ${e.message}`); }
  }
}

// Leitura automática de editais (só organizações que ligaram a opção; respeita a cota).
const leituraMin = Number(process.env.LEITURA_AUTOMATICA_MIN ?? 20);
async function lerAutomaticamente() {
  if (!ia.chaveConfigurada) return;
  try {
    const r = await lerEditaisAutomaticamente({}, { supabase: admin, analisar: app.analisarAutomaticamente, log: criarLog('ia-auto') });
    if (r.iniciadas || r.semCota) {
      log.info(`Leitura automática: ${r.iniciadas} análise(s) iniciada(s)${r.semCota ? `, ${r.semCota} organização(ões) sem cota` : ''}.`);
    }
  } catch (e) { log.erro(e.message); }
}
if (leituraMin > 0) {
  setTimeout(lerAutomaticamente, 2 * 60_000).unref();
  setInterval(lerAutomaticamente, leituraMin * 60_000).unref();
}

function encerrar(sinal) {
  log.info(`Encerrando (${sinal})...`);
  controleSync.abort(new Error('Servidor encerrando.'));
  gerenciadorReal?.encerrarTudo().catch(() => {});
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.once('SIGINT', () => encerrar('SIGINT'));
process.once('SIGTERM', () => encerrar('SIGTERM'));
