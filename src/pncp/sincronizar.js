// Sincroniza licitações do PNCP com a tabela public.licitacoes do Supabase.
//
// Modos:
//   "abertas"      -> contratações com propostas abertas que encerram até hoje + N dias
//                     (carga inicial / completa). Consulta estado por estado, porque a
//                     consulta nacional costuma falhar (HTTP 500 após ~50 s).
//   "atualizacao"  -> contratações alteradas num intervalo de datas (incremental, leve).
//                     Tenta a consulta nacional e só divide por estado se ela falhar.
import { config } from '../config.js';
import { criarLimitador, criarLog, diaPncp, hojeBrasilia, somarDias, validarDia } from '../util.js';
import { MODALIDADES, UFS } from './dominio.js';
import { obterJson, urlAtualizacoes, urlPropostasAbertas } from './cliente.js';
import { normalizarPagina } from './normalizar.js';
import { abrirExecucao, criarSinal } from '../services/collectors/execucoes.js';

const TAMANHO_PAGINA = 50; // máximo aceito pela API
const MAX_FALHAS_SEGUIDAS = 3;

function prepararOpcoes(opcoes) {
  const o = {
    modo: opcoes.modo ?? 'abertas',
    dias: opcoes.dias ?? config.pncp.diasAFrente,
    desde: opcoes.desde ?? null,
    ate: opcoes.ate ?? null,
    modalidades: opcoes.modalidades?.length ? opcoes.modalidades.map(Number) : config.pncp.modalidades,
    ufs: opcoes.ufs?.length ? opcoes.ufs.map((u) => String(u).toUpperCase()) : null,
    maxPaginas: opcoes.maxPaginas ?? config.pncp.maxPaginas,
    concorrencia: Math.max(1, opcoes.concorrencia ?? config.pncp.concorrencia),
    limparDias: opcoes.limparDias ?? config.pncp.limparDias,
    simular: Boolean(opcoes.simular),
    guardarBruto: opcoes.guardarBruto ?? config.pncp.guardarBruto,
  };

  if (!['abertas', 'atualizacao'].includes(o.modo)) throw new Error(`Modo inválido: "${o.modo}". Use "abertas" ou "atualizacao".`);
  for (const m of o.modalidades) {
    if (!MODALIDADES[m]) throw new Error(`Modalidade desconhecida: ${m}. Válidas: ${Object.keys(MODALIDADES).join(', ')}.`);
  }
  for (const uf of o.ufs ?? []) {
    if (!UFS.includes(uf)) throw new Error(`UF desconhecida: ${uf}.`);
  }
  if (!Number.isInteger(o.dias) || o.dias < 0 || o.dias > 365) throw new Error('--dias deve ser um número entre 0 e 365.');
  return o;
}

/**
 * @param {object} opcoes  ver prepararOpcoes
 * @param {{ supabase?: import('@supabase/supabase-js').SupabaseClient|null,
 *   log?: ReturnType<typeof criarLog>, sinal?: AbortSignal }} [deps]
 *   supabase: cliente admin (null ao simular)
 */
