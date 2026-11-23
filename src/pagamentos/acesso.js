// =============================================================================
// Uso LicitaHub · Controle de acesso por plano (paywall)
//
//   free  (plano 'gratuito')            sem Prospecção e sem Robô Turbo 2.0
//   pro   (plano 'starter', R$ 97/mês)  tudo, menos o Robô Turbo 2.0
//   max   (plano 'max',     R$ 197/mês) tudo
//
// ISENÇÃO: organização com organizacoes.isento = true tem acesso a TUDO, para
// sempre, sem cobrança, ignorando o plano. Todas as contas que já existiam
// quando o paywall entrou no ar foram marcadas como isentas.
// =============================================================================

export const NIVEIS = ['free', 'pro', 'max'];

/** Plano gravado no banco -> nível de acesso. */
export function nivelDoPlano(plano) {
  if (plano === 'max') return 'max';
  if (['starter', 'prime', 'pro'].includes(plano)) return 'pro';
  return 'free';
}

/** Nível de uma organização ({ plano, isento, plano_ate }). Isenta = max; prazo pago vencido = free. */
export function nivelDaOrganizacao(org, agora = new Date()) {
  if (org?.isento === true) return 'max';
  if (org?.plano_ate && new Date(org.plano_ate) <= agora) return 'free';
  return nivelDoPlano(org?.plano);
}

/** O maior nível entre as organizações de que a pessoa participa. */
export function nivelDoUsuario(organizacoes = []) {
  return organizacoes.map((o) => nivelDaOrganizacao(o)).reduce((a, n) => (NIVEIS.indexOf(n) > NIVEIS.indexOf(a) ? n : a), 'free');
}

export const permite = (nivel, exigido) => NIVEIS.indexOf(nivel) >= NIVEIS.indexOf(exigido);

/** Rotas da API que exigem plano. A ordem importa: a primeira que casar vale. */
export const ROTAS_PROTEGIDAS = [
  // Robô: plano Max E dentro da janela do robô do ciclo (src/pagamentos/ciclo.js).
  [/^\/api\/robo\//, 'robo'],
  [/^\/api\/portais\//, 'robo'], // credenciais dos portais (usadas só pelo robô)
  [/^\/api\/pncp\//, 'pro'],
  [/^\/api\/licitacoes\//, 'pro'],
];

export const nivelExigido = (caminho) => ROTAS_PROTEGIDAS.find(([re]) => re.test(caminho))?.[1] ?? null;

const NOME = { pro: 'Pro', max: 'Max' };

/** Middleware do Hono: confere o plano antes das rotas protegidas. */
export function middlewareDePlano() {
  return async (c, next) => {
    const exigido = nivelExigido(c.req.path);
    if (!exigido) return next();
    if (exigido === 'robo') {
      const db = c.get('db');
      if (await db.roboLiberado()) return next();
      const nivel = await db.nivelDeAcesso();
      return c.json(nivel === 'max'
        ? { erro: 'O período do Robô Turbo 2.0 deste ciclo terminou. Ele volta a funcionar na renovação da assinatura; a plataforma continua liberada.', codigo: 'robo_janela_encerrada', exigido: 'max', nivel }
        : { erro: 'O Robô Turbo 2.0 faz parte do plano Max. Faça o upgrade para usar.', codigo: 'plano_insuficiente', exigido: 'max', nivel }, 402);
    }
    const nivel = await c.get('db').nivelDeAcesso();
    if (permite(nivel, exigido)) return next();
    return c.json({
      erro: exigido === 'max'
        ? 'O Robô Turbo 2.0 faz parte do plano Max (R$ 197/mês). Faça o upgrade para usar.'
        : `Este recurso faz parte do plano ${NOME[exigido]}. Faça o upgrade para usar.`,
      codigo: 'plano_insuficiente', exigido, nivel,
    }, 402);
  };
}
