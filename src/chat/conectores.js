// Conectores de LEITURA PÚBLICA do chat por portal (sem senha do usuário).
//
// Contrato de um conector:
//   { portal, nome, validado, motivo?, chave(pregao) -> string|null,
//     listar(chave, { obter, sinal }) -> [{ autor, texto, enviadaEm, idExterno }] }
// "validado" só vira true depois de conferido numa sessão real; enquanto for
// false o monitor só usa o conector com CHAT_CONECTORES_NAO_VALIDADOS=permitir.
//
// Portais sem leitura pública mapeada recebem as mensagens pela SESSÃO DO ROBÔ
// (modo real, credencial do próprio cliente), que já grava na mesma caixa.

const num = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * Chave da compra no Compras.gov.br: UASG (6) + modalidade (2) + número (5) + ano (4),
 * ex.: 943001 05 01063 2026. Aceita a chave pronta, o link de acompanhamento ou { uasg, numero, ano }.
 */
export function chaveComprasnet(p) {
  if (!p) return null;
  const texto = typeof p === 'string' ? p : p.compra || p.link || '';
  const daUrl = /compra=(\d{17})/.exec(texto)?.[1] || (/^\d{17}$/.test(num(texto)) ? num(texto) : null);
  if (daUrl) return daUrl;
  if (typeof p === 'object' && p.uasg && p.numero && p.ano) {
    const modalidade = num(p.modalidade || '05').padStart(2, '0');
    return `${num(p.uasg).padStart(6, '0')}${modalidade}${num(p.numero).padStart(5, '0')}${num(p.ano)}`;
  }
  return null;
}

/** Lê os campos de uma mensagem em formatos diferentes (a API não é documentada). */
export function mensagemDoPortal(m) {
  const texto = m.texto ?? m.mensagem ?? m.conteudo ?? m.descricao ?? m.text ?? '';
  const autor = m.remetente ?? m.autor ?? m.perfil ?? m.tipoRemetente ?? m.usuario ?? m.origem ?? null;
  const quando = m.dataHora ?? m.dataHoraEnvio ?? m.dataEnvio ?? m.data ?? m.horario ?? null;
  return {
    texto: String(texto || '').trim(),
    autor: autor == null ? null : String(typeof autor === 'object' ? (autor.nome || autor.descricao || '') : autor),
    enviadaEm: quando && !Number.isNaN(new Date(quando).getTime()) ? new Date(quando).toISOString() : null,
    idExterno: m.id ?? m.identificador ?? m.sequencial ?? null,
  };
}

export const CONECTORES = {
  comprasnet: {
    portal: 'comprasnet',
    nome: 'Compras.gov.br',
    validado: false,
    // 19/11/2026: a página pública de acompanhamento só mostra o chat depois de
    // um CAPTCHA (o pedido a comprasnet-mensagem/v2/chat/{compra} leva o token).
    // Leitura automática exigiria burlar essa proteção: NÃO fazemos. O chat do
    // Compras.gov.br chega pela sessão do robô, com a conta do próprio cliente.
    motivo: 'O chat público é protegido por captcha: não é lido automaticamente. Chega pela sala do Robô Turbo 2.0 (conta do cliente, modo monitorar).',
    chave: chaveComprasnet,
    listar: null,
  },
  bll: { portal: 'bll', nome: 'BLL', validado: false, motivo: 'Chat só dentro da sala logada: use a sessão do Robô Turbo 2.0 (modo monitorar).', chave: () => null, listar: null },
  bnc: { portal: 'bnc', nome: 'BNC', validado: false, motivo: 'Chat só dentro da sala logada: use a sessão do Robô Turbo 2.0 (modo monitorar).', chave: () => null, listar: null },
  pcp: { portal: 'pcp', nome: 'Portal de Compras Públicas', validado: false, motivo: 'Leitura pública a mapear (a sala tem página pública de acompanhamento).', chave: () => null, listar: null },
  bbmnet: { portal: 'bbmnet', nome: 'BBMNET', validado: false, motivo: 'Chat só dentro da sala logada: use a sessão do Robô Turbo 2.0 (modo monitorar).', chave: () => null, listar: null },
};

/** Situação para a tela: como cada portal chega à caixa de entrada. */
export const situacaoConectores = () => Object.values(CONECTORES).map((c) => ({
  portal: c.portal, nome: c.nome, publico: !!c.listar, validado: c.validado, motivo: c.motivo || null,
}));

/**
 * GET JSON com ritmo próprio: um pedido por vez, intervalo mínimo e pausa geral em 429.
 * (Os portais bloqueiam rajadas; ninguém precisa de mensagem em menos de 1 minuto.)
 */
export function criarObtedor({ intervaloMs = 4000, pausa429Ms = 120_000, fetch: f = fetch, agora = Date.now } = {}) {
  let proxima = 0;
  let fila = Promise.resolve();
  return (url, { sinal } = {}) => {
    const vez = fila.then(async () => {
      const espera = proxima - agora();
      if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
      proxima = agora() + intervaloMs;
      const r = await f(url, { headers: { accept: 'application/json', 'user-agent': 'UsoLicitaHub-Chat/1.0' }, signal: sinal ? AbortSignal.any([sinal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
      if (r.status === 429) { proxima = agora() + pausa429Ms; throw Object.assign(new Error('O portal pediu para ir mais devagar (429).'), { status: 429 }); }
      if (r.status === 204 || r.status === 404) return [];
      if (!r.ok) throw Object.assign(new Error(`O portal respondeu ${r.status}.`), { status: r.status });
      return r.json();
    });
    fila = vez.catch(() => {});
    return vez;
  };
}
