// Coleta da INTELIGÊNCIA DE MERCADO: resultados homologados do PNCP.
//
// Para cada compra já encerrada que está no catálogo (public.licitacoes), lê os
// itens e, nos que têm resultado, o vencedor (CNPJ, porte, valor homologado,
// desconto). Grava em public.mercado_resultados e anota em public.mercado_coleta
// quando tentar de novo (o resultado costuma sair dias ou semanas depois da sessão).
//
// Ritmo: usa o cliente do PNCP (fila única, intervalo mínimo e pausa em 429),
// então convive com a sincronização do catálogo sem ser bloqueado.
import { listarItens, listarResultadosDoItem } from '../pncp/cliente.js';
import { interpretarNumeroControle } from '../pncp/dominio.js';

const DIA = 86_400_000;
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const txt = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '') || null;

/** Quando tentar de novo uma compra sem resultado: 2, 4, 8... dias (até 15). */
export const proximaTentativa = (tentativas, agora = Date.now()) =>
  new Date(agora + Math.min(15, 2 ** Math.max(1, tentativas)) * DIA).toISOString();

/** Item do PNCP + resultado do PNCP + licitação do catálogo -> linha de mercado_resultados. */
export function linhaDeResultado(lic, item, r) {
  const ms = String(item.materialOuServico || '').toUpperCase();
  return {
    numero_controle_pncp: lic.numero_controle_pncp,
    licitacao_id: lic.id ?? null,
    orgao_cnpj: lic.orgao_cnpj ?? null,
    orgao_nome: txt(lic.orgao_razao_social, 300),
    uf: lic.uf ?? null,
    municipio: lic.municipio ?? null,
    modalidade_id: lic.modalidade_id ?? null,
    modalidade_nome: lic.modalidade_nome ?? null,
    portal: txt(lic.sistema_origem, 120),
    objeto: txt(lic.objeto, 2000),
    item_numero: num(item.numeroItem ?? r.numeroItem) ?? 0,
    item_descricao: txt(item.descricao, 2000),
    material_servico: ms === 'M' || ms === 'S' ? ms : null,
    unidade: txt(item.unidadeMedida, 60),
    quantidade: num(item.quantidade),
    valor_unit_estimado: num(item.valorUnitarioEstimado),
    sequencial_resultado: num(r.sequencialResultado) ?? 1,
    fornecedor_ni: soDigitos(r.niFornecedor),
    fornecedor_nome: txt(r.nomeRazaoSocialFornecedor, 300),
    fornecedor_porte: txt(r.porteFornecedorNome, 60),
    quantidade_homologada: num(r.quantidadeHomologada),
    valor_unit_homologado: num(r.valorUnitarioHomologado),
    valor_total_homologado: num(r.valorTotalHomologado),
    data_resultado: r.dataResultado ? String(r.dataResultado).slice(0, 10) : null,
  };
}

/** Resultado válido: não cancelado e com valor. */
const resultadoValido = (r) => !r.dataCancelamento && num(r.valorUnitarioHomologado) > 0
  && !/cancel/i.test(String(r.situacaoCompraItemResultadoNome || ''));

/** Coleta uma compra. Devolve { itens, linhas } (linhas = resultados prontos para gravar). */
export async function coletarCompra(lic, { itens = listarItens, resultados = listarResultadosDoItem, sinal } = {}) {
  const compra = lic.orgao_cnpj && lic.ano_compra && lic.sequencial_compra
    ? { cnpj: lic.orgao_cnpj, ano: lic.ano_compra, sequencial: lic.sequencial_compra }
    : interpretarNumeroControle(lic.numero_controle_pncp);
  if (!compra) throw new Error('Número de controle PNCP inválido.');
  const lista = await itens(compra, { sinal, tentativas: 2, maxPaginas: 3 });
  const linhas = [];
  const comResultado = lista.filter((i) => i?.temResultado);
  for (const item of comResultado) {
    let rs = [];
    try {
      rs = await resultados(compra, item.numeroItem, { sinal, tentativas: 2 });
    } catch (e) {
      if (e?.status !== 404) throw e;
    }
    for (const r of rs.filter(resultadoValido)) linhas.push(linhaDeResultado(lic, item, r));
  }
  return { itens: lista.length, comResultado: comResultado.length, linhas };
}

