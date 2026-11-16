// Configuração central. Os valores vêm do arquivo .env (veja .env.exemplo).

function texto(nome, padrao = '') {
  const v = process.env[nome];
  return v === undefined || v.trim() === '' ? padrao : v.trim();
}

function inteiro(nome, padrao) {
  const v = Number.parseInt(texto(nome, ''), 10);
  return Number.isFinite(v) ? v : padrao;
}

function lista(nome, padrao = []) {
  const v = texto(nome, '');
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : padrao;
}

// Endereço público do site (ex.: https://usolicitahub.com.br), sem barra no fim.
// É a base de TODOS os links que saem do sistema: confirmação de cadastro,
// redefinição de senha e volta da Stripe. No computador, cai em localhost.
const URL_SITE = texto('SITE_URL', `http://localhost:${inteiro('PORTA', 8787)}`).replace(/\/+$/, '');

export const config = {
  site: {
    url: URL_SITE,
  },

  supabase: {
    url: texto('SUPABASE_URL'),
    // Chave pública (publishable/anon): a mesma usada no front-end.
    chavePublica: texto('SUPABASE_PUBLISHABLE_KEY', texto('SUPABASE_ANON_KEY')),
    // Chave secreta (secret/service_role): SÓ no servidor. Ignora o RLS.
    chaveSecreta: texto('SUPABASE_SECRET_KEY', texto('SUPABASE_SERVICE_ROLE_KEY')),
  },

  ia: {
    // Quem lê os editais: "gemini" (padrão, tem plano gratuito) ou "claude".
    provedor: texto('IA_PROVEDOR', 'gemini').toLowerCase(),
  },

  gemini: {
    chave: texto('GEMINI_API_KEY', texto('GOOGLE_API_KEY')),
    // Estável, com plano gratuito e leitura de PDF (docs do Google, nov/2026).
    modelo: texto('GEMINI_MODELO', 'gemini-4-hydrogen'),
    // Raciocínio: low | medium | high | xhigh | auto (auto = padrão do modelo)
    pensamento: texto('GEMINI_PENSAMENTO', 'high'),
    maxTokens: inteiro('GEMINI_MAX_TOKENS', 65536),
    // "gratuito" (custo zero, mas o Google pode usar os dados) ou "pago"
    plano: texto('GEMINI_PLANO', 'gratuito').toLowerCase(),
    // Preço por milhão de tokens (US$) no plano pago. Confira em aistudio.google.com/docs/pricing
    precos: {
      'gemini-4-hydrogen': { entrada: 1.5, saida: 7.5 },
    },
  },

  claude: {
    // A chave ANTHROPIC_API_KEY é lida automaticamente pelo SDK oficial.
    modelo: texto('CLAUDE_MODELO', 'claude-sonnet-5-5'),
    esforco: texto('CLAUDE_ESFORCO', 'high'), // low | medium | high | xhigh | max
    maxTokens: inteiro('CLAUDE_MAX_TOKENS', 64000),
    // Preço por milhão de tokens (US$), para estimar custo. Confira em
    // https://www.anthropic.com/pricing antes de cobrar clientes.
    precos: {
      'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.1, cacheEscrita: 2.5 },
      'claude-sonnet-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
      'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
      'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
    },
  },

  stripe: {
    // Chave secreta (sk_test_... no modo de teste, sk_live_... no real). SÓ no servidor.
    chaveSecreta: texto('STRIPE_SECRET_KEY'),
    // Segredo do webhook (whsec_...): prova que o aviso veio mesmo da Stripe.
    segredoWebhook: texto('STRIPE_WEBHOOK_SECRET'),
    // Endereço do site: para onde o cliente volta depois de pagar. O servidor
    // entrega o site no mesmo endereço da API (src/api/site.js).
    urlSite: URL_SITE,
    // Dias de teste grátis nos planos pagos (0 = sem teste). Uma vez por organização.
    diasTeste: inteiro('STRIPE_DIAS_TESTE', 7),
    // Formas de pagamento no checkout (ex.: card,boleto). Vazio = as ativadas no painel.
    formasPagamento: lista('STRIPE_FORMAS_PAGAMENTO', []),
  },

  pncp: {
    urlConsulta: texto('PNCP_URL_CONSULTA', 'https://pncp.gov.br/api/consulta'),
    urlIntegracao: texto('PNCP_URL_INTEGRACAO', 'https://pncp.gov.br/api/pncp'),
    modalidades: lista('PNCP_MODALIDADES', ['6', '8', '4']).map(Number),
    diasAFrente: inteiro('PNCP_DIAS', 60),
    timeoutMs: inteiro('PNCP_TIMEOUT_MS', 90_000),
    tentativas: inteiro('PNCP_TENTATIVAS', 4),
    // Uma consulta por vez: com várias simultâneas o PNCP recusa (HTTP 429).
    concorrencia: inteiro('PNCP_CONCORRENCIA', 1),
    intervaloMs: inteiro('PNCP_INTERVALO_MS', 1000),
    maxPaginas: inteiro('PNCP_MAX_PAGINAS', 400),
    guardarBruto: texto('PNCP_GUARDAR_BRUTO', '0') === '1',
    limparDias: inteiro('LIMPAR_DIAS', 90),
  },

  servidor: {
    porta: inteiro('PORTA', 8787),
    origens: lista('CORS_ORIGENS', ['http://localhost:5500', 'http://127.0.0.1:5500']),
    syncIntervaloMin: inteiro('SYNC_INTERVALO_MIN', 60),
    analisesSimultaneas: inteiro('ANALISES_SIMULTANEAS', 2),
    pdfMaxMb: inteiro('PDF_MAX_MB', 20),
    textoMaxCaracteres: inteiro('TEXTO_MAX_CARACTERES', 1_500_000),
  },
};

export function exigir(valor, nomeVariavel) {
  if (!valor) {
    throw new Error(`Configuração ausente: defina ${nomeVariavel} no arquivo .env (veja .env.exemplo).`);
  }
  return valor;
}
