// Servidor do Uso LicitaHub: API de análise de editais (Claude) + sincronização
// automática com o PNCP. Rode com: npm run servidor
import { serve } from '@hono/node-server';
import { criarApp } from './api/app.js';
import { criarRepositorio } from './api/repositorio.js';
import { ligarSite } from './api/site.js';
import { config } from './config.js';
import { analisarEdital, provedorDaIa } from './ia/analisar-edital.js';
import { maxBytesPdf, obterEditalDoPncp } from './ia/documento.js';
import { criarPagamentos, modoDoToken } from './pagamentos/mercadopago.js';
import { criarDetalhes } from './pncp/detalhes.js';
import { sincronizarPncp } from './pncp/sincronizar.js';
import { atualizarCapag } from './capag/atualizar.js';
import { criarClienteAdmin, criarClienteDoUsuario } from './supabase.js';
import { criarLog } from './util.js';
import { criarCofre } from './cofre.js';
import { ligarModoReal } from './api/modo-real.js';
import { ligarPncpAoVivo } from './api/pncp-ao-vivo.js';
import { criarGerenciador } from '../worker/gerenciador.js';

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
}) : null;
ligarModoReal(app, {
  admin, cofre, gerenciador: gerenciadorReal,
  navegadorDisponivel: async () => { try { await import('playwright'); return true; } catch { return false; } },
});

ligarSite(app, { publico: { supabaseUrl: config.supabase.url, supabaseChave: config.supabase.chavePublica, siteUrl: config.site.url } });

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
  } catch (e) {
    if (!controleSync.signal.aborted) log.erro(`Sincronização com o PNCP falhou: ${e.message}`);
  } finally {
    sincronizando = false;
  }
}
if (config.servidor.syncIntervaloMin > 0) {
  setTimeout(sincronizarAgora, 15_000).unref();
  setInterval(sincronizarAgora, config.servidor.syncIntervaloMin * 60_000).unref();
  log.info(`Sincronização automática com o PNCP a cada ${config.servidor.syncIntervaloMin} min.`);
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
