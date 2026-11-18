// Rotas do MODO REAL do Licita Lances (todas exigem login, pelo middleware /api/* do app.js):
//   GET    /api/robo/real/estado                 o servidor tem cofre e navegador? quais portais estão mapeados?
//   GET    /api/portais/credenciais              credenciais salvas (só metadados: nunca o segredo)
//   PUT    /api/portais/credenciais/:portal      salva/troca a credencial (cifrada no servidor)
//   DELETE /api/portais/credenciais/:portal      apaga a credencial
//   POST   /api/robo/sessoes                     conecta um item a um pregão real (monitorar ou dar lances)
//   POST   /api/robo/sessoes/:id/:acao           pausar | retomar | parar | limites
import { bodyLimit } from 'hono/body-limit';
import * as z from 'zod/v4';
import { ErroCofre, mascararLogin, validarCertificado } from '../cofre.js';
import { ErroModoReal } from '../../worker/gerenciador.js';

const PORTAIS = ['comprasnet', 'licitacoes-e', 'bbmnet', 'bnc', 'pcp', 'bll', 'licitanet', 'licitar', 'licitamais', 'comprasbr', 'petronect', 'outros'];
const MAX_PFX = 64 * 1024;

const PedidoCredencial = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('senha'),
    login: z.string().trim().min(1, 'Informe o login.').max(200),
    senha: z.string().min(1, 'Informe a senha.').max(200),
  }),
  z.object({
    tipo: z.literal('certificado'),
    certificado_base64: z.string().min(10).max(Math.ceil(MAX_PFX * 1.4)),
    certificado_nome: z.string().trim().max(200).optional(),
    senha_certificado: z.string().min(1, 'Informe a senha do certificado.').max(200),
    login: z.string().trim().max(200).optional(),
  }),
], { error: 'tipo deve ser "senha" ou "certificado".' });

const PedidoSessao = z.object({
  robo_item_id: z.uuid({ error: 'robo_item_id inválido.' }),
  pregao: z.string().trim().min(1, 'Informe o número do pregão.').max(120),
  lote: z.string().trim().max(40).optional().transform((v) => v || null),
  modo: z.enum(['monitorar', 'lances']).default('monitorar'),
  confirmo_lances_reais: z.boolean().optional(),
}).refine((p) => p.modo !== 'lances' || p.confirmo_lances_reais === true, {
  error: 'Para o robô dar lances de verdade, confirme que entende que os lances serão enviados ao portal.',
});

/**
 * @param {import('hono').Hono} app
 * @param {object} deps
 * @param {object} deps.admin     cliente Supabase com a chave secreta
 * @param {ReturnType<import('../cofre.js').criarCofre>|null} deps.cofre
 * @param {ReturnType<import('../../worker/gerenciador.js').criarGerenciador>|null} deps.gerenciador
 */
