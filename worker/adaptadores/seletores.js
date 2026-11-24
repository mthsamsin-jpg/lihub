// Mapa de seletores HTML de cada portal.
//
// IMPORTANTE: os portais não publicam o HTML das salas de disputa e ele muda sem
// aviso. Nenhum seletor abaixo foi conferido numa sessão real ainda, por isso
// todos os portais estão com validado: false. Enquanto um portal não for
// validado, o worker só o usa com ROBO_SELETORES_NAO_VALIDADOS=permitir (para
// mapear, em ambiente de teste) e NUNCA envia lance nele.
//
// Como mapear um portal (uma vez, com uma conta de verdade):
//   1. npx playwright codegen <url do portal>  (abre o navegador gravando os cliques)
//   2. entre, abra uma sala de disputa e copie os seletores de cada campo abaixo;
//   3. preencha os campos abaixo, rode o teste contra uma sala real em modo
//      "só monitorar" e só então mude validado para true.
// Atalho: npm run mapear (worker/mapear-portal.js) abre o gravador no login do portal.
//
// Campos (null = ainda não mapeado):
//   urlBase                  origem do portal (também usada para o certificado A1)
//   login.url                página de login com usuário e senha
//   login.urlCertificado     página de login com certificado digital (se houver)
//   login.usuario/senha/entrar   campos e botão do login por senha
//   login.botaoCertificado   botão "entrar com certificado"
//   login.logado             algo que só aparece depois de entrar
//   login.erro               mensagem de erro de login
//   sala.url(pregao, lote)   URL direta da sala (ou null para usar a busca)
//   sala.busca / sala.buscar / sala.resultado   caminho pela busca do portal
//   sala.pronta              algo que aparece quando a sala carregou
//   sala.linhaLance          cada linha da lista de lances
//   sala.lanceValor / lanceAutor / lancePorte / lanceHora   campos dentro da linha
//   sala.lanceNosso          seletor que casa SÓ com as linhas dos nossos lances
//   sala.fase / sala.tempo   texto da fase e do cronômetro
//   sala.fases               [[regex do texto da fase, fase do LicitaHub], ...]
//   sala.linhaMensagem / mensagemAutor / mensagemTexto / mensagemHora   chat do pregoeiro
//   lance.campo / lance.enviar / lance.confirmar   envio do lance
//   lance.sucesso / lance.erro                      retorno do portal após enviar

// etapa: mapeamento -> login -> leitura -> lances (ver worker/fases.js).
// validado: true continua valendo como "lances" (mapas antigos).
const PENDENTE = Object.freeze({
  validado: false,
  etapa: 'mapeamento',
  urlBase: null,
  login: { url: null, urlCertificado: null, usuario: null, senha: null, entrar: null, botaoCertificado: null, logado: null, erro: null },
  sala: {
    url: null, busca: null, buscar: null, resultado: null, pronta: null,
    linhaLance: null, lanceValor: null, lanceAutor: null, lancePorte: null, lanceHora: null, lanceNosso: null,
    fase: null, tempo: null, fases: [],
    linhaMensagem: null, mensagemAutor: null, mensagemTexto: null, mensagemHora: null,
  },
  lance: { campo: null, enviar: null, confirmar: null, sucesso: null, erro: null },
});

const pendente = (urlBase, extra = {}) => ({ ...PENDENTE, urlBase, ...extra });

// Textos de fase comuns nos portais (modo aberto) -> fases do LicitaHub.
const FASES_COMUNS = [
  [/prorroga/i, 'prorrogacao'],
  [/desempate|me\/?epp|lc\s*123|empate ficto/i, 'desempate'],
  [/negocia/i, 'negociacao'],
  [/habilita|aceita/i, 'habilitacao'],
  [/encerrad|finalizad|fechad/i, 'encerrada'],
  [/aberta|em disputa|lances/i, 'aberta'],
];

