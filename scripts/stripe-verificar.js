#!/usr/bin/env node
// Confere a integração com a Stripe de verdade, no MODO DE TESTE (dinheiro de
// mentira), fazendo o caminho de um cliente pela API do Uso LicitaHub:
//   preço do plano -> página de pagamento -> portal do assinante -> assinatura paga
//   -> aviso da Stripe (webhook) chega ao servidor -> plano liberado
//   -> cancelamento -> plano volta ao gratuito
//
//   npm run stripe:verificar                 guarda a assinatura num "banco" na memória
//                                            (não mexe no Supabase)
//   npm run stripe:verificar -- --completo   usa o Supabase de verdade, com um usuário e
//                                            uma organização de teste
//   npm run stripe:verificar -- --manual     como o --completo, mas quem paga é você, na
//                                            página da Stripe, com o cartão de teste
//
// No fim, apaga o que o teste criou (cliente na Stripe; usuário e organização no
// Supabase). Só roda com a chave de teste. Os avisos chegam a este computador pela
// Stripe CLI (npm install -g @stripe/cli).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { criarApp } from '../src/api/app.js';
import { criarRepositorio } from '../src/api/repositorio.js';
import { config } from '../src/config.js';
import { PLANOS, chavePreco, planosPagos } from '../src/pagamentos/planos.js';
import { EVENTOS_STRIPE, clienteStripe, criarPagamentos, modoDaChave } from '../src/pagamentos/stripe.js';
import { criarClienteAdmin, criarClienteDoUsuario } from '../src/supabase.js';

const NO_WINDOWS = process.platform === 'win32';
const ESPERA_AVISO_MS = 45_000;
const ESPERA_PAGAMENTO_MS = 60 * 60_000;
const semSessao = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

const { values: args } = parseArgs({
  options: { completo: { type: 'boolean', default: false }, manual: { type: 'boolean', default: false } },
});
const comSupabase = args.completo || args.manual;

let problemas = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const falha = (msg) => { problemas += 1; console.log(`  ✖ ${msg}`); };
const nota = (msg) => console.log(`  • ${msg}`);
const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const motivo = (e) => (e?.type === 'StripeAuthenticationError'
  ? 'a chave da Stripe foi recusada (confira STRIPE_SECRET_KEY)'
  : e?.message ?? String(e));

function encerrar() {
  console.log(problemas
    ? `\n${problemas} problema(s). Corrija os itens com ✖ e rode de novo: npm run stripe:verificar\n`
    : '\nTudo certo com a Stripe (modo de teste). O que o teste criou já foi apagado.\n');
  process.exit(problemas ? 1 : 0);
}

const modo = modoDaChave();
if (modo !== 'teste') {
  console.error(modo === 'real'
    ? 'Este teste só roda com a chave de TESTE (sk_test_...): ele cria uma assinatura e paga com cartão de teste.'
    : 'Defina STRIPE_SECRET_KEY no arquivo .env (painel da Stripe > Desenvolvedores > Chaves de API).');
  process.exit(1);
}

// --- Stripe CLI ------------------------------------------------------------------

/** Roda a Stripe CLI. No Windows, a instalada pelo npm é um "stripe.cmd", que só roda pelo shell. */
function cli(argumentos, opcoes = {}, sincrono = false) {
  const rodar = sincrono ? spawnSync : spawn;
  const env = { ...process.env, STRIPE_API_KEY: config.stripe.chaveSecreta }; // a chave não vai na linha de comando
  return NO_WINDOWS
    ? rodar(`stripe ${argumentos.join(' ')}`, { ...opcoes, env, shell: true })
    : rodar('stripe', argumentos, { ...opcoes, env });
}

/** Segredo com que a Stripe CLI assina os avisos que ela repassa. */
function prepararCli() {
  if (cli(['--version'], { encoding: 'utf8', timeout: 30_000 }, true).status !== 0) {
    return { erro: 'Stripe CLI não encontrada. Ela traz os avisos da Stripe até este computador. Instale com: npm install -g @stripe/cli' };
  }
  const r = cli(['listen', '--print-secret'], { encoding: 'utf8', timeout: 60_000 }, true);
  const segredo = /whsec_\w+/.exec(r.stdout ?? '')?.[0];
  return segredo
    ? { segredo }
    : { erro: `A Stripe CLI não informou o segredo dos avisos. ${(r.stderr || r.error?.message || '').trim().slice(-300)}` };
}

