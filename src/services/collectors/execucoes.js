// Registro das execuções em public.sync_execucoes, com:
//   - trava entre servidores: o índice único sync_execucoes_uma_por_vez só deixa UMA
//     execução "executando" por fonte e tipo (coletor novo / sincronizador antigo);
//   - sinal de vida (ultimo_sinal) a cada página; sem sinal há ABANDONO_MIN minutos,
//     a execução é fechada como "erro: abandonada" e a trava é liberada;
//   - limpeza do histórico antigo.
// Usado pelo coletor novo (index.js) e pelo sincronizador antigo (src/pncp/sincronizar.js).

export const ABANDONO_MIN = 30;

/** Fecha execuções sem sinal de vida. Devolve quantas foram fechadas. */
export async function fecharAbandonadas(supabase, { minutos = ABANDONO_MIN, agora = Date.now() } = {}) {
  const limite = new Date(agora - minutos * 60_000).toISOString();
  const { data, error } = await supabase.from('sync_execucoes')
    .update({ status: 'erro', finalizado_em: new Date(agora).toISOString(), detalhes: { erro: 'abandonada (o servidor reiniciou ou caiu durante a coleta)' } })
    .eq('status', 'executando').lt('ultimo_sinal', limite).select('id');
  if (error) throw new Error(`Não consegui fechar execuções abandonadas: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Abre uma execução (pega a trava). Se outra do mesmo tipo estiver viva, lança
 * erro com codigo = 'em_andamento'.
 * @returns {Promise<number>} id
 */
export async function abrirExecucao(supabase, { fonte, modo, parametros = {} }) {
  const inserir = () => supabase.from('sync_execucoes').insert({ fonte, modo, parametros }).select('id').single();
  let { data, error } = await inserir();
  if (error?.code === '23505') {
    // pode ser trava de uma execução morta: fecha as abandonadas e tenta uma vez mais
    if (await fecharAbandonadas(supabase)) ({ data, error } = await inserir());
  }
  if (error?.code === '23505') {
    const e = new Error(`Já existe uma coleta de "${fonte}" em andamento (em outro processo ou servidor).`);
    e.codigo = 'em_andamento';
    throw e;
  }
  if (error) throw new Error(`Não consegui registrar a execução: ${error.message}`);
  return data.id;
}

/** Sinal de vida com no máximo 1 gravação por `intervaloMs` (não pesa no banco). */
export function criarSinal(supabase, id, { intervaloMs = 60_000 } = {}) {
  let ultimo = Date.now();
  return async (forcar = false) => {
    if (!id || (!forcar && Date.now() - ultimo < intervaloMs)) return;
    ultimo = Date.now();
    await supabase.from('sync_execucoes').update({ ultimo_sinal: new Date().toISOString() }).eq('id', id);
  };
}

/** Apaga o histórico de execuções com mais de `dias` dias. */
export async function limparHistorico(supabase, { dias = 60, agora = Date.now() } = {}) {
  const limite = new Date(agora - dias * 86_400_000).toISOString();
  const { data, error } = await supabase.from('sync_execucoes').delete()
    .lt('iniciado_em', limite).neq('status', 'executando').select('id');
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
