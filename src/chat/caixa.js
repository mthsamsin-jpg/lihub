// Caixa de entrada unificada do chat: toda mensagem de sala de disputa (de
// qualquer portal, vinda da sessão do robô ou da leitura pública) passa por aqui.
//   1. normaliza e calcula a identidade (não grava repetida);
//   2. detecta gatilhos com os dados da empresa (CNPJ, nomes, palavras);
//   3. grava em public.chat_mensagens (o painel recebe pelo tempo real);
//   4. dispara alerta das relevantes no webhook da organização (Discord, Slack ou JSON).
import { detectarGatilhos, hashMensagem, papelDoAutor } from './detectar.js';

const ROTULOS = {
  mencao_cnpj: 'citou o seu CNPJ', mencao_nome: 'citou a sua empresa', convocacao: 'convocação', anexo: 'pedido de anexo/documento',
  prazo: 'prazo', suspensao: 'suspensão/reabertura', resultado: 'resultado', palavra: 'palavra de alerta',
};
export const PORTAIS = { comprasnet: 'Compras.gov.br', bll: 'BLL', bnc: 'BNC', pcp: 'Portal de Compras Públicas', bbmnet: 'BBMNET', licitanet: 'Licitanet' };

/** Texto curto do alerta. */
export function textoDoAlerta(m, { site = 'https://usolicitahub.com.br' } = {}) {
  const motivos = m.gatilhos.map((g) => ROTULOS[g]).filter(Boolean).join(', ');
  return `🔔 ${PORTAIS[m.portal] || m.portal} · pregão ${m.compra_ref}${motivos ? ` (${motivos})` : ''}\n${m.autor || 'Pregoeiro'}: ${m.texto}\n${site}/app.html#/chat`;
}

/** Envia ao webhook no formato que o destino entende. */
export async function enviarWebhook(url, mensagem, { fetch: f = fetch } = {}) {
  const texto = textoDoAlerta(mensagem);
  const corpo = /discord(app)?\.com\/api\/webhooks/.test(url) ? { content: texto.slice(0, 1900) }
    : /hooks\.slack\.com/.test(url) ? { text: texto }
      : { evento: 'chat.mensagem', texto, mensagem };
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`webhook respondeu ${r.status}`);
}

/**
 * Perfil de detecção da organização: CNPJs e nomes das empresas cadastradas +
 * o que foi configurado no monitoramento (CNPJ, nome, nomes extras, palavras).
 */
export async function perfilDaOrganizacao(supabase, organizacaoId) {
  const [{ data: empresas }, { data: mon }] = await Promise.all([
    supabase.from('empresas').select('cnpj, razao_social, nome_fantasia').eq('organizacao_id', organizacaoId).eq('ativo', true),
    supabase.from('monitoramentos').select('cnpj, nome, palavras, nomes_alerta, webhook_url').eq('organizacao_id', organizacaoId).maybeSingle(),
  ]);
  return {
    cnpjs: [...(empresas || []).map((e) => e.cnpj), mon?.cnpj].filter(Boolean),
    nomes: [...(empresas || []).flatMap((e) => [e.razao_social, e.nome_fantasia]), mon?.nome, ...(mon?.nomes_alerta || [])].filter(Boolean),
    palavras: mon?.palavras || [],
    webhook: mon?.webhook_url || null,
  };
}

/**
 * Registra mensagens de uma sala.
 * @param {{ organizacao_id: string, portal: string, compra_ref: string, licitacao_id?: number|null, fonte?: 'publica'|'robo'|'manual',
 *   mensagens: { autor?: string, texto: string, enviadaEm?: string, idExterno?: string }[] }} lote
 * @param {{ supabase: any, perfil?: object, enviar?: typeof enviarWebhook, log?: any }} deps
 * @returns {Promise<{ novas: number, relevantes: number }>}
 */
export async function registrarMensagens(lote, { supabase, perfil = null, enviar = enviarWebhook, log = console }) {
  const msgs = (lote.mensagens || []).filter((m) => String(m.texto || '').trim());
  if (!msgs.length) return { novas: 0, relevantes: 0 };
  const p = perfil || await perfilDaOrganizacao(supabase, lote.organizacao_id);
  const linhas = msgs.map((m) => {
    const papel = papelDoAutor(m.autor);
    const { gatilhos, relevante } = detectarGatilhos(m.texto, p, papel);
    return {
      organizacao_id: lote.organizacao_id, portal: lote.portal, compra_ref: String(lote.compra_ref), licitacao_id: lote.licitacao_id ?? null,
      fonte: lote.fonte || 'publica', autor: m.autor ? String(m.autor).slice(0, 200) : null, papel,
      texto: String(m.texto).trim().slice(0, 4000), enviada_em: m.enviadaEm || new Date().toISOString(),
      hash: hashMensagem(m), gatilhos, relevante,
    };
  });
  // ignoreDuplicates: a mesma mensagem lida de novo não vira linha nova nem alerta repetido.
  const { data, error } = await supabase.from('chat_mensagens')
    .upsert(linhas, { onConflict: 'organizacao_id,portal,compra_ref,hash', ignoreDuplicates: true })
    .select('id, portal, compra_ref, autor, texto, gatilhos, relevante');
  if (error) throw new Error(`Não consegui gravar o chat: ${error.message}`);
  const novas = data || [];
  const relevantes = novas.filter((m) => m.relevante);
  if (p.webhook) {
    for (const m of relevantes) {
      try {
        await enviar(p.webhook, m);
        await supabase.from('chat_mensagens').update({ alertada_em: new Date().toISOString() }).eq('id', m.id);
      } catch (e) { log.aviso?.(`Alerta do chat não enviado: ${e.message}`); }
    }
  }
  return { novas: novas.length, relevantes: relevantes.length };
}
