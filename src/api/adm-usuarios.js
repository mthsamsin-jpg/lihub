// Painel ADM: usuários da plataforma (listar, acompanhar, bloquear e desbloquear).
// Rotas protegidas pela sessão ADM (cookie HttpOnly) e, nas alterações, pelo cabeçalho X-LH-ADM.
//
//   GET  /api/adm/usuarios?busca=&estado=todos|ativos|bloqueados|pendentes&pagina=1
//   GET  /api/adm/usuarios/resumo
//   POST /api/adm/usuarios/:id/bloquear     { motivo? }
//   POST /api/adm/usuarios/:id/desbloquear
//   GET  /api/adm/usuarios/:id/historico
//
// Bloquear = "ban" no Supabase Auth (o login e a renovação passam a ser recusados) +
// encerra as sessões abertas + registra em adm_auditoria. Desbloquear desfaz o ban.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ESTADOS = new Set(['todos', 'ativos', 'bloqueados', 'pendentes']);
export const POR_PAGINA = 25;
const BAN_INDEFINIDO = '876000h'; // ~100 anos: até o ADM desbloquear

const semFuncao = (e) => e?.code === 'PGRST202' || /adm_usuarios|adm_encerrar_sessoes|adm_auditoria/.test(String(e?.message || '')) && /not find|does not exist|schema cache/i.test(String(e?.message || ''));
const avisoMigracao = 'Rode supabase/atualizar-adm-usuarios.sql no banco para ativar o painel de usuários.';

const usuarioParaTela = (r) => ({
  id: r.id, email: r.email, nome: r.nome || '', telefone: r.telefone || '',
  organizacao: r.organizacao || '', plano: r.plano || 'gratuito', isento: !!r.isento, planoAte: r.plano_ate,
  criadoEm: r.criado_em, confirmadoEm: r.confirmado_em, ultimoLogin: r.ultimo_login, ultimaAtividade: r.ultima_atividade,
  bloqueado: !!r.bloqueado, bloqueadoAte: r.bloqueado_ate,
});

export function ligarAdmUsuarios(app, { supabase, exigir, ipDe, log = console }) {
  const falhou = (c, e, texto) => {
    if (semFuncao(e)) return c.json({ erro: avisoMigracao, codigo: 'migracao' }, 503);
    log.erro?.(`ADM usuários: ${texto}: ${e?.message || e}`);
    return c.json({ erro: `${texto}. Tente de novo.` }, 500);
  };

  app.get('/api/adm/usuarios/resumo', exigir(async (c) => {
    const { data, error } = await supabase.rpc('adm_usuarios_resumo');
    if (error) return falhou(c, error, 'Não consegui ler os números');
    return c.json(data);
  }));

  app.get('/api/adm/usuarios', exigir(async (c) => {
    const busca = String(c.req.query('busca') || '').trim().slice(0, 120);
    const estado = ESTADOS.has(c.req.query('estado')) ? c.req.query('estado') : 'todos';
    const pagina = Math.max(1, Math.min(10_000, Number.parseInt(c.req.query('pagina'), 10) || 1));
    const { data, error } = await supabase.rpc('adm_usuarios', {
      p_busca: busca || null, p_estado: estado, p_limite: POR_PAGINA, p_offset: (pagina - 1) * POR_PAGINA,
    });
    if (error) return falhou(c, error, 'Não consegui listar os usuários');
    const linhas = data || [];
    return c.json({ usuarios: linhas.map(usuarioParaTela), total: Number(linhas[0]?.total ?? 0), pagina, porPagina: POR_PAGINA });
  }));

  app.get('/api/adm/usuarios/:id/historico', exigir(async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Usuário inválido.' }, 400);
    const { data, error } = await supabase.from('adm_auditoria').select('acao, motivo, criado_em').eq('alvo_user_id', id).order('criado_em', { ascending: false }).limit(20);
    if (error) return falhou(c, error, 'Não consegui ler o histórico');
    return c.json({ historico: data || [] });
  }));

  async function mudarEstado(c, bloquear) {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ erro: 'Usuário inválido.' }, 400);
    const corpo = await c.req.json().catch(() => ({}));
    const motivo = String(corpo.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;

    const { data: atual, error: e0 } = await supabase.auth.admin.getUserById(id);
    if (e0 || !atual?.user) return c.json({ erro: 'Usuário não encontrado.' }, 404);
    const email = atual.user.email || null;

    const { error } = await supabase.auth.admin.updateUserById(id, { ban_duration: bloquear ? BAN_INDEFINIDO : 'none' });
    if (error) return falhou(c, error, bloquear ? 'Não consegui bloquear' : 'Não consegui desbloquear');

    let sessoes = 0;
    if (bloquear) {
      const r = await supabase.rpc('adm_encerrar_sessoes', { p_user: id });
      if (r.error) log.aviso?.(`ADM: bloqueio de ${email} sem encerrar sessões: ${r.error.message}`);
      else sessoes = Number(r.data) || 0;
    }
    const { error: eA } = await supabase.from('adm_auditoria').insert({ acao: bloquear ? 'bloquear' : 'desbloquear', alvo_user_id: id, alvo_email: email, motivo, ip: ipDe(c) });
    if (eA) log.aviso?.(`ADM: auditoria não gravada: ${eA.message}`);
    log.info?.(`ADM: ${bloquear ? 'bloqueou' : 'desbloqueou'} ${email} (IP ${ipDe(c)}).`);
    return c.json({ ok: true, id, bloqueado: bloquear, sessoesEncerradas: sessoes });
  }

  app.post('/api/adm/usuarios/:id/bloquear', exigir((c) => mudarEstado(c, true)));
  app.post('/api/adm/usuarios/:id/desbloquear', exigir((c) => mudarEstado(c, false)));
}