/** Liga a Stripe CLI repassando os avisos da Stripe para o servidor de teste. */
function repassarAvisos(porta) {
  const processo = cli(['listen', '--events', EVENTOS_STRIPE.join(','), '--forward-to', `http://127.0.0.1:${porta}/stripe/webhook`]);
  let saida = '';
  const pronto = new Promise((resolve, reject) => {
    const ler = (pedaco) => {
      saida = (saida + pedaco).slice(-4000);
      if (saida.includes('Ready!')) resolve();
    };
    processo.stdout.on('data', ler);
    processo.stderr.on('data', ler);
    processo.once('exit', (codigo) => reject(new Error(`a Stripe CLI parou (código ${codigo}). ${saida.trim().slice(-300)}`)));
    setTimeout(() => reject(new Error('a Stripe CLI não ficou pronta em 60 s.')), 60_000).unref();
  });
  return { processo, pronto, ultimasLinhas: () => saida.trim().split('\n').slice(-5).join('\n') };
}

function desligar(processo) {
  if (!processo || processo.exitCode !== null) return;
  if (NO_WINDOWS) spawnSync('taskkill', ['/pid', String(processo.pid), '/T', '/F'], { stdio: 'ignore' });
  else processo.kill();
}

/** Espera a condição ficar verdadeira (os avisos da Stripe levam alguns segundos). */
async function esperar(condicao, ms = ESPERA_AVISO_MS, intervalo = 1000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await condicao()) return true;
    await new Promise((r) => setTimeout(r, intervalo));
  }
  return condicao();
}

// --- Onde a assinatura de teste fica guardada --------------------------------------
// Cada "ambiente" devolve: o repositório que a API usa, a organização de teste, o
// token de login para chamar a API, a situação atual (plano, limites e assinatura
// gravados pelo servidor) e a limpeza do que o teste criou.

function ambienteNaMemoria() {
  const organizacao = { id: randomUUID(), nome: 'Teste automático do Uso LicitaHub' };
  const usuario = { id: randomUUID(), email: 'teste.automatico@example.com' };
  const token = randomBytes(16).toString('hex');
  let assinatura = null;
  let plano = { plano: 'gratuito', ...PLANOS.gratuito.limites };
  return {
    organizacao,
    token,
    repositorio: {
      async usuarioDoToken(t) { return t === token ? usuario : null; },
      comoUsuario: () => ({
        temPapel: async (org) => org === organizacao.id,
        organizacao: async (id) => (id === organizacao.id ? organizacao : null),
      }),
      async assinatura(org) { return org === organizacao.id ? assinatura : null; },
      async salvarAssinatura(org, campos) { if (org === organizacao.id) assinatura = { ...assinatura, ...campos }; },
      async organizacaoDoClienteStripe(id) { return id && assinatura?.stripe_cliente_id === id ? organizacao.id : null; },
      async organizacaoExiste(org) { return org === organizacao.id; },
      async aplicarPlano(org, nome, limites) { if (org === organizacao.id) plano = { plano: nome, ...limites }; },
    },
    async situacao() {
      return {
        plano: plano.plano, empresas: plano.empresas, analises: plano.analisesMes,
        status: assinatura?.status, clienteId: assinatura?.stripe_cliente_id, assinaturaId: assinatura?.stripe_assinatura_id,
      };
    },
    async limpar() {},
  };
}

