// =============================================================================
// Uso LicitaHub · Ciclo da assinatura e janela do Robô Turbo 2.0
//
// Cada cobrança aprovada no cartão abre um CICLO:
//   dia 1 ......... dia ROBO_DIAS       plataforma + Robô Turbo 2.0 (plano Max)
//   dia ROBO_DIAS+1 ... dia CICLO_DIAS  só a plataforma (o robô fecha sozinho)
// Na renovação (nova cobrança aprovada) a janela do robô abre de novo.
//
// Configurável por variável de ambiente (padrão 30 dias, 7 de robô):
//   ASSINATURA_CICLO_DIAS=30   ASSINATURA_ROBO_DIAS=7
// Contas isentas (organizacoes.isento) ignoram tudo isto: acesso total, sempre.
// O banco confere a mesma regra (função public.robo_liberado) para o robô.
// =============================================================================

const DIA = 86_400_000;

function inteiro(valor, padrao, min, max) {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : padrao;
}

/** Ciclo e janela do robô (em dias) a partir do ambiente. A janela nunca passa do ciclo. */
export function configCiclo(env = process.env) {
  const cicloDias = inteiro(env.ASSINATURA_CICLO_DIAS, 30, 1, 365);
  const roboDias = Math.min(inteiro(env.ASSINATURA_ROBO_DIAS, 7, 0, 365), cicloDias);
  return { cicloDias, roboDias };
}

/**
 * Datas do novo ciclo depois de uma cobrança aprovada.
 * Renovação do MESMO plano antes do fim: o ciclo novo começa quando o atual termina
 * (não perde dias). Plano novo, troca de plano ou ciclo vencido: começa agora.
 */
export function novoCiclo({ fimAtual = null, mesmoPlano = false, agora = new Date(), config = configCiclo() } = {}) {
  const fim = fimAtual ? new Date(fimAtual) : null;
  const inicio = mesmoPlano && fim && fim > agora ? fim : agora;
  const iso = (ms) => new Date(ms).toISOString();
  return {
    inicio: iso(inicio.getTime()),
    fim: iso(inicio.getTime() + config.cicloDias * DIA),
    roboDe: iso(inicio.getTime()),
    roboAte: iso(inicio.getTime() + config.roboDias * DIA),
  };
}

/**
 * O robô está liberado para esta organização agora?
 * org: { plano, isento, plano_ate, robo_de, robo_ate }
 * Conta antiga sem robo_ate (paga antes desta regra): vale até o fim do prazo pago.
 */
export function roboLiberado(org, agora = new Date()) {
  if (!org) return false;
  if (org.isento === true) return true;
  if (org.plano !== 'max') return false;
  if (!org.plano_ate || new Date(org.plano_ate) <= agora) return false;
  if (org.robo_de && new Date(org.robo_de) > agora) return false;
  const ate = org.robo_ate ?? org.plano_ate;
  return new Date(ate) > agora;
}

/** Situação do robô para mostrar (tela e ADM). */
export function situacaoRobo(org, agora = new Date()) {
  if (org?.isento === true) return { liberado: true, motivo: 'isento' };
  if (org?.plano !== 'max' || !org?.plano_ate || new Date(org.plano_ate) <= agora) return { liberado: false, motivo: 'plano' };
  if (roboLiberado(org, agora)) return { liberado: true, motivo: 'janela', ate: org.robo_ate ?? org.plano_ate };
  return { liberado: false, motivo: 'janela_encerrada', volta: org.plano_ate };
}
