// Detalhes de uma licitação lidos na hora do PNCP: documentos (edital e anexos)
// e itens (produtos/serviços com quantidades). Usado pelos botões "Baixar
// editais" e "Ver itens" da busca. Nada é gravado no banco.
import { listarArquivos, listarItens } from './cliente.js';
import { interpretarNumeroControle } from './dominio.js';

/** Erro com mensagem pronta para o usuário e status HTTP. */
export class ErroDetalhes extends Error {
  constructor(mensagem, { status = 502, codigo = 'pncp_indisponivel', causa } = {}) {
    super(mensagem, { cause: causa });
    this.status = status;
    this.codigo = codigo;
  }
}

/** { cnpj, ano, sequencial } da compra no PNCP, a partir da linha de public.licitacoes. */
export function compraDaLicitacao(l) {
  if (!l) return null;
  if (l.orgao_cnpj && l.ano_compra && l.sequencial_compra) {
    return { cnpj: l.orgao_cnpj, ano: l.ano_compra, sequencial: l.sequencial_compra };
  }
  return interpretarNumeroControle(l.numero_controle_pncp);
}

const numero = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const texto = (v) => (v == null ? '' : String(v).trim());
const doPncp = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'pncp.gov.br' || u.hostname.endsWith('.pncp.gov.br'));
  } catch {
    return false;
  }
};

/** Documentos ativos, edital primeiro. Só devolve links do próprio PNCP. */
export function normalizarArquivos(lista, baseCompra) {
  const ehEdital = (a) => /edital/i.test(`${a.tipo} ${a.titulo}`) && !/aviso|errata|retifica/i.test(`${a.tipo} ${a.titulo}`);
  return lista
    .filter((a) => a && a.statusAtivo !== false)
    .map((a) => ({
      titulo: texto(a.titulo) || texto(a.tipoDocumentoNome) || 'Documento',
      tipo: texto(a.tipoDocumentoNome) || texto(a.tipoDocumentoDescricao),
      data: a.dataPublicacaoPncp || a.dataInclusao || null,
      url: texto(a.url || a.uri) || (a.sequencialDocumento != null ? `${baseCompra}/arquivos/${a.sequencialDocumento}` : ''),
    }))
    .filter((a) => doPncp(a.url))
    .sort((a, b) => Number(ehEdital(b)) - Number(ehEdital(a)));
}

// Itens na ordem oficial do edital (Item 1, 2, 3... até o total). O PNCP pagina a
// lista e pode repetir um item entre páginas ou entregá-lo fora de ordem: a ordem
// é refeita pelo número oficial (sem número vai para o fim, na ordem em que veio),
// o repetido sai, e cada item ganha a posição (1..total) e o total.
export function normalizarItens(lista) {
  const vistos = new Set();
  const itens = lista
    .filter(Boolean)
    .map((i, k) => ({
      _ordem: k,
      numero: numero(i.numeroItem),
      descricao: texto(i.descricao) || 'Item sem descrição',
      tipo: texto(i.materialOuServicoNome) || (i.materialOuServico === 'S' ? 'Serviço' : i.materialOuServico === 'M' ? 'Material' : ''),
      quantidade: numero(i.quantidade),
      unidade: texto(i.unidadeMedida),
      valorUnitario: numero(i.valorUnitarioEstimado),
      valorTotal: numero(i.valorTotal),
      beneficio: texto(i.tipoBeneficioNome),
      situacao: texto(i.situacaoCompraItemNome),
    }))
    .filter((i) => {
      if (i.numero == null) return true;
      if (vistos.has(i.numero)) return false;
      vistos.add(i.numero);
      return true;
    })
    .sort((a, b) => (a.numero ?? Infinity) - (b.numero ?? Infinity) || a._ordem - b._ordem);
  return itens.map(({ _ordem, ...i }, k) => ({ ...i, posicao: k + 1, total: itens.length }));
}

/**
 * @param {{ baseIntegracao: string, arquivos?: Function, itens?: Function }} deps
 *   arquivos/itens podem ser trocados nos testes.
 */
const LIMITE_TOTAL_MS = 40_000;

export function criarDetalhes({ baseIntegracao, arquivos = listarArquivos, itens = listarItens }) {
  const base = (c) => `${baseIntegracao.replace(/\/$/, '')}/v1/orgaos/${c.cnpj}/compras/${c.ano}/${c.sequencial}`;

  // Cache curto: abrir de novo a mesma licitação não volta ao portal do governo.
  const cache = new Map();
  const CACHE_MS = 10 * 60_000;

  async function consultar(licitacao, ler, oQue) {
    const compra = compraDaLicitacao(licitacao);
    if (!compra) {
      throw new ErroDetalhes('Esta licitação não tem identificação do PNCP.', { status: 404, codigo: 'sem_identificacao' });
    }
    const chave = `${oQue}|${compra.cnpj}|${compra.ano}|${compra.sequencial}`;
    const guardado = cache.get(chave);
    if (guardado && Date.now() - guardado.em < CACHE_MS) return { compra, lista: guardado.lista };
    // Quem pediu está esperando: fura a fila da sincronização, 20 s por tentativa e
    // no máximo 40 s no total (antes: até 90 s x 2 tentativas, atrás da fila).
    const limite = AbortSignal.timeout(LIMITE_TOTAL_MS);
    try {
      const lista = await ler(compra, { tentativas: 2, timeoutMs: 20_000, maxRecusas: 1, prioritario: true, sinal: limite });
      cache.set(chave, { em: Date.now(), lista });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return { compra, lista };
    } catch (e) {
      if (limite.aborted || /tempo esgotado|TimeoutError/i.test(`${e?.name} ${e?.message}`)) {
        throw new ErroDetalhes(`O portal do governo (PNCP) está demorando demais para entregar ${oQue}. Tente de novo em alguns minutos ou abra a licitação no site oficial.`, { status: 504, codigo: 'pncp_lento', causa: e });
      }
      const foraDoAr = [502, 503, 504].includes(e?.status);
      throw new ErroDetalhes(
        foraDoAr
          ? `O PNCP está fora do ar e não entregou ${oQue}. Tente mais tarde ou abra a licitação no site oficial.`
          : `Não consegui ler ${oQue} no PNCP. Tente mais tarde ou abra a licitação no site oficial.`,
        { causa: e },
      );
    }
  }

  return {
    async arquivos(licitacao) {
      const { compra, lista } = await consultar(licitacao, arquivos, 'os documentos');
      return normalizarArquivos(lista, base(compra));
    },
    async itens(licitacao) {
      const { lista } = await consultar(licitacao, itens, 'os itens');
      return normalizarItens(lista);
    },
  };
}
