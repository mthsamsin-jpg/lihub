/* =============================================================================
   Uso LicitaHub · Portais do Licita Lances
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

  const PORTAIS = Object.fromEntries(LISTA.map(([chave, nome, sigla, matiz, extra]) => [
    chave, Object.freeze({ chave, nome, sigla, matiz, ...PADRAO, ...extra }),
  ]));

  LH.portaisRobo = {
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
