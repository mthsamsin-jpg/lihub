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

export function normalizarItens(lista) {
  return lista
    .filter(Boolean)
    .map((i) => ({
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
    .sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
}

/**
 * @param {{ baseIntegracao: string, arquivos?: Function, itens?: Function }} deps
 *   arquivos/itens podem ser trocados nos testes.
 */
export function criarDetalhes({ baseIntegracao, arquivos = listarArquivos, itens = listarItens }) {
  const base = (c) => `${baseIntegracao.replace(/\/$/, '')}/v1/orgaos/${c.cnpj}/compras/${c.ano}/${c.sequencial}`;

  async function consultar(licitacao, ler, oQue) {
    const compra = compraDaLicitacao(licitacao);
    if (!compra) {
      throw new ErroDetalhes('Esta licitação não tem identificação do PNCP.', { status: 404, codigo: 'sem_identificacao' });
    }
    try {
      return { compra, lista: await ler(compra, { tentativas: 2 }) };
    } catch (e) {
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
