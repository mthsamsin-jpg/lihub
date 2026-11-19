// Orquestrador dos coletores: roda as fontes pedidas, grava página a página no
// Supabase (upsert em lote por fonte + external_id) e registra cada execução em
// public.sync_execucoes. Uma execução por vez no processo (agendamento e disparo
// manual não se atropelam).
import { config } from '../../config.js';
import { UFS } from '../../pncp/dominio.js';
import { esperar, hojeBrasilia, somarDias, validarDia } from '../../util.js';
import { prepararLote } from './esquema.js';
import { criarLogEstruturado } from './log.js';
import { PncpCollector } from './pncpCollector.js';

/** Fontes disponíveis. Para plugar uma nova, importe a classe e acrescente aqui. */
export const COLETORES = { [PncpCollector.fonte]: PncpCollector };

let execucaoAtual = null;
let ultimoResumo = null;

export const situacaoColeta = () => ({ emExecucao: execucaoAtual?.info ?? null, ultimo: ultimoResumo });

function prepararOpcoes(o = {}) {
  const hoje = hojeBrasilia();
  const fontes = (o.fontes?.length ? o.fontes : config.coletores.fontes).map((f) => String(f).toLowerCase());
  for (const f of fontes) if (!COLETORES[f]) throw new Error(`Fonte desconhecida: "${f}". Disponíveis: ${Object.keys(COLETORES).join(', ')}.`);
  const ufs = (o.ufs?.length ? o.ufs : config.coletores.ufs).map((u) => String(u).toUpperCase());
  for (const uf of ufs) if (!UFS.includes(uf)) throw new Error(`UF desconhecida: ${uf}.`);
  const desde = validarDia(o.desde ?? somarDias(hoje, -(o.diasAtras ?? config.coletores.diasAtras)), 'desde');
  const ate = validarDia(o.ate ?? hoje, 'ate');
  if (desde > ate) throw new Error('"desde" não pode ser depois de "ate".');
  const modo = o.modo ?? config.coletores.modo;
  if (!['publicacao', 'atualizacao', 'abertas'].includes(modo)) throw new Error(`Modo inválido: "${modo}".`);
  return {
    fontes, ufs: ufs.length ? ufs : null, desde, ate, modo,
    modalidades: o.modalidades?.length ? o.modalidades.map(Number) : null,
    maxPaginas: o.maxPaginas ?? config.coletores.maxPaginas,
    lote: Math.max(1, Math.min(o.lote ?? config.coletores.lote, 500)),
    simular: Boolean(o.simular),
    permitirNaoValidado: Boolean(o.permitirNaoValidado),
    guardarBruto: o.guardarBruto ?? config.coletores.guardarBruto,
  };
}

/** Upsert com 2 tentativas (o Supabase às vezes devolve erro transitório). */
async function gravar(supabase, linhas, sinal) {
  for (let n = 1; ; n++) {
    const { error } = await supabase.from('licitacoes').upsert(linhas, { onConflict: 'fonte,external_id', returning: 'minimal' });
    if (!error) return;
    if (n >= 2) throw new Error(`Supabase: ${error.message}`);
    await esperar(2_000, sinal);
  }
}

