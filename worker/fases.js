// Fases do modo real do Robô Turbo 2.0 e travas de segurança.
//
// Dois eixos independentes decidem o que o robô pode fazer num portal:
//
// 1) ETAPA DO PORTAL (global, depende de nós: o mapeamento da página)
//      mapeamento  nada conferido ainda
//      login       login mapeado e conferido: o robô sabe entrar (teste de login)
//      leitura     sala de disputa mapeada e conferida "só monitorando": acompanhamento ao vivo
//      lances      envio de lances conferido: o robô pode dar lances reais
//
// 2) SITUAÇÃO DA CREDENCIAL (por usuário e portal, depende da conta no portal)
//      sem_credencial        nada salvo no cofre (não é gravado: é a ausência da linha)
//      nao_testada           salva, mas o login ainda não foi testado
//      aguardando_validacao  o portal ainda não aprovou o cadastro
//      credencial_ok         o último teste/conexão entrou no portal
//      bloqueada             senha recusada, conta suspensa ou verificação humana (captcha)
//
// Fluxo: 1) testar o login (sem pregão)  ->  2) monitorar um pregão real
// (sem lances)  ->  3) lances reais, começando por itens de valor baixo.

export const ETAPAS_PORTAL = Object.freeze(['mapeamento', 'login', 'leitura', 'lances']);
export const SITUACOES_CREDENCIAL = Object.freeze(['nao_testada', 'aguardando_validacao', 'credencial_ok', 'bloqueada']);

const ordem = (etapa) => Math.max(0, ETAPAS_PORTAL.indexOf(etapa));
/** A etapa do portal chega pelo menos até "minima"? */
export const etapaAtinge = (etapa, minima) => ordem(etapa) >= ordem(minima);

/** Etapa de um mapa de seletores. validado: true (legado) = lances liberados. */
export function etapaDoPortal(sel) {
  if (sel?.validado) return 'lances';
  return ETAPAS_PORTAL.includes(sel?.etapa) ? sel.etapa : 'mapeamento';
}

const sem = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Traduz a falha de um login no que ela diz sobre a CONTA.
 * Devolve { situacao, detalhe } ou null quando a falha não é da conta
 * (rede, tempo esgotado, navegador, tela mudou): nesse caso a situação não muda.
 */
export function classificarFalhaLogin(erro) {
  const codigo = erro?.codigo;
  const texto = sem(erro?.message);
  if (codigo === 'captcha') return { situacao: 'bloqueada', detalhe: 'O portal pediu verificação humana (captcha). O robô não contorna essa proteção: entre uma vez pelo navegador e tente de novo mais tarde.' };
  if (codigo === 'conta_pendente') return { situacao: 'aguardando_validacao', detalhe: erro.message };
  if (codigo === 'conta_bloqueada') return { situacao: 'bloqueada', detalhe: erro.message };
  if (codigo !== 'login') return null;
  if (/analise|aguardando|pendente|nao (foi )?(aprovad|validad|ativad|homologad)|em validacao|confirme seu (e-?mail|cadastro)|ativacao/.test(texto)) {
    return { situacao: 'aguardando_validacao', detalhe: erro.message };
  }
  if (/senha|usuario|e-?mail|invalid|incorret|bloquead|suspens|inativ|desativad|tentativas/.test(texto)) {
    return { situacao: 'bloqueada', detalhe: erro.message };
  }
  return null; // "não consegui confirmar o login": pode ser a tela, não a conta
}

const MSG_SITUACAO = {
  aguardando_validacao: 'Sua conta neste portal ainda está em validação. Quando o portal aprovar, use "Testar login" no cofre.',
  bloqueada: 'O último login neste portal foi recusado. Confira a senha no cofre (ou a conta no portal) e use "Testar login".',
};

/**
 * O robô pode abrir uma sessão real? Devolve { ok: true } ou { ok: false, codigo, mensagem, status }.
 *   modo: 'monitorar' | 'lances'
 *   permitirNaoValidado: só para mapear em ambiente de teste (ROBO_SELETORES_NAO_VALIDADOS=permitir)
 */
export function podeConectar({ etapaPortal, situacaoCredencial, modo, permitirNaoValidado = false }) {
  if (!situacaoCredencial || situacaoCredencial === 'sem_credencial') {
    return { ok: false, status: 409, codigo: 'sem_credencial', mensagem: 'Salve a credencial deste portal no cofre antes de conectar.' };
  }
  if (MSG_SITUACAO[situacaoCredencial]) {
    return { ok: false, status: 409, codigo: situacaoCredencial === 'bloqueada' ? 'credencial_bloqueada' : 'conta_pendente', mensagem: MSG_SITUACAO[situacaoCredencial] };
  }
  if (modo === 'lances') {
    if (!etapaAtinge(etapaPortal, 'lances')) {
      return { ok: false, status: 409, codigo: 'lances_nao_liberados', mensagem: 'Os lances reais ainda não foram liberados neste portal: primeiro a leitura da sala é conferida "só monitorando" numa disputa real.' };
    }
    if (situacaoCredencial !== 'credencial_ok') {
      return { ok: false, status: 409, codigo: 'login_nao_testado', mensagem: 'Antes de dar lances reais, teste o login deste portal no cofre ("Testar login").' };
    }
    return { ok: true };
  }
  if (!etapaAtinge(etapaPortal, 'leitura') && !permitirNaoValidado) {
    return {
      ok: false, status: 409, codigo: 'leitura_nao_validada',
      mensagem: etapaAtinge(etapaPortal, 'login')
        ? 'O robô já sabe entrar neste portal, mas a sala de disputa ainda está sendo mapeada. Por enquanto, use "Testar login" no cofre e a Sala Simulada.'
        : 'Este portal ainda está em adaptação para o modo real. Use a Sala Simulada.',
    };
  }
  return { ok: true };
}

/**
 * Cautela nos primeiros lances reais: enquanto a organização tiver menos de
 * "sessoesMinimas" disputas reais concluídas, o valor total do item (teto x quantidade)
 * não pode passar de "limite". limite = 0 desliga a regra.
 */
export function cautelaInicial({ teto, quantidade = 1, sessoesConcluidas = 0, limite = 2000, sessoesMinimas = 3 }) {
  if (!limite || sessoesConcluidas >= sessoesMinimas) return { ok: true };
  const total = Number(teto || 0) * Math.max(1, Number(quantidade) || 1);
  if (total <= limite) return { ok: true };
  const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return {
    ok: false, status: 409, codigo: 'cautela_inicial',
    mensagem: `Nas ${sessoesMinimas} primeiras disputas com lances reais, o robô só opera itens de até ${reais(limite)} no total (teto x quantidade). Este item soma ${reais(total)}. Comece por um item menor e acompanhe a disputa.`,
  };
}