export const SELETORES = {
  // BLL Compras: primeiro adaptador. Login com campos genéricos (usuário/senha);
  // a sala de disputa ainda precisa ser mapeada numa sessão real.
  bll: {
    ...PENDENTE,
    validado: false,
    // Login conferido na página pública (e-mail + teclado virtual). A sala ainda
    // precisa ser mapeada num pregão real, só monitorando.
    etapa: 'login',
    urlBase: 'https://bllcompras.com',
    login: {
      ...PENDENTE.login,
      url: 'https://bllcompras.com/Home/Login', // conferido: 200 em 18/11/2026
      // Conferido na página pública em 18/11/2026: #Email, teclado virtual ("1 ou 5")
      // e o botão "Entrar" (sem atributo type, por isso o seletor é pelo texto).
      usuario: '#Email',
      senha: '#Contador', // campo visível do teclado virtual; quem digita é o BllAdapter
      tecladoVirtual: 'input[type="button"][name*=" ou "]',
      entrar: 'button:has-text("Entrar")',
      logado: null, // a mapear: elemento que só existe logado (ex.: menu do fornecedor)
      erro: '.validation-summary-errors, .alert-danger, .text-danger',
    },
    sala: { ...PENDENTE.sala, fases: FASES_COMUNS },
  },
  // Endereços de login conferidos em 18/11/2026 (HTTP 200 ou bloqueio anti-robô 403,
  // que abre normalmente no navegador). Os campos da sala ainda precisam ser mapeados.
  comprasnet: pendente('https://www.comprasnet.gov.br', { login: { ...PENDENTE.login, url: 'https://www.comprasnet.gov.br/seguro/loginPortal.asp' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  licitanet: pendente('https://licitanet.com.br', { login: { ...PENDENTE.login, url: 'https://licitanet.com.br' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  pcp: pendente('https://www.portaldecompraspublicas.com.br', { login: { ...PENDENTE.login, url: 'https://operacao.portaldecompraspublicas.com.br' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  // BNC usa a mesma tela de login (/Home/Login) da BLL.
  bnc: pendente('https://bnccompras.com', { login: { ...PENDENTE.login, url: 'https://bnccompras.com/Home/Login' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  licitar: pendente('https://licitardigital.com.br', { login: { ...PENDENTE.login, url: 'https://licitardigital.com.br' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  bbmnet: pendente('https://sala.bbmnet.com.br', { login: { ...PENDENTE.login, url: 'https://sala.bbmnet.com.br' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  'licitacoes-e': pendente('https://www.licitacoes-e.com.br', { login: { ...PENDENTE.login, url: 'https://www.licitacoes-e.com.br/aop/index.jsp' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  comprasbr: pendente('https://comprasbr.com.br', { login: { ...PENDENTE.login, url: 'https://comprasbr.com.br' }, sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  licitamais: pendente(null, { sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
  petronect: pendente('https://www.petronect.com.br', { sala: { ...PENDENTE.sala, fases: FASES_COMUNS } }),
};

/** Lista dos campos ainda não mapeados (para avisar o operador e travar o envio). */
export function camposPendentes(sel, grupos = ['login', 'sala', 'lance']) {
  const faltam = [];
  if (!sel?.urlBase) faltam.push('urlBase');
  const exigidos = {
    login: ['url', 'usuario', 'senha', 'entrar', 'logado'],
    sala: ['pronta', 'linhaLance', 'lanceValor', 'lanceAutor', 'lanceNosso', 'fase'],
    lance: ['campo', 'enviar'],
  };
  for (const g of grupos) for (const k of exigidos[g] || []) if (!sel?.[g]?.[k]) faltam.push(`${g}.${k}`);
  if (grupos.includes('sala') && !sel?.sala?.url && !(sel?.sala?.busca && sel?.sala?.buscar && sel?.sala?.resultado)) faltam.push('sala.url (ou busca/buscar/resultado)');
  return faltam;
}