export function ligarModoReal(app, { admin, cofre, gerenciador, navegadorDisponivel = async () => false }) {
  const responderErro = (c, e) => {
    if (e instanceof ErroModoReal) return c.json({ erro: e.message, codigo: e.codigo }, e.status);
    if (e instanceof ErroCofre) return c.json({ erro: e.message, codigo: e.codigo }, e.codigo === 'sem_chave' ? 503 : 400);
    if (e instanceof z.ZodError) return c.json({ erro: e.issues[0]?.message || 'Pedido inválido.' }, 400);
    throw e;
  };
  const exigirCofre = () => { if (!cofre) throw new ErroModoReal('O cofre de credenciais não está configurado no servidor (CREDENCIAIS_CHAVE).', 503, 'sem_cofre'); };
  const exigirGerenciador = () => { if (!gerenciador) throw new ErroModoReal('O modo real está desligado neste servidor.', 503, 'desligado'); };
  const portalValido = (portal) => { if (!PORTAIS.includes(portal)) throw new ErroModoReal('Portal desconhecido.', 400, 'portal'); };
  const lerJson = async (c, esquema) => {
    let corpo;
    try { corpo = await c.req.json(); } catch { throw new ErroModoReal('Corpo do pedido não é JSON.', 400); }
    return esquema.parse(corpo);
  };

  app.get('/api/robo/real/estado', async (c) => c.json({
    cofre: !!cofre,
    navegador: await navegadorDisponivel(),
    ...(gerenciador ? gerenciador.situacao() : { ativas: 0, maxSessoes: 0, portais: {} }),
  }));

  // --- Cofre de credenciais ---
  app.get('/api/portais/credenciais', async (c) => {
    const { data, error } = await admin.from('portal_credentials')
      .select('portal, tipo, login_mascarado, certificado_nome, atualizado_em, ultimo_uso_em')
      .eq('user_id', c.get('usuario').id).order('portal');
    if (error) return c.json({ erro: `Falha ao ler o cofre: ${error.message}` }, 500);
    return c.json({ credenciais: data });
  });

  app.put('/api/portais/credenciais/:portal', bodyLimit({ maxSize: 160 * 1024, onError: (c) => c.json({ erro: 'Certificado grande demais (máx. 64 KB).' }, 413) }), async (c) => {
    try {
      exigirCofre();
      const portal = c.req.param('portal');
      portalValido(portal);
      const p = await lerJson(c, PedidoCredencial);
      const dono = c.get('usuario').id;
      let segredo; let extra;
      if (p.tipo === 'senha') {
        segredo = { tipo: 'senha', login: p.login, senha: p.senha };
        extra = { login_mascarado: mascararLogin(p.login), certificado_nome: null };
      } else {
        const pfx = Buffer.from(p.certificado_base64, 'base64');
        if (!pfx.length || pfx.length > MAX_PFX) throw new ErroModoReal('Certificado vazio ou grande demais (máx. 64 KB).', 400, 'certificado');
        validarCertificado(pfx, p.senha_certificado);
        segredo = { tipo: 'certificado', pfx: pfx.toString('base64'), senhaCertificado: p.senha_certificado, login: p.login || null };
        extra = { login_mascarado: mascararLogin(p.login), certificado_nome: p.certificado_nome || 'certificado.pfx' };
      }
      const { error } = await admin.from('portal_credentials').upsert({
        user_id: dono, portal, tipo: p.tipo, ...extra, segredo_cifrado: cofre.cifrar(segredo, { dono, portal }),
      }, { onConflict: 'user_id,portal' });
      if (error) return c.json({ erro: `Falha ao salvar no cofre: ${error.message}` }, 500);
      return c.json({ ok: true, portal, tipo: p.tipo, ...extra });
    } catch (e) { return responderErro(c, e); }
  });

  app.delete('/api/portais/credenciais/:portal', async (c) => {
    try {
      portalValido(c.req.param('portal'));
      const { error } = await admin.from('portal_credentials').delete().eq('user_id', c.get('usuario').id).eq('portal', c.req.param('portal'));
      if (error) return c.json({ erro: `Falha ao apagar: ${error.message}` }, 500);
      return c.json({ ok: true });
    } catch (e) { return responderErro(c, e); }
  });

  // --- Sessões ---
  async function itemDoMembro(c, id) {
    const { data, error } = await admin.from('robo_itens').select('*').eq('id', id).maybeSingle();
    if (error) throw new ErroModoReal(`Falha ao ler o item: ${error.message}`, 500);
    if (!data || !(await c.get('db').ehMembro(data.organizacao_id))) throw new ErroModoReal('Item não encontrado.', 404, 'sem_item');
    return data;
  }
  async function sessaoDoMembro(c, id) {
    const { data, error } = await admin.from('robo_sessoes').select('*').eq('id', id).maybeSingle();
    if (error) throw new ErroModoReal(`Falha ao ler a sessão: ${error.message}`, 500);
    if (!data || !(await c.get('db').ehMembro(data.organizacao_id))) throw new ErroModoReal('Sessão não encontrada.', 404, 'sem_sessao');
    return data;
  }

  app.post('/api/robo/sessoes', async (c) => {
    try {
      exigirGerenciador();
      const p = await lerJson(c, PedidoSessao);
      const item = await itemDoMembro(c, p.robo_item_id);
      const sessao = await gerenciador.iniciar({ usuario: c.get('usuario'), item, pregao: p.pregao, lote: p.lote, modo: p.modo });
      return c.json({ sessao }, 201);
    } catch (e) { return responderErro(c, e); }
  });

  app.post('/api/robo/sessoes/:id/:acao', async (c) => {
    try {
      exigirGerenciador();
      const sessao = await sessaoDoMembro(c, c.req.param('id'));
      const acao = c.req.param('acao');
      if (acao === 'pausar') await gerenciador.pausar(sessao.id);
      else if (acao === 'retomar') await gerenciador.retomar(sessao.id);
      else if (acao === 'parar') await gerenciador.parar(sessao.id);
      else if (acao === 'limites') await gerenciador.atualizarLimites(sessao.id, await itemDoMembro(c, sessao.robo_item_id));
      else return c.json({ erro: 'Ação desconhecida.' }, 400);
      return c.json({ ok: true });
    } catch (e) { return responderErro(c, e); }
  });
}