export async function sincronizarPncp(opcoes = {}, { supabase = null, log = criarLog('pncp'), sinal } = {}) {
  const o = prepararOpcoes(opcoes);
  if (!o.simular && !supabase) throw new Error('Para gravar é preciso o cliente do Supabase (ou use --simular).');

  const hoje = hojeBrasilia();
  let janela;
  if (o.modo === 'abertas') {
    janela = { dataFinal: diaPncp(somarDias(hoje, o.dias)) };
  } else {
    const desde = validarDia(o.desde ?? somarDias(hoje, -1), '--desde');
    const ate = validarDia(o.ate ?? hoje, '--ate');
    if (desde > ate) throw new Error('--desde não pode ser depois de --ate.');
    janela = { dataInicial: diaPncp(desde), dataFinal: diaPncp(ate) };
  }

  const montarUrl = (tarefa, pagina) => {
    const p = { ...janela, modalidade: tarefa.modalidade, uf: tarefa.uf, pagina, tamanhoPagina: TAMANHO_PAGINA };
    return o.modo === 'abertas' ? urlPropostasAbertas(p) : urlAtualizacoes(p);
  };

  const resumo = {
    modo: o.modo, janela, simulado: o.simular,
    tarefas: 0, paginas: 0, recebidos: 0, gravados: 0, ignorados: 0, removidas: 0,
    falhas: [], amostra: [], interrompido: null,
  };
  const corte = o.limparDias > 0 ? Date.now() - o.limparDias * 86_400_000 : null;

  // Se o PNCP continuar recusando (HTTP 429) mesmo depois das pausas, a
  // sincronização para sem insistir e fica com o que já foi gravado.
  const interrupcao = new AbortController();
  const sinalGeral = sinal ? AbortSignal.any([sinal, interrupcao.signal]) : interrupcao.signal;
  const parar = (motivo) => {
    if (interrupcao.signal.aborted) return;
    resumo.interrompido = motivo;
    log.erro(motivo);
    interrupcao.abort(new Error(motivo));
  };

  let execucaoId = null;
  if (!o.simular) {
    // trava entre servidores: lança codigo 'em_andamento' se outra sincronização estiver viva
    execucaoId = await abrirExecucao(supabase, { fonte: 'pncp', modo: o.modo,
      parametros: { ...janela, modalidades: o.modalidades, ufs: o.ufs, maxPaginas: o.maxPaginas } });
  }

  const registrarFalha = (rotulo, pagina, erro) => {
    const mensagem = erro?.message ?? String(erro);
    resumo.falhas.push({ tarefa: rotulo, pagina, mensagem });
    log.erro(`${rotulo}, página ${pagina}: ${mensagem}`);
  };

  const darSinal = o.simular ? async () => {} : criarSinal(supabase, execucaoId);
  const limitar = criarLimitador(o.concorrencia);
  const emAndamento = new Set();
  const agendar = (tarefa) => {
    resumo.tarefas++;
    const p = limitar(() => executar(tarefa)).finally(() => emAndamento.delete(p));
    p.catch(() => {}); // a falha é tratada no Promise.all abaixo
    emAndamento.add(p);
  };

  async function executar(tarefa) {
    if (interrupcao.signal.aborted) return;
    const rotulo = `${MODALIDADES[tarefa.modalidade]} / ${tarefa.uf ?? 'Brasil'}`;
    const opcoesHttp = {
      sinal: sinalGeral,
      // consulta nacional: desiste rápido e divide por estado
      tentativas: tarefa.podeDividir ? 2 : config.pncp.tentativas,
      aoFalhar: ({ tentativa, erro, esperaMs }) =>
        log.aviso(`${rotulo}: ${erro.message} Tentando de novo em ${Math.round(esperaMs / 1000)} s (${tentativa}).`),
    };

    let pagina = 1;
    let totalPaginas = 1;
    let falhasSeguidas = 0;
    while (pagina <= Math.min(totalPaginas, o.maxPaginas)) {
      let resposta;
      try {
        resposta = await obterJson(montarUrl(tarefa, pagina), opcoesHttp);
      } catch (erro) {
        if (sinal?.aborted) throw erro;
        if (interrupcao.signal.aborted) return;
        if (erro?.status === 429) {
          registrarFalha(rotulo, pagina, erro);
          parar('O PNCP continuou recusando as consultas mesmo com pausas (HTTP 429). '
            + 'A sincronização parou e o que já foi lido ficou gravado. Tente de novo mais tarde.');
          return;
        }
        if (pagina === 1 && tarefa.podeDividir) {
          log.aviso(`${rotulo}: a consulta nacional falhou; dividindo por estado.`);
          for (const uf of UFS) agendar({ modalidade: tarefa.modalidade, uf, podeDividir: false });
          return;
        }
        registrarFalha(rotulo, pagina, erro);
        if (pagina === 1 || ++falhasSeguidas >= MAX_FALHAS_SEGUIDAS) return;
        pagina++;
        continue;
      }

      falhasSeguidas = 0;
      darSinal().catch(() => {});
      const registros = Array.isArray(resposta?.data) ? resposta.data : [];
      totalPaginas = Number(resposta?.totalPaginas ?? 0);
      resumo.paginas++;
      resumo.recebidos += registros.length;
      if (pagina === 1) {
        const limite = totalPaginas > o.maxPaginas ? ` (limitado a ${o.maxPaginas})` : '';
        log.info(`${rotulo}: ${resposta?.totalRegistros ?? 0} registro(s) em ${totalPaginas} página(s)${limite}.`);
      }
      if (registros.length === 0) return;

      // Ignora o que já encerrou há mais tempo que a janela de limpeza: seria
      // gravado e apagado em seguida (comum no modo "atualizacao").
      const todas = normalizarPagina(registros, { guardarBruto: o.guardarBruto });
      const linhas = corte === null ? todas : todas.filter((l) => {
        const referencia = l.data_encerramento_proposta ?? l.data_publicacao;
        return !referencia || Date.parse(referencia) >= corte;
      });
      resumo.ignorados += todas.length - linhas.length;

      if (o.simular) {
        if (resumo.amostra.length < 3) resumo.amostra.push(...linhas.slice(0, 3 - resumo.amostra.length));
        resumo.gravados += linhas.length;
      } else if (linhas.length) {
        const { error } = await supabase.from('licitacoes').upsert(linhas, { onConflict: 'numero_controle_pncp' });
        if (error) registrarFalha(rotulo, pagina, new Error(`Supabase: ${error.message}`));
        else resumo.gravados += linhas.length;
      }
      pagina++;
    }
  }

  try {
    for (const modalidade of o.modalidades) {
      if (o.ufs) for (const uf of o.ufs) agendar({ modalidade, uf, podeDividir: false });
      else if (o.modo === 'abertas') for (const uf of UFS) agendar({ modalidade, uf, podeDividir: false });
      else agendar({ modalidade, uf: null, podeDividir: true });
    }
    while (emAndamento.size) await Promise.all([...emAndamento]);

    if (!o.simular && o.limparDias > 0) {
      const { data, error } = await supabase.rpc('limpar_licitacoes_antigas', { p_dias: o.limparDias });
      if (error) log.aviso(`Limpeza do catálogo não executada: ${error.message}`);
      else resumo.removidas = data ?? 0;
    }
  } catch (erro) {
    if (execucaoId) {
      await supabase.from('sync_execucoes').update({
        status: 'erro', recebidos: resumo.recebidos, gravados: resumo.gravados, falhas: resumo.falhas.length + 1,
        detalhes: { erro: erro?.message ?? String(erro), falhas: resumo.falhas.slice(0, 50) },
        finalizado_em: new Date().toISOString(),
      }).eq('id', execucaoId);
    }
    throw erro;
  }

  resumo.status = resumo.falhas.length === 0 ? 'concluida' : resumo.gravados > 0 ? 'parcial' : 'erro';
  if (execucaoId) {
    const { error } = await supabase.from('sync_execucoes').update({
      status: resumo.status, recebidos: resumo.recebidos, gravados: resumo.gravados, falhas: resumo.falhas.length,
      detalhes: {
        tarefas: resumo.tarefas, paginas: resumo.paginas, ignorados: resumo.ignorados,
        removidas: resumo.removidas, interrompido: resumo.interrompido, falhas: resumo.falhas.slice(0, 50),
      },
      finalizado_em: new Date().toISOString(),
    }).eq('id', execucaoId);
    if (error) log.aviso(`Não foi possível atualizar o registro da sincronização: ${error.message}`);
  }
  return resumo;
}
