// Monitor do chat público: lê as salas dos pregões cadastrados em
// public.monitoramentos (pregoes) pelos conectores de leitura pública e entrega
// tudo à caixa de entrada unificada. Sem senha do usuário.
import { registrarMensagens, perfilDaOrganizacao } from './caixa.js';
import { CONECTORES, criarObtedor } from './conectores.js';

/**
 * Uma rodada. Devolve { salas, novas, relevantes, erros, ignoradas }.
 * @param {{ permitirNaoValidados?: boolean, maxSalas?: number }} opcoes
 * @param {{ supabase: any, obter?: Function, registrar?: typeof registrarMensagens, log?: any, sinal?: AbortSignal }} deps
 */
export async function monitorarChats({ permitirNaoValidados = false, maxSalas = 30 } = {},
  { supabase, obter = criarObtedor(), registrar = registrarMensagens, log = console, sinal } = {}) {
  const total = { salas: 0, novas: 0, relevantes: 0, erros: 0, ignoradas: 0 };
  const { data: monitorados, error } = await supabase.from('monitoramentos')
    .select('organizacao_id, pregoes, portais_publicos').eq('portais_publicos', true);
  if (error) throw new Error(`Monitor do chat: ${error.message}`);

  for (const mon of monitorados || []) {
    const pregoes = Array.isArray(mon.pregoes) ? mon.pregoes : [];
    if (!pregoes.length) continue;
    let perfil = null;
    for (const p of pregoes) {
      if (total.salas >= maxSalas || sinal?.aborted) return total;
      const conector = CONECTORES[p.portal || 'comprasnet'];
      const chave = conector?.chave?.(p);
      if (!conector?.listar || !chave || (!conector.validado && !permitirNaoValidados)) { total.ignoradas += 1; continue; }
      total.salas += 1;
      try {
        const mensagens = await conector.listar(chave, { obter, sinal });
        if (!mensagens.length) continue;
        perfil ||= await perfilDaOrganizacao(supabase, mon.organizacao_id);
        const r = await registrar({
          organizacao_id: mon.organizacao_id, portal: conector.portal, compra_ref: chave, licitacao_id: p.licitacao_id ?? null, fonte: 'publica', mensagens,
        }, { supabase, perfil, log });
        total.novas += r.novas;
        total.relevantes += r.relevantes;
      } catch (e) {
        total.erros += 1;
        log.aviso?.(`Chat ${conector.portal} ${chave}: ${e.message}`);
        if (e.status === 429) return total; // o portal pediu pausa: para a rodada inteira
      }
    }
  }
  return total;
}
