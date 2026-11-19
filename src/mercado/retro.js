// Coleta RETROATIVA direcionada (Fase 3): 12 meses de resultados homologados, só
// do que interessa aos clientes.
//
// Coletar todo o PNCP não cabe (milhões de compras por ano, 1 consulta por segundo e
// 500 MB no plano gratuito do Supabase). Então:
//   1. os termos vêm das palavras dos radares ativos dos clientes (+ MERCADO_RETRO_TERMOS);
//   2. para cada termo, a busca do PNCP lista compras ENCERRADAS; as publicadas nos
//      últimos `meses` entram na fila (public.mercado_coleta, origem 'retro');
//   3. a coleta normal (coletar.js) lê os vencedores dessas compras, nos mesmos lotes.
// Cada termo guarda até onde já leu (mercado_retro_termos) e continua na noite seguinte.
// Antes de crescer, confere o tamanho do banco (trava MERCADO_LIMITE_MB).
import { buscarNoPncp } from '../pncp/busca.js';

const DIA = 86_400_000;

/** Termos da coleta retroativa: palavras dos radares ativos + extras do ambiente. */
export async function termosRetro(supabase, { extras = [], maximo = 60 } = {}) {
  const { data, error } = await supabase.from('radares').select('palavras').eq('ativo', true).limit(2000);
  if (error) throw new Error(`Não consegui ler os radares: ${error.message}`);
  const vistos = new Map();
  for (const t of [...extras, ...(data || []).flatMap((r) => r.palavras || [])]) {
    const termo = String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (termo.length >= 3 && termo.length <= 80) vistos.set(termo, (vistos.get(termo) || 0) + 1);
  }
  // os mais usados pelos clientes primeiro
  return [...vistos.entries()].sort((a, b) => b[1] - a[1]).slice(0, maximo).map(([t]) => t);
}

/** Tamanho do banco em MB (null se a função não existir). */
export async function tamanhoDoBanco(supabase) {
  const { data, error } = await supabase.rpc('banco_tamanho_mb');
  return error ? null : Number(data);
}

/** Resultado da busca do PNCP -> linha da fila de coleta. */
export function linhaDaFila(r, agoraIso) {
  return {
    numero_controle_pncp: r.numeroControle,
    origem: 'retro', situacao: 'pendente', tentativas: 0, proxima_em: agoraIso, atualizado_em: agoraIso,
    orgao_cnpj: r.cnpj, ano_compra: r.ano, sequencial_compra: r.sequencial,
    orgao_nome: r.orgao?.slice(0, 300) ?? null, uf: r.uf, municipio: r.municipio,
    modalidade_nome: r.modalidade, portal: (r.portalNome || r.portal)?.slice(0, 120) ?? null, objeto: r.objeto?.slice(0, 300) ?? null,
    encerrada_em: r.fimPropostas ? new Date(`${r.fimPropostas}${r.fimPropostas.length === 16 ? ':00' : ''}-03:00`).toISOString() : null,
  };
}

/**
 * Descobre compras encerradas para os termos e enfileira as novas.
 * @param {{ termos: string[], meses?: number, paginasPorRodada?: number, tamanhoPagina?: number, limiteMb?: number }} opcoes
 * @param {{ supabase: any, log?: any, sinal?: AbortSignal, buscar?: typeof buscarNoPncp, agora?: number }} deps
 */
export async function descobrirRetro(
  { termos, meses = 12, paginasPorRodada = 20, tamanhoPagina = 50, limiteMb = 400 },
  { supabase, log = console, sinal, buscar = buscarNoPncp, agora = Date.now() },
) {
  const resumo = { termos: 0, paginas: 0, encontradas: 0, enfileiradas: 0, parado: null };
  const mb = await tamanhoDoBanco(supabase);
  if (mb != null && mb >= limiteMb) {
    resumo.parado = `banco com ${mb} MB (limite ${limiteMb} MB)`;
    return resumo;
  }
  if (!termos.length) return resumo;

  const { data: cursores } = await supabase.from('mercado_retro_termos').select('*').in('termo', termos);
  const porTermo = new Map((cursores || []).map((c) => [c.termo, c]));
  const agoraIso = new Date(agora).toISOString();
  const corte = agora - meses * 30 * DIA;
  let paginasRestantes = paginasPorRodada;

  for (const termo of termos) {
    if (sinal?.aborted || paginasRestantes <= 0) break;
    const cur = porTermo.get(termo) || { termo, pagina: 0, compras: 0, concluido_em: null };
    // termo já lido por inteiro: só recomeça depois de 30 dias
    if (cur.concluido_em && agora - Date.parse(cur.concluido_em) < 30 * DIA) continue;
    if (cur.concluido_em) { cur.pagina = 0; cur.concluido_em = null; }
    resumo.termos++;

    let fim = false;
    while (!fim && paginasRestantes > 0 && !sinal?.aborted) {
      const pagina = cur.pagina + 1;
      let res;
      try {
        res = await buscar({ q: termo, pagina, tamanho: tamanhoPagina, status: 'encerradas' }, {});
      } catch (e) {
        log.aviso?.(`Retro: busca "${termo}" página ${pagina} falhou (${e.message}).`);
        break; // tenta o termo de novo na próxima rodada
      }
      paginasRestantes--;
      resumo.paginas++;
      const lista = res.resultados || [];
      const naJanela = lista.filter((r) => r.numeroControle && r.cnpj && r.ano && r.sequencial
        && r.publicadoEm && Date.parse(`${r.publicadoEm}-03:00`) >= corte);
      resumo.encontradas += naJanela.length;
      if (naJanela.length) {
        // ignoreDuplicates: o que já está na fila (do catálogo ou de outro termo) não é mexido
        const { data, error } = await supabase.from('mercado_coleta')
          .upsert(naJanela.map((r) => linhaDaFila(r, agoraIso)), { onConflict: 'numero_controle_pncp', ignoreDuplicates: true })
          .select('numero_controle_pncp');
        if (error) throw new Error(`Não consegui enfileirar: ${error.message}`);
        resumo.enfileiradas += data?.length ?? 0;
        cur.compras += data?.length ?? 0;
      }
      cur.pagina = pagina;
      // A ordem da busca não é estritamente por data: considera o fim quando a página
      // vem vazia/incompleta ou quando nenhuma compra dela está mais na janela.
      if (lista.length < tamanhoPagina || !naJanela.length) { fim = true; cur.concluido_em = agoraIso; }
    }
    await supabase.from('mercado_retro_termos').upsert({ termo, pagina: cur.pagina, compras: cur.compras, concluido_em: cur.concluido_em, atualizado_em: agoraIso });
  }
  return resumo;
}

/** "0-6" -> a hora atual de Brasília está entre 0h e 6h59? Vazio = sempre. */
export function dentroDaJanela(faixa, agora = new Date()) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(faixa || '').trim());
  if (!m) return true;
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }).format(agora));
  const [de, ate] = [Number(m[1]), Number(m[2])];
  return de <= ate ? hora >= de && hora <= ate : hora >= de || hora <= ate;
}
