/* =============================================================================
   Uso LicitaHub · Portais do Robô Turbo 2.0
   Um registro só com o selo e as regras de cada plataforma. A tela, o mini
   player e o formulário leem daqui.

   As regras de tempo seguem o padrão federal do modo de disputa ABERTO
   (Lei 14.133/2021 e IN SEGES/ME nº 73/2022): etapa de lances de 10 min,
   prorrogação automática de 2 min a cada lance nos 2 últimos minutos, intervalo
   mínimo de 20 s entre os próprios lances e de 3 s em relação ao melhor lance.
   Cada edital pode mudar isso, e cada portal cobra a participação de um jeito:
   o que não foi confirmado fica como null e aparece como "confira no edital".
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const PADRAO = Object.freeze({
    modo: 'Aberto',
    abertaMin: 10,
    prorrogacaoMin: 2,
    intervaloProprioSeg: 20,
    intervaloMelhorSeg: 3,
    criterio: 'unitario', // o lance é pelo valor unitário do item
    custo: null,          // custo de participação (não confirmado: ver o portal)
    disputa: true,        // a sala de lances fica neste portal
  });

  // [chave, nome, sigla curta do selo, matiz do selo (0-360), particularidades]
  const LISTA = [
    ['comprasnet', 'Compras.gov.br', 'GOV', 200, { custo: 'Gratuito para o fornecedor (cadastro no SICAF).' }],
    ['pncp', 'PNCP', 'PNCP', 160, { disputa: false, nota: 'O PNCP publica as compras. Os lances acontecem no portal de origem do pregão.' }],
    ['bll', 'BLL Compras', 'BLL', 28, {}],
    ['licitanet', 'Licitanet', 'LNET', 265, {}],
    ['pcp', 'Portal de Compras Públicas', 'PCP', 140, {}],
    ['bnc', 'BNC', 'BNC', 220, {}],
    ['licitar', 'Licitar Digital', 'LD', 300, {}],
    ['bbmnet', 'BBMNET', 'BBM', 340, {}],
    ['licitacoes-e', 'Licitações-e', 'LIC-E', 50, {}],
    ['comprasbr', 'ComprasBR', 'CBR', 185, {}],
    ['licitamais', 'Licita Mais Brasil', 'LMB', 95, {}],
    ['petronect', 'Petronect', 'PNT', 10, { nota: 'Regras próprias da Petrobras (não segue a IN 73/2022).' }],
    ['outros', 'Outro portal', '•••', 210, {}],
  ];

  // --- Suporte do modo real (roadmap) -------------------------------------------
  // A Sala Simulada funciona com TODOS os portais. O modo real (o robô do servidor
  // entrando no portal) só fica pronto depois que a sala é mapeada e conferida numa
  // disputa de verdade (worker/adaptadores/seletores.js, validado: true).
  // O servidor manda o "validado" de cada portal: quando ele chega como true, o
  // portal sobe para "pronto" sozinho, sem mexer nesta lista.
  const ETAPAS = Object.freeze({
    pronto:     { ordem: 0, rotulo: 'Modo real liberado', curto: 'Pronto', cor: 'ok',
      texto: 'Sala mapeada e conferida numa disputa real. Dá para monitorar e dar lances de verdade.' },
    login:      { ordem: 1, rotulo: 'Login mapeado · sala em mapeamento', curto: 'Em mapeamento', cor: 'andamento',
      texto: 'O robô já sabe entrar no portal. A sala de disputa será mapeada numa sessão real (primeiro só monitorando).' },
    mapeamento: { ordem: 2, rotulo: 'Em adaptação', curto: 'Em adaptação', cor: 'andamento',
      texto: 'Endereço de login conferido. Falta mapear o login e a sala de disputa numa sessão real.' },
    fila:       { ordem: 3, rotulo: 'Na fila do roadmap', curto: 'Na fila', cor: 'fila',
      texto: 'Ainda não começou a adaptação. Use a Sala Simulada para treinar a estratégia.' },
    publica:    { ordem: 4, rotulo: 'Só publica as compras', curto: 'Sem disputa', cor: 'neutro',
      texto: 'Não tem sala de lances: a disputa acontece no portal de origem do pregão.' },
    manual:     { ordem: 5, rotulo: 'Só Sala Simulada', curto: 'Simulação', cor: 'neutro',
      texto: 'Portal não listado: o robô treina a estratégia na Sala Simulada; no portal, os lances são seus.' },
  });
  // Etapa e prioridade (1 = próximo a ser liberado) de cada portal.
  const ROADMAP = {
    bll: ['login', 1], comprasnet: ['mapeamento', 2], pcp: ['mapeamento', 3], licitanet: ['mapeamento', 4],
    bnc: ['mapeamento', 5], bbmnet: ['mapeamento', 6], 'licitacoes-e': ['mapeamento', 7], comprasbr: ['mapeamento', 8],
    licitar: ['mapeamento', 9], licitamais: ['fila', 10], petronect: ['fila', 11], pncp: ['publica', null], outros: ['manual', null],
  };
  let doServidor = {}; // portal -> { validado, pendentes } (GET /api/robo/real/estado)

  const PORTAIS = Object.fromEntries(LISTA.map(([chave, nome, sigla, matiz, extra]) => [
    chave, Object.freeze({ chave, nome, sigla, matiz, ...PADRAO, ...extra }),
  ]));

  /** Situação do portal no modo real: { etapa, prioridade, ...ETAPAS[etapa] }. */
  function suporte(chave) {
    const [etapaBase, prioridade] = ROADMAP[chave] || ROADMAP.outros;
    const etapa = doServidor[chave]?.validado ? 'pronto' : etapaBase;
    return { chave, etapa, prioridade, ...ETAPAS[etapa], pendentes: doServidor[chave]?.pendentes?.length ?? null };
  }

  LH.portaisRobo = {
    ETAPAS,
    suporte,
    /** Recebe a situação dos portais do servidor (validado/pendentes). */
    atualizarServidor(portais) { if (portais && typeof portais === 'object') doServidor = portais; },
    /** Portais na ordem do roadmap (prontos primeiro). */
    porRoadmap: () => LISTA.map(([k]) => ({ ...PORTAIS[k], suporte: suporte(k) }))
      .sort((a, b) => (a.suporte.ordem - b.suporte.ordem) || ((a.suporte.prioridade ?? 99) - (b.suporte.prioridade ?? 99))),
    /** Etiqueta curta da situação (HTML). */
    etiqueta(chave) {
      const x = suporte(chave);
      return `<span class="etapa-portal etapa-portal--${x.cor}" title="${LH.esc(x.texto)}">${LH.esc(x.curto)}</span>`;
    },
    /** Opções do <select> agrupadas pela situação do modo real. */
    opcoesAgrupadas(atual) {
      const grupos = new Map();
      for (const p of LH.portaisRobo.porRoadmap()) {
        const g = p.suporte.etapa === 'login' || p.suporte.etapa === 'mapeamento' ? 'Modo real em adaptação' : p.suporte.rotulo;
        if (!grupos.has(g)) grupos.set(g, []);
        grupos.get(g).push(p);
      }
      return [...grupos].map(([g, ps]) => `<optgroup label="${LH.esc(g)}">${ps.map((p) =>
        `<option value="${LH.esc(p.chave)}"${p.chave === atual ? ' selected' : ''}>${LH.esc(p.nome)}${p.suporte.etapa === 'login' ? ' (login mapeado)' : ''}</option>`).join('')}</optgroup>`).join('');
    },
    /** Texto para o formulário: o que funciona hoje com este portal. */
    oQueFunciona(chave) {
      const x = suporte(chave);
      if (x.etapa === 'pronto') return 'Sala Simulada e modo real (monitorar e dar lances).';
      if (x.etapa === 'publica') return x.texto;
      return `Sala Simulada: sim. Modo real: ${x.rotulo.toLowerCase()}. ${x.texto}`;
    },
    lista: () => LISTA.map(([k]) => PORTAIS[k]),
    de: (chave) => PORTAIS[chave] || PORTAIS.outros,
    /** Opções do <select>: [[chave, nome], ...]. */
    opcoes: () => LISTA.map(([k, n]) => [k, n]),
    /** Selo do portal (HTML). A cor vem só do matiz: nada de logo de terceiros. */
    selo(chave, { grande = false } = {}) {
      const p = PORTAIS[chave] || PORTAIS.outros;
      return `<span class="selo-portal${grande ? ' selo-portal--grande' : ''}" style="--matiz:${p.matiz}" title="${LH.esc(p.nome)}"><b>${LH.esc(p.sigla)}</b>${LH.esc(p.nome)}</span>`;
    },
    /** Resumo das regras em texto curto, para o card e o formulário. */
    regras(chave) {
      const p = PORTAIS[chave] || PORTAIS.outros;
      if (!p.disputa) return p.nota;
      return [
        `Modo ${p.modo.toLowerCase()}: ${p.abertaMin} min + prorrogações de ${p.prorrogacaoMin} min`,
        `intervalo de ${p.intervaloProprioSeg} s entre os nossos lances`,
        `lance por valor ${p.criterio === 'unitario' ? 'unitário' : 'total'}`,
        p.custo || 'custo de participação: confira no portal',
      ].join(' · ').replace(/\.$/, '') + (p.nota ? `. ${p.nota}` : '.');
    },
  };
}());