const COLUNAS_LIC = 'id, numero_controle_pncp, orgao_cnpj, ano_compra, sequencial_compra, orgao_razao_social, uf, municipio, '
  + 'modalidade_id, modalidade_nome, sistema_origem, objeto, data_encerramento_proposta';

/**
 * Uma rodada de coleta: escolhe até `lote` compras encerradas ainda sem resultado
 * coletado (ou cuja nova tentativa venceu) e grava o que o PNCP já publicou.
 * @param {{ lote?: number, diasMax?: number }} opcoes
 * @param {{ supabase: any, log?: any, sinal?: AbortSignal, coletar?: typeof coletarCompra, agora?: number }} deps
 */
export async function coletarResultados({ lote = 25, diasMax = 75 } = {}, { supabase, log = console, sinal, coletar = coletarCompra, agora = Date.now() } = {}) {
  const ateQuando = new Date(agora - DIA).toISOString(); // sessão encerrada há pelo menos 1 dia
  const desde = new Date(agora - diasMax * DIA).toISOString();

  // Candidatas: encerradas no período, mais recentes primeiro.
  const { data: candidatas, error } = await supabase.from('licitacoes').select(COLUNAS_LIC)
    .eq('fonte', 'pncp').lt('data_encerramento_proposta', ateQuando).gte('data_encerramento_proposta', desde)
    .order('data_encerramento_proposta', { ascending: false }).limit(lote * 8);
  if (error) throw new Error(`Não consegui ler o catálogo: ${error.message}`);
  if (!candidatas?.length) return { compras: 0, resultados: 0, semResultado: 0, erros: 0 };

  const numeros = candidatas.map((l) => l.numero_controle_pncp);
  const { data: controle, error: e2 } = await supabase.from('mercado_coleta')
    .select('numero_controle_pncp, situacao, tentativas, proxima_em').in('numero_controle_pncp', numeros);
  if (e2) throw new Error(`Não consegui ler o controle da coleta: ${e2.message}`);
  const porNumero = new Map((controle || []).map((c) => [c.numero_controle_pncp, c]));
  const agoraIso = new Date(agora).toISOString();
  const fila = candidatas.filter((l) => {
    const c = porNumero.get(l.numero_controle_pncp);
    return !c || (['pendente', 'sem_resultado', 'erro'].includes(c.situacao) && c.proxima_em <= agoraIso);
  }).slice(0, lote);

  const total = { compras: 0, resultados: 0, semResultado: 0, erros: 0 };
  for (const lic of fila) {
    if (sinal?.aborted) break;
    const anterior = porNumero.get(lic.numero_controle_pncp);
    const tentativas = (anterior?.tentativas ?? 0) + 1;
    const marca = { numero_controle_pncp: lic.numero_controle_pncp, licitacao_id: lic.id, tentativas, atualizado_em: agoraIso };
    try {
      const { itens, comResultado = itens, linhas } = await coletar(lic, { sinal });
      if (linhas.length) {
        const { error: e3 } = await supabase.from('mercado_resultados')
          .upsert(linhas, { onConflict: 'numero_controle_pncp,item_numero,sequencial_resultado' });
        if (e3) throw new Error(e3.message);
      }
      // Todos os itens homologados: pronto. Parte deles: volta depois para buscar o resto.
      const encerradaHa = (agora - new Date(lic.data_encerramento_proposta).getTime()) / DIA;
      const ultima = tentativas >= 8 || encerradaHa > diasMax - 5;
      const completa = linhas.length && (comResultado >= itens || ultima);
      const desistir = !linhas.length && ultima;
      await supabase.from('mercado_coleta').upsert({
        ...marca, itens, resultados: linhas.length, erro: null,
        situacao: completa ? 'ok' : desistir ? 'desistiu' : 'sem_resultado',
        proxima_em: completa ? agoraIso : proximaTentativa(tentativas, agora),
      });
      total.compras += 1;
      total.resultados += linhas.length;
      if (!linhas.length) total.semResultado += 1;
    } catch (e) {
      if (sinal?.aborted) break;
      total.erros += 1;
      await supabase.from('mercado_coleta').upsert({
        ...marca, situacao: tentativas >= 6 ? 'desistiu' : 'erro', erro: String(e.message || e).slice(0, 500),
        proxima_em: proximaTentativa(tentativas, agora),
      });
      log.aviso?.(`Mercado: ${lic.numero_controle_pncp} falhou (${e.message}).`);
    }
  }
  return total;
}