/** Usuário de teste no Supabase de verdade. O cadastro cria a organização dele (ele é o dono). */
async function ambienteNoSupabase() {
  const admin = criarClienteAdmin();
  const email = `teste-stripe-${randomBytes(4).toString('hex')}@example.com`;
  const senha = randomBytes(24).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: {
      nome: 'Teste da Stripe', empresa: 'Organização de teste da Stripe',
      versao_termos: 'verificacao', versao_privacidade: 'verificacao', aceita_marketing: false,
    },
  });
  if (error) throw new Error(`não consegui criar o usuário de teste no Supabase: ${error.message}`);
  const userId = data.user.id;
  let orgId = null;

  async function limpar() {
    const { error: erro } = await admin.auth.admin.deleteUser(userId);
    if (erro) {
      falha(`Não consegui apagar o usuário de teste ${email}: ${erro.message}. Apague em Authentication > Users.`);
      return;
    }
    if (!orgId) return;
    const { count } = await admin.from('organizacoes').select('id', { count: 'exact' }).eq('id', orgId).limit(0);
    if (count) falha('A organização de teste não foi apagada junto com o usuário.');
  }

  try {
    const { data: perfil } = await admin.from('perfis').select('organizacao_padrao_id').eq('id', userId).maybeSingle();
    orgId = perfil?.organizacao_padrao_id ?? null;
    if (!orgId) throw new Error('o cadastro do usuário de teste não criou a organização (confira com: npm run verificar -- --completo)');
    const { data: organizacao, error: erroOrg } = await admin.from('organizacoes').select('id, nome').eq('id', orgId).single();
    if (erroOrg) throw new Error(`não consegui ler a organização de teste: ${erroOrg.message}`);
    const login = await createClient(config.supabase.url, config.supabase.chavePublica, semSessao)
      .auth.signInWithPassword({ email, password: senha });
    if (login.error) throw new Error(`o login do usuário de teste falhou: ${login.error.message}`);
    return {
      email,
      organizacao,
      token: login.data.session.access_token,
      repositorio: criarRepositorio({ admin, criarClienteDoUsuario }),
      async situacao() {
        const [org, assinatura] = await Promise.all([
          admin.from('organizacoes').select('plano, limite_empresas, limite_analises_ia_mes').eq('id', orgId).maybeSingle(),
          admin.from('assinaturas').select('status, stripe_cliente_id, stripe_assinatura_id').eq('organizacao_id', orgId).maybeSingle(),
        ]);
        if (org.error || assinatura.error) throw new Error(`não consegui ler o banco: ${(org.error ?? assinatura.error).message}`);
        return {
          plano: org.data?.plano, empresas: org.data?.limite_empresas, analises: org.data?.limite_analises_ia_mes,
          status: assinatura.data?.status, clienteId: assinatura.data?.stripe_cliente_id,
          assinaturaId: assinatura.data?.stripe_assinatura_id,
        };
      },
      limpar,
    };
  } catch (e) {
    await limpar();
    throw e;
  }
}