async function coletarFonte(Classe, o, { supabase, log, sinal, deps }) {
  const flog = log.filho({ fonte: Classe.fonte });
  const r = { fonte: Classe.fonte, paginas: 0, recebidos: 0, gravados: 0, invalidos: 0, falhas: [], interrompido: null, status: 'concluida' };
  if (!Classe.validado && !o.permitirNaoValidado) {
    flog.aviso('fonte.ignorada', { motivo: 'coletor ainda não validado' });
    return { ...r, status: 'ignorada' };
  }
  const inicio = Date.now();
  let execId = null;
  if (!o.simular) {
    const { data, error } = await supabase.from('sync_execucoes')
      .insert({ fonte: Classe.fonte, modo: `coletor:${o.modo}`, parametros: { desde: o.desde, ate: o.ate, ufs: o.ufs, modalidades: o.modalidades, maxPaginas: o.maxPaginas } })
      .select('id').single();
    if (error) flog.aviso('execucao.sem_registro', { erro: error.message });
    else execId = data.id;
  }
  flog.info('fonte.inicio', { modo: o.modo, desde: o.desde, ate: o.ate, ufs: o.ufs ?? 'todas', execucao: execId });

  const coletor = new Classe({ log: flog, ...(deps?.[Classe.fonte] || {}) });
  try {
    for await (const p of coletor.paginas(o, { sinal })) {
      if (p.erro) {
        r.falhas.push({ rotulo: p.rotulo, pagina: p.pagina, erro: p.erro.message });
        flog.erro('pagina.falhou', { rotulo: p.rotulo, pagina: p.pagina, erro: p.erro.message });
        if (p.erro.fatal) { r.interrompido = p.erro.message; break; }
        continue;
      }
      r.paginas++;
      r.recebidos += p.registros.length;
      const { linhas, invalidos } = prepararLote(p.registros, { guardarBruto: o.guardarBruto });
      r.invalidos += invalidos.length;
      if (invalidos.length) flog.aviso('registros.invalidos', { rotulo: p.rotulo, pagina: p.pagina, quantidade: invalidos.length, exemplo: invalidos[0] });
      for (let i = 0; i < linhas.length; i += o.lote) {
        const pedaco = linhas.slice(i, i + o.lote);
        if (o.simular) { r.gravados += pedaco.length; continue; }
        try {
          await gravar(supabase, pedaco, sinal);
          r.gravados += pedaco.length;
        } catch (e) {
          r.falhas.push({ rotulo: p.rotulo, pagina: p.pagina, erro: e.message });
          flog.erro('lote.falhou', { rotulo: p.rotulo, pagina: p.pagina, erro: e.message });
        }
      }
      if (r.paginas === 1 || r.paginas % 10 === 0) {
        flog.info('progresso', { rotulo: p.rotulo, pagina: p.pagina, totalPaginas: p.totalPaginas, recebidos: r.recebidos, gravados: r.gravados,
          memoriaMb: Math.round(process.memoryUsage().rss / 1048576) });
      }
      if (o.simular && !r.amostra) r.amostra = linhas.slice(0, 2);
    }
  } catch (e) {
    r.falhas.push({ rotulo: Classe.fonte, pagina: null, erro: e.message });
    r.interrompido = sinal?.aborted ? 'cancelada' : e.message;
    flog.erro('fonte.abortada', { erro: e.message });
  }
  r.status = r.interrompido || r.falhas.length ? (r.gravados ? 'parcial' : 'erro') : 'concluida';
  r.duracaoS = Math.round((Date.now() - inicio) / 1000);
  if (execId) {
    const { error } = await supabase.from('sync_execucoes').update({
      status: r.status, recebidos: r.recebidos, gravados: r.gravados, falhas: r.falhas.length,
      detalhes: { paginas: r.paginas, invalidos: r.invalidos, interrompido: r.interrompido, duracaoS: r.duracaoS, falhas: r.falhas.slice(0, 50) },
      finalizado_em: new Date().toISOString(),
    }).eq('id', execId);
    if (error) flog.aviso('execucao.sem_atualizar', { erro: error.message });
  }
  flog.info('fonte.fim', { status: r.status, paginas: r.paginas, recebidos: r.recebidos, gravados: r.gravados, invalidos: r.invalidos, falhas: r.falhas.length, duracaoS: r.duracaoS });
  return r;
}

/**
 * Executa a coleta. As fontes rodam uma depois da outra (memória e rede previsíveis).
 * @param {object} opcoes  { fontes, ufs, desde, ate, diasAtras, modo, modalidades, maxPaginas, lote, simular, permitirNaoValidado }
 * @param {{ supabase?: any, log?: any, sinal?: AbortSignal, deps?: object }} ctx
 *   deps: dependências por fonte, ex.: { pncp: { obterJson } } (testes)
 */
export async function executarColeta(opcoes = {}, { supabase = null, log = criarLogEstruturado('coleta'), sinal, deps } = {}) {
  const o = prepararOpcoes(opcoes);
  if (!o.simular && !supabase) throw new Error('Para gravar é preciso o cliente do Supabase (ou use simular).');
  if (execucaoAtual) {
    const e = new Error('Já existe uma coleta em andamento.');
    e.codigo = 'em_andamento';
    throw e;
  }
  const info = { iniciadaEm: new Date().toISOString(), fontes: o.fontes, modo: o.modo, desde: o.desde, ate: o.ate, ufs: o.ufs };
  const promessa = (async () => {
    log.info('coleta.inicio', { ...info, simular: o.simular, lote: o.lote });
    const fontes = [];
    for (const f of o.fontes) {
      if (sinal?.aborted) break;
      fontes.push(await coletarFonte(COLETORES[f], o, { supabase, log, sinal, deps }));
    }
    const resumo = {
      ...info, finalizadaEm: new Date().toISOString(), simulado: o.simular,
      recebidos: fontes.reduce((s, f) => s + f.recebidos, 0),
      gravados: fontes.reduce((s, f) => s + f.gravados, 0),
      falhas: fontes.reduce((s, f) => s + f.falhas.length, 0),
      fontes,
    };
    log.info('coleta.fim', { recebidos: resumo.recebidos, gravados: resumo.gravados, falhas: resumo.falhas,
      fontes: fontes.map((f) => `${f.fonte}:${f.status}`).join(',') });
    return resumo;
  })();
  execucaoAtual = { info, promessa };
  try {
    const resumo = await promessa;
    ultimoResumo = { ...resumo, fontes: resumo.fontes.map(({ amostra, ...f }) => ({ ...f, falhas: f.falhas.slice(0, 10) })) };
    return resumo;
  } finally {
    execucaoAtual = null;
  }
}
