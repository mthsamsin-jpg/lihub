// Aviso por e-mail de NOVOS editais dos radares.
//
// Uma rodada (normalmente 1 vez por dia):
//   1. lê os radares ativos com e-mail ligado;
//   2. para cada um, "reserva" o período desde o último aviso (update condicional em
//      ultimo_aviso_em: se dois servidores rodarem juntos, só um envia);
//   3. procura as licitações que entraram no catálogo nesse período e ainda estão abertas
//      (mesmas regras de palavra e local do mapa do Radar: função radar_novidades);
//   4. junta os radares de cada pessoa num e-mail só e envia pelo Resend.
// Se o envio falhar, o período volta (o próximo aviso inclui essas licitações).
import { enviarEmail } from '../../worker/notificacoes.js';

const DIA = 86_400_000;
// Nomes usados na tela do Radar -> códigos do PNCP (igual a LH.MODALIDADES no site).
const MODALIDADES = {
  'Pregão Eletrônico': 6, 'Dispensa de Licitação': 8, 'Concorrência Eletrônica': 4, 'Pregão Presencial': 7, Inexigibilidade: 9,
  Concurso: 3, 'Concorrência Presencial': 5, Credenciamento: 12, 'Leilão Presencial': 13, 'Leilão Eletrônico': 1,
  'Dispensa Eletrônica': 8, Dispensa: 8,
};

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moeda = (v) => (Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Valor sigiloso');
const dataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Filtros do radar no formato da função radar_novidades. */
export function filtrosDoRadar(r) {
  return {
    p_termo: (r.palavras || []).map((p) => String(p).trim()).filter(Boolean).join(', ') || null,
    p_ufs: r.ufs?.length ? r.ufs : null,
    p_municipios: r.municipios?.length ? r.municipios : null,
    p_modalidades: (r.modalidades || []).map((m) => MODALIDADES[m]).filter(Boolean),
  };
}

/** E-mail com os radares de uma pessoa. secoes: [{ radar, total, itens }] */
export function montarEmailRadar(nome, secoes, { site = 'https://usolicitahub.com.br' } = {}) {
  const total = secoes.reduce((s, x) => s + x.total, 0);
  const assunto = `${total} licitaç${total === 1 ? 'ão nova' : 'ões novas'} no seu Radar · Uso LicitaHub`;
  const linkRadar = `${site}/app.html#/radar`;
  const texto = [`Olá, ${nome}!`, '', `O seu Radar encontrou ${total} licitação(ões) nova(s):`, '',
    ...secoes.flatMap((s) => [
      `== ${s.radar.nome} (${s.total}) ==`,
      ...s.itens.map((l) => `- ${l.objeto}\n  ${l.orgao || ''} · ${l.municipio || ''}/${l.uf || ''} · ${moeda(l.valor)} · propostas até ${dataHora(l.encerra_em)}${l.link_pncp ? `\n  ${l.link_pncp}` : ''}`),
      s.total > s.itens.length ? `  ... e mais ${s.total - s.itens.length}. Veja todas no Radar.` : '', '',
    ]),
    `Abrir o Radar: ${linkRadar}`, '', 'Você recebe este e-mail porque ligou o aviso por e-mail num radar do Uso LicitaHub. Para parar, desligue o radar na tela do Radar.',
  ].join('\n');
  const blocos = secoes.map((s) => `
    <h2 style="margin:22px 0 8px;font-size:16px;color:#111827">${esc(s.radar.nome)} <span style="color:#0284c7">(${s.total})</span></h2>
    ${s.itens.map((l) => `<div style="padding:10px 12px;margin:0 0 8px;border:1px solid #e5e7eb;border-radius:8px">
      <p style="margin:0 0 4px;font-size:14px;line-height:1.4;color:#111827"><strong>${esc(String(l.objeto || '').slice(0, 220))}</strong></p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#4b5563">${esc(l.orgao || '')} · ${esc(l.municipio || '')}/${esc(l.uf || '')} · ${esc(l.modalidade || '')}<br>
      ${esc(moeda(l.valor))} · propostas até ${esc(dataHora(l.encerra_em))}${l.link_pncp ? ` · <a href="${esc(l.link_pncp)}" style="color:#0284c7">ver no PNCP</a>` : ''}</p></div>`).join('')}
    ${s.total > s.itens.length ? `<p style="margin:0;font-size:12px;color:#6b7280">... e mais ${s.total - s.itens.length}.</p>` : ''}`).join('');
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px 12px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb"><tr><td style="padding:24px 26px">
<p style="margin:0 0 4px;font-size:13px;color:#0284c7;font-weight:bold">Uso LicitaHub · Radar de Licitações</p>
<h1 style="margin:0 0 6px;font-size:19px;line-height:1.3;color:#111827">${total} licitaç${total === 1 ? 'ão nova' : 'ões novas'} para você</h1>
<p style="margin:0;font-size:14px;color:#4b5563">Olá, ${esc(nome)}! Estas entraram desde o último aviso e ainda estão recebendo propostas.</p>
${blocos}
<p style="margin:22px 0 0"><a href="${linkRadar}" style="display:inline-block;padding:11px 20px;background:#0284c7;color:#fff;border-radius:8px;font-weight:bold;text-decoration:none">Abrir o Radar</a></p>
<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#6b7280">Você recebe este e-mail porque ligou o aviso por e-mail num radar do Uso LicitaHub. Para parar, desligue o radar na tela do Radar.</p>
</td></tr></table></body></html>`;
  return { assunto, texto, html };
}

/**
 * Uma rodada de avisos.
 * @param {{ supabase: any, enviar?: (msg: { para, assunto, texto, html }) => Promise<void>, site?: string,
 *   log?: any, agora?: number, maxDias?: number, porRadar?: number, simular?: boolean }} deps
 *   enviar: null = não há e-mail configurado (a rodada não reserva nada)
 */
export async function avisarRadares({ supabase, enviar, site, log = console, agora = Date.now(), maxDias = 3, porRadar = 10, simular = false }) {
  const resumo = { radares: 0, comNovidade: 0, emails: 0, licitacoes: 0, falhas: 0, previa: [] };
  if (!enviar && !simular) return { ...resumo, parado: 'sem e-mail configurado (RESEND_API_KEY)' };
  const { data: radares, error } = await supabase.from('radares')
    .select('id, organizacao_id, nome, palavras, ufs, municipios, modalidades, canais, criado_em, ultimo_aviso_em').eq('ativo', true);
  if (error) throw new Error(`Não consegui ler os radares: ${error.message}`);
  const comEmail = (radares || []).filter((r) => r.canais?.email !== false);
  resumo.radares = comEmail.length;
  if (!comEmail.length) return resumo;

  const { data: dest, error: e2 } = await supabase.rpc('radar_destinatarios', { p_radares: comEmail.map((r) => r.id) });
  if (e2) throw new Error(`Não consegui ler os destinatários: ${e2.message}`);
  const porRadarDest = new Map();
  for (const d of dest || []) porRadarDest.set(d.radar_id, [...(porRadarDest.get(d.radar_id) || []), d]);

  const agoraIso = new Date(agora).toISOString();
  const piso = agora - maxDias * DIA; // nunca manda mais que os últimos N dias (radar parado há muito tempo)
  const porEmail = new Map(); // email -> { nome, secoes, reservas }
  for (const r of comEmail) {
    const pessoas = porRadarDest.get(r.id) || [];
    if (!pessoas.length) continue;
    const desde = new Date(Math.max(Date.parse(r.ultimo_aviso_em || r.criado_em), piso)).toISOString();
    if (!simular) {
      // reserva: só segue se ninguém avisou este radar enquanto isso
      let q = supabase.from('radares').update({ ultimo_aviso_em: agoraIso }).eq('id', r.id);
      q = r.ultimo_aviso_em ? q.eq('ultimo_aviso_em', r.ultimo_aviso_em) : q.is('ultimo_aviso_em', null);
      const { data: reservado } = await q.select('id');
      if (!reservado?.length) continue;
    }
    const { data: nov, error: e3 } = await supabase.rpc('radar_novidades', { ...filtrosDoRadar(r), p_desde: desde, p_limite: porRadar });
    if (e3) {
      resumo.falhas++;
      log.aviso?.(`Radar "${r.nome}": ${e3.message}`);
      if (!simular) await supabase.from('radares').update({ ultimo_aviso_em: r.ultimo_aviso_em }).eq('id', r.id);
      continue;
    }
    if (!nov?.total) continue;
    resumo.comNovidade++;
    resumo.licitacoes += nov.total;
    for (const p of pessoas) {
      const e = porEmail.get(p.email) || { nome: p.nome, secoes: [], reservas: [] };
      e.secoes.push({ radar: r, total: nov.total, itens: nov.itens || [] });
      e.reservas.push({ id: r.id, anterior: r.ultimo_aviso_em });
      porEmail.set(p.email, e);
    }
  }

  for (const [para, e] of porEmail) {
    const msg = { para, ...montarEmailRadar(e.nome, e.secoes, { site }) };
    if (simular) { resumo.previa.push({ para, assunto: msg.assunto, radares: e.secoes.map((s) => `${s.radar.nome}: ${s.total}`) }); continue; }
    try {
      await enviar(msg);
      resumo.emails++;
    } catch (err) {
      resumo.falhas++;
      log.erro?.(`Aviso do Radar para ${para.replace(/(.{2}).*@/, '$1***@')}: ${err.message}`);
      // devolve o período: o próximo aviso inclui estas licitações
      for (const rv of e.reservas) await supabase.from('radares').update({ ultimo_aviso_em: rv.anterior }).eq('id', rv.id);
    }
  }
  return resumo;
}

/** Envio pelo Resend com a configuração do ambiente (null se não houver chave). */
export function enviadorDoAmbiente(canais) {
  if (!canais?.email) return null;
  return (msg) => enviarEmail(msg, canais.email);
}
