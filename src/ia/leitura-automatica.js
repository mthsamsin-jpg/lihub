// Leitura AUTOMÁTICA de editais por IA.
//
// Para as organizações que ligaram a opção (organizacoes.ia_automatica), lê
// sozinho o edital das licitações que a equipe está acompanhando (CRM e
// favoritas), enquanto ainda estão abertas e ainda não foram analisadas.
// Usa a mesma análise (resumo, habilitação, prazos, critério, riscos) e a mesma
// cota mensal do plano: nunca passa do limite contratado.

/**
 * Uma rodada. Devolve { organizacoes, iniciadas, semCota }.
 * @param {{ porOrganizacao?: number }} opcoes
 * @param {{ supabase: any, analisar: (p: { organizacao_id: string, licitacao_id: number }) => Promise<any>, log?: any }} deps
 */
export async function lerEditaisAutomaticamente({ porOrganizacao = 2 } = {}, { supabase, analisar, log = console }) {
  const { data: orgs, error } = await supabase.from('organizacoes').select('id').eq('ia_automatica', true);
  if (error) throw new Error(`Leitura automática: ${error.message}`);
  const total = { organizacoes: orgs?.length ?? 0, iniciadas: 0, semCota: 0 };

  for (const { id: org } of orgs || []) {
    // Licitações acompanhadas: cards do CRM da organização + favoritas dos membros.
    const [{ data: cards }, { data: membros }] = await Promise.all([
      supabase.from('crm_cards').select('licitacao_id').eq('organizacao_id', org).eq('arquivado', false),
      supabase.from('membros').select('user_id').eq('organizacao_id', org),
    ]);
    const usuarios = (membros || []).map((m) => m.user_id);
    const { data: favs } = usuarios.length
      ? await supabase.from('favoritos').select('licitacao_id').in('user_id', usuarios)
      : { data: [] };
    const ids = [...new Set([...(cards || []), ...(favs || [])].map((x) => Number(x.licitacao_id)).filter(Boolean))];
    if (!ids.length) continue;

    // Só as do PNCP, ainda abertas, e sem análise desta organização.
    const [{ data: abertas }, { data: feitas }] = await Promise.all([
      supabase.from('licitacoes').select('id, data_encerramento_proposta').in('id', ids.slice(0, 500))
        .eq('fonte', 'pncp').gte('data_encerramento_proposta', new Date().toISOString())
        .order('data_encerramento_proposta', { ascending: true }),
      supabase.from('analises_edital').select('licitacao_id').eq('organizacao_id', org).in('licitacao_id', ids.slice(0, 500)),
    ]);
    const jaTem = new Set((feitas || []).map((a) => Number(a.licitacao_id)));
    const fila = (abertas || []).filter((l) => !jaTem.has(Number(l.id))).slice(0, porOrganizacao);

    for (const l of fila) {
      try {
        const r = await analisar({ organizacao_id: org, licitacao_id: Number(l.id) });
        if (r?.cota) { total.semCota += 1; break; }
        if (r?.id) total.iniciadas += 1;
      } catch (e) {
        log.aviso?.(`Leitura automática (${org}, licitação ${l.id}): ${e.message}`);
      }
    }
  }
  return total;
}