/** Chama a API do Uso LicitaHub logado como o usuário de teste. */
async function chamarApi(porta, caminho, token, corpo) {
  const r = await fetch(`http://127.0.0.1:${porta}${caminho}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`a API respondeu ${r.status} em ${caminho}: ${json.erro ?? 'sem detalhes'}`);
  return json;
}

/** Páginas provisórias no endereço do site, para a volta da página de pagamento não dar erro. */
function paginasProvisorias() {
  const site = new URL(config.stripe.urlSite);
  if (!['localhost', '127.0.0.1'].includes(site.hostname)) return Promise.resolve(null);
  const textos = {
    '/assinatura/sucesso': ['Pagamento de teste concluído ✔', 'Pode voltar ao chat: o teste confere o resto sozinho.'],
    '/precos': ['Pagamento cancelado', 'Você saiu da página de pagamento sem pagar.'],
    '/painel': ['Painel do Uso LicitaHub', 'Você voltou do portal do assinante.'],
  };
  const paginas = createServer((pedido, resposta) => {
    const [titulo, texto] = textos[new URL(pedido.url, site).pathname] ?? ['Uso LicitaHub', ''];
    resposta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    resposta.end(`<!doctype html><meta charset="utf-8"><title>${titulo}</title>`
      + '<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px">'
      + `<h1>${titulo}</h1><p>${texto}</p>`
      + '<p style="color:#777">Página provisória: o site do Uso LicitaHub ainda vai ser feito.</p></body>');
  });
  return new Promise((resolve) => {
    paginas.once('error', () => resolve(null)); // porta ocupada: segue sem as páginas
    paginas.listen(Number(site.port || 80), site.hostname, () => resolve(paginas));
  });
}

// --- 1. Conta, preços e portal --------------------------------------------------

const stripe = clienteStripe();
const [planoTeste] = planosPagos();
const [cicloTeste] = Object.keys(PLANOS[planoTeste].precos);
const nomePlano = PLANOS[planoTeste].nome;
console.log(`\nVerificando a Stripe do Uso LicitaHub (modo de teste, dinheiro de mentira${comSupabase ? ', com o Supabase de verdade' : ''})...\n`);

const precos = new Map();
try {
  const conta = await stripe.accounts.retrieve();
  ok(`Chave de teste aceita (conta do país ${conta.country}, moeda ${conta.default_currency?.toUpperCase()})`);

  for (const id of planosPagos()) {
    for (const [ciclo, valor] of Object.entries(PLANOS[id].precos)) {
      const { data: [preco] } = await stripe.prices.list({ lookup_keys: [chavePreco(id, ciclo)], active: true, limit: 1 });
      const nome = `Plano ${PLANOS[id].nome} ${ciclo}`;
      if (!preco) {
        falha(`${nome}: não está na Stripe. Rode: npm run stripe:configurar`);
      } else if (preco.unit_amount !== valor || preco.currency !== 'brl') {
        falha(`${nome}: na Stripe está ${reais(preco.unit_amount)}, o Uso LicitaHub espera ${reais(valor)}. Rode: npm run stripe:configurar`);
      } else {
        ok(`${nome}: ${reais(valor)}`);
        precos.set(chavePreco(id, ciclo), preco);
      }
    }
  }

  const { data: [portal] } = await stripe.billingPortal.configurations.list({ is_default: true, active: true, limit: 1 });
  if (portal) ok('Portal do assinante configurado');
  else falha('O portal do assinante não está configurado. Rode: npm run stripe:configurar');
} catch (e) {
  falha(`Não consegui falar com a Stripe: ${motivo(e)}`);
}
if (problemas) encerrar();

// --- 2. Caminho de um cliente, com um servidor de teste neste computador ---------

const avisos = new Set();
let ambiente;
let servidor;
let paginas;
let ouvinte;
let sessaoId;
let clienteId;
try {
  ambiente = comSupabase ? await ambienteNoSupabase() : ambienteNaMemoria();
  if (comSupabase) ok(`Usuário e organização de teste criados no Supabase (${ambiente.email})`);

  const { segredo, erro } = prepararCli();
  if (erro) falha(erro);
  const pagamentos = criarPagamentos({
    stripe, repositorio: ambiente.repositorio, opcoes: { segredoWebhook: segredo ?? '' }, log: { aviso: nota },
  });
  const processar = pagamentos.processarEvento;
  pagamentos.processarEvento = (evento) => {
    avisos.add(evento.type);
    return processar(evento);
  };

  const naoUsado = async () => { throw new Error('não usado neste teste'); };
  const app = criarApp({
    repositorio: ambiente.repositorio, analisar: naoUsado, obterEdital: naoUsado, pagamentos,
    log: { info() {}, aviso: nota, erro: (m) => console.log(`  ! ${m}`) },
  });
  const porta = await new Promise((resolve) => {
    servidor = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => resolve(info.port));
  });
  if (segredo) {
    ouvinte = repassarAvisos(porta);
    await ouvinte.pronto;
    ok('Stripe CLI trazendo os avisos da Stripe para um servidor de teste neste computador');
  }

  const org = ambiente.organizacao.id;
  const api = (caminho, corpo) => chamarApi(porta, caminho, ambiente.token, corpo);
  const checkout = await api('/api/assinaturas/checkout', { organizacao_id: org, plano: planoTeste, ciclo: cicloTeste });
  sessaoId = checkout.id;
  clienteId = (await ambiente.situacao()).clienteId;
  if (checkout.url?.startsWith('https://checkout.stripe.com/')) {
    ok(`Página de pagamento criada pela API${checkout.dias_teste ? ` (com ${checkout.dias_teste} dias grátis)` : ''}`);
  } else {
    falha(`A página de pagamento veio sem endereço da Stripe: ${checkout.url}`);
  }

  const portal = await api('/api/assinaturas/portal', { organizacao_id: org });
  if (portal.url?.startsWith('https://billing.stripe.com/')) ok('Portal do assinante abre pela API (trocar cartão, ver faturas, cancelar)');
  else falha(`O portal veio sem endereço da Stripe: ${portal.url}`);

  if (segredo) {
    const liberado = async (situacoes) => {
      const s = await ambiente.situacao();
      return s.plano === planoTeste && situacoes.includes(s.status);
    };
    const limites = async () => {
      const s = await ambiente.situacao();
      return `${s.empresas} empresas, ${s.analises} leituras de edital por mês`;
    };
    let liberou;

    if (args.manual) {
      paginas = await paginasProvisorias();
      console.log('\n  → Abra o link abaixo e pague com o cartão de teste 4242 4242 4242 4242,'
        + ' qualquer data futura e qualquer CVC (é dinheiro de mentira):'
        + `\n\n     ${checkout.url}\n`);
      if (!paginas) nota(`Depois de pagar, a volta para ${config.stripe.urlSite} vai mostrar um erro: o site ainda não existe. É normal.`);
      nota(`Esperando o pagamento por até ${ESPERA_PAGAMENTO_MS / 60_000} minutos...`);
      liberou = await esperar(() => liberado(['trialing', 'active']), ESPERA_PAGAMENTO_MS, 3000);
      if (liberou) {
        const { status } = await ambiente.situacao();
        ok(`Pagamento feito na página da Stripe: aviso conferido e plano ${nomePlano} liberado `
          + `(${status === 'trialing' ? 'em teste grátis' : status}; ${await limites()})`);
      } else {
        falha(`Ninguém pagou em ${ESPERA_PAGAMENTO_MS / 60_000} minutos, ou o aviso não chegou. Últimas linhas da Stripe CLI:\n${ouvinte.ultimasLinhas()}`);
      }
    } else {
      // A página de pagamento só pode ser preenchida por uma pessoa. Para o teste ser
      // automático, a assinatura é criada direto, paga com o cartão de teste
      // brasileiro da Stripe. Os avisos que chegam são os mesmos de um pagamento pela página.
      const preco = precos.get(chavePreco(planoTeste, cicloTeste));
      const cartao = await stripe.paymentMethods.attach('pm_card_br', { customer: clienteId })
        .catch(() => stripe.paymentMethods.attach('pm_card_visa', { customer: clienteId }));
      const sub = await stripe.subscriptions.create({
        customer: clienteId,
        items: [{ price: preco.id }],
        default_payment_method: cartao.id,
        metadata: { organizacao_id: org },
        payment_behavior: 'error_if_incomplete',
      });
      ok(`Assinatura de teste paga com o cartão de teste: ${reais(preco.unit_amount)} (situação na Stripe: ${sub.status})`);
      liberou = await esperar(() => liberado(['active']));
      if (liberou) ok(`Aviso de pagamento conferido e plano ${nomePlano} liberado (${await limites()})`);
      else falha(`O aviso de pagamento não liberou o plano em ${ESPERA_AVISO_MS / 1000} s. Últimas linhas da Stripe CLI:\n${ouvinte.ultimasLinhas()}`);
    }

    // Só dá para conferir a volta ao gratuito se o plano chegou a ser liberado.
    if (liberou) {
      await stripe.subscriptions.cancel((await ambiente.situacao()).assinaturaId);
      if (await esperar(async () => (await ambiente.situacao()).plano === 'gratuito')) {
        ok(`Cancelamento: aviso conferido e plano voltou ao Gratuito (${await limites()})`);
      } else {
        falha(`O aviso de cancelamento não chegou em ${ESPERA_AVISO_MS / 1000} s. Últimas linhas da Stripe CLI:\n${ouvinte.ultimasLinhas()}`);
      }
    }
    nota(`Avisos recebidos: ${[...avisos].join(', ') || 'nenhum'}`);
  }
} catch (e) {
  falha(`Erro: ${motivo(e)}`);
} finally {
  desligar(ouvinte?.processo);
  paginas?.close();
  if (sessaoId) await stripe.checkout.sessions.expire(sessaoId).catch(() => {});
  if (clienteId) await stripe.customers.del(clienteId).catch(() => {}); // apaga também a assinatura de teste
  if (ambiente) await ambiente.limpar().catch((e) => falha(`Não consegui apagar os dados de teste: ${e.message}`));
  servidor?.close();
}
encerrar();
