// API HTTP do Uso LicitaHub (Hono). Rotas:
//   GET  /saude                         verificação simples (sem login)
//   POST /api/editais/analisar          inicia a leitura de um edital pela IA
//   GET  /api/editais/analises/:id      consulta o andamento/resultado
//   POST /api/assinaturas/checkout      página de pagamento da Stripe para assinar um plano
//   POST /api/assinaturas/portal        portal da Stripe (cartão, faturas, trocar plano, cancelar)
//   POST /stripe/webhook                avisos da Stripe (sem login; protegido pela assinatura digital)
//   DELETE /api/conta                   exclui a conta de quem está logado (LGPD)
//   GET  /api/licitacoes/:id/arquivos   documentos publicados no PNCP (edital e anexos)
//   GET  /api/licitacoes/:id/itens      itens da licitação no PNCP (produtos, quantidades)
//
// Todas as rotas /api exigem o token de login do Supabase:
//   Authorization: Bearer <access_token da sessão>
//
// A análise roda em segundo plano (pode levar minutos). O POST responde 202 com
// o id; o front-end acompanha pelo GET ou pelo tempo real do Supabase
// (tabela analises_edital).
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import * as z from 'zod/v4';
import { sha256, verificarPdf } from '../ia/documento.js';
import { ErroAnalise } from '../ia/erros.js';
import { ErroPagamento } from '../pagamentos/stripe.js';
import { ErroDetalhes } from '../pncp/detalhes.js';
import { criarLimitador, criarLog } from '../util.js';

const OrganizacaoId = z.uuid({ error: 'organizacao_id inválido.' });
const PedidoCheckout = z.object({
  organizacao_id: OrganizacaoId,
  plano: z.string({ error: 'Informe o plano.' }).min(1).max(40),
  ciclo: z.enum(['mensal', 'anual'], { error: 'ciclo deve ser "mensal" ou "anual".' }),
});
const PedidoPortal = z.object({ organizacao_id: OrganizacaoId });

const PedidoAnalise = z
  .object({
    organizacao_id: z.uuid({ error: 'organizacao_id inválido.' }),
    licitacao_id: z.number().int().positive().optional(),
    arquivo_path: z.string().min(3).max(500).optional(),
    texto: z.string().optional(),
    nome_arquivo: z.string().max(200).optional(),
    forcar: z.boolean().optional(),
  })
  .refine(
    (p) => [p.licitacao_id, p.arquivo_path, p.texto].filter((v) => v !== undefined).length === 1,
    { error: 'Informe exatamente uma origem: licitacao_id, arquivo_path ou texto.' },
  );

/**
 * @param {object} deps
 * @param {ReturnType<import('./repositorio.js').criarRepositorio>} deps.repositorio
 * @param {(entrada: object) => Promise<object>} deps.analisar   ver ia/analisar-edital.js
 * @param {(licitacao: object, opcoes: object) => Promise<{pdf: Buffer, nomeArquivo: string}>} deps.obterEdital
 * @param {ReturnType<import('../pagamentos/stripe.js').criarPagamentos>|null} [deps.pagamentos]  null = assinaturas desligadas
 * @param {ReturnType<import('../pncp/detalhes.js').criarDetalhes>|null} [deps.detalhes]  documentos e itens do PNCP
 * @param {object} [deps.opcoes]
 */
export function criarApp({ repositorio, analisar, obterEdital, pagamentos = null, detalhes = null, opcoes = {}, log = criarLog('api') }) {
  const {
    origens = ['*'],
    analisesSimultaneas = 2,
    textoMaxCaracteres = 1_500_000,
    pdfMaxBytes = 20 * 1024 * 1024,
  } = opcoes;

  const limitar = criarLimitador(Math.max(1, analisesSimultaneas));
  const tarefas = new Set();
  const app = new Hono();

  app.use('*', cors({
    origin: origens.includes('*') ? '*' : origens,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  }));

  app.onError((erro, c) => {
    if (erro instanceof ErroAnalise || erro instanceof ErroPagamento || erro instanceof ErroDetalhes) {
      return c.json({ erro: erro.message, codigo: erro.codigo }, erro.status);
    }
    log.erro(erro?.stack ?? String(erro));
    return c.json({ erro: 'Erro interno. Tente novamente em instantes.' }, 500);
  });
  app.notFound((c) => c.json({ erro: 'Rota não encontrada.' }, 404));

  app.get('/saude', (c) => c.json({ ok: true, servico: 'licitahub-api' }));

  const semPagamentos = (c) => c.json({ erro: 'As assinaturas ainda não estão configuradas.', codigo: 'stripe_sem_chave' }, 503);

  // Avisos da Stripe (pagou, atrasou, cancelou...). Fica fora de /api porque a
  // Stripe não tem login: a prova de origem é a assinatura digital do aviso.
  app.post(
    '/stripe/webhook',
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ erro: 'Aviso grande demais.' }, 413) }),
    async (c) => {
      if (!pagamentos) return semPagamentos(c);
      const evento = pagamentos.verificarEvento(await c.req.text(), c.req.header('stripe-signature'));
      const r = await pagamentos.processarEvento(evento);
      log.info(`Stripe: ${evento.type} -> ${r.ignorado ? `ignorado (${r.ignorado})` : `plano ${r.plano} (${r.status})`}`);
      return c.json({ recebido: true });
    },
  );

  // Login obrigatório em /api/*
  app.use('/api/*', async (c, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    if (!token) return c.json({ erro: 'Faça login para continuar.' }, 401);
    const usuario = await repositorio.usuarioDoToken(token);
    if (!usuario) return c.json({ erro: 'Sessão inválida ou expirada. Entre novamente.' }, 401);
    c.set('usuario', usuario);
    c.set('db', repositorio.comoUsuario(token));
    await next();
  });

  app.post(
    '/api/editais/analisar',
    bodyLimit({
      maxSize: 4 * 1024 * 1024,
      onError: (c) => c.json({ erro: 'Pedido grande demais. Envie o PDF pelo Storage e informe arquivo_path.' }, 413),
    }),
    async (c) => {
      let corpo;
      try {
        corpo = await c.req.json();
      } catch {
        return c.json({ erro: 'O corpo do pedido precisa ser JSON.' }, 400);
      }
      const validacao = PedidoAnalise.safeParse(corpo);
      if (!validacao.success) {
        return c.json({ erro: validacao.error.issues[0]?.message ?? 'Pedido inválido.' }, 400);
      }
      const pedido = validacao.data;
      const usuario = c.get('usuario');
      const db = c.get('db');

      if (!(await db.ehMembro(pedido.organizacao_id))) {
        return c.json({ erro: 'Você não participa desta organização.' }, 403);
      }

      let origem;
      let licitacao = null;
      if (pedido.texto !== undefined) {
        if (pedido.texto.trim().length < 200) return c.json({ erro: 'O texto do edital é curto demais para análise.' }, 400);
        if (pedido.texto.length > textoMaxCaracteres) {
          return c.json({ erro: `O texto passa do limite de ${textoMaxCaracteres.toLocaleString('pt-BR')} caracteres.` }, 413);
        }
        origem = 'texto';
      } else if (pedido.arquivo_path !== undefined) {
        if (!pedido.arquivo_path.startsWith(`${pedido.organizacao_id}/`) || pedido.arquivo_path.includes('..')) {
          return c.json({ erro: 'O PDF precisa estar na pasta da organização no Storage: editais/<organizacao_id>/arquivo.pdf' }, 400);
        }
        origem = 'upload';
      } else {
        licitacao = await db.licitacao(pedido.licitacao_id);
        if (!licitacao) return c.json({ erro: 'Licitação não encontrada.' }, 404);
        if (licitacao.fonte !== 'pncp') {
          return c.json({ erro: 'Esta licitação foi cadastrada manualmente. Envie o PDF do edital.' }, 400);
        }
        origem = 'pncp';
      }

      const { limite, usadas } = await repositorio.cotaMensal(pedido.organizacao_id);
      if (usadas >= limite) {
        return c.json({ erro: `O plano permite ${limite} análise(s) por mês e o limite foi atingido.`, codigo: 'cota_esgotada' }, 429);
      }

      const id = await repositorio.criarAnalise({
        organizacao_id: pedido.organizacao_id,
        licitacao_id: licitacao?.id ?? null,
        solicitado_por: usuario.id,
        origem,
        arquivo_path: pedido.arquivo_path ?? null,
        arquivo_nome: pedido.nome_arquivo ?? null,
        status: 'pendente',
      });

      agendar(() => processar({ id, pedido, origem, licitacao, db }));
      return c.json({ id, status: 'pendente', mensagem: 'Análise iniciada. Acompanhe pelo id.' }, 202);
    },
  );

  app.get('/api/editais/analises/:id', async (c) => {
    const id = c.req.param('id');
    if (!z.uuid().safeParse(id).success) return c.json({ erro: 'id inválido.' }, 400);
    const analise = await c.get('db').analise(id);
    if (!analise) return c.json({ erro: 'Análise não encontrada.' }, 404);
    return c.json(analise);
  });

  // --- Detalhes da licitação no PNCP (botões "Baixar editais" e "Ver itens") ---
  const rotaDetalhe = (tipo) => async (c) => {
    if (!detalhes) return c.json({ erro: 'Consulta ao PNCP desligada neste servidor.' }, 503);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ erro: 'id inválido.' }, 400);
    const licitacao = await c.get('db').licitacao(id);
    if (!licitacao) return c.json({ erro: 'Licitação não encontrada.' }, 404);
    if (licitacao.fonte !== 'pncp') return c.json({ erro: 'Licitação cadastrada à mão: não há dados no PNCP.', codigo: 'manual' }, 404);
    const lista = await detalhes[tipo](licitacao);
    c.header('Cache-Control', 'private, max-age=300');
    return c.json({ [tipo]: lista });
  };
  app.get('/api/licitacoes/:id/arquivos', rotaDetalhe('arquivos'));
  app.get('/api/licitacoes/:id/itens', rotaDetalhe('itens'));

  // --- Assinaturas -----------------------------------------------------------

  /** Lê e valida o JSON do pedido. Devolve { pedido } ou { resposta } com o erro. */
  async function lerPedido(c, esquema) {
    let corpo;
    try {
      corpo = await c.req.json();
    } catch {
      return { resposta: c.json({ erro: 'O corpo do pedido precisa ser JSON.' }, 400) };
    }
    const validacao = esquema.safeParse(corpo);
    if (!validacao.success) return { resposta: c.json({ erro: validacao.error.issues[0]?.message ?? 'Pedido inválido.' }, 400) };
    return { pedido: validacao.data };
  }

  /** A organização, se quem pede for dono ou administrador dela (senão null). */
  async function organizacaoGerenciavel(c, organizacaoId) {
    const db = c.get('db');
    if (!(await db.temPapel(organizacaoId, ['dono', 'admin']))) return null;
    return db.organizacao(organizacaoId);
  }

  const soDonoOuAdmin = (c) =>
    c.json({ erro: 'Só o dono ou um administrador da organização pode cuidar da assinatura.' }, 403);

  app.post('/api/assinaturas/checkout', async (c) => {
    if (!pagamentos) return semPagamentos(c);
    const { pedido, resposta } = await lerPedido(c, PedidoCheckout);
    if (resposta) return resposta;
    const organizacao = await organizacaoGerenciavel(c, pedido.organizacao_id);
    if (!organizacao) return soDonoOuAdmin(c);
    const r = await pagamentos.criarCheckout({
      organizacao, usuario: c.get('usuario'), plano: pedido.plano, ciclo: pedido.ciclo,
    });
    return c.json(r);
  });

  app.post('/api/assinaturas/portal', async (c) => {
    if (!pagamentos) return semPagamentos(c);
    const { pedido, resposta } = await lerPedido(c, PedidoPortal);
    if (resposta) return resposta;
    const organizacao = await organizacaoGerenciavel(c, pedido.organizacao_id);
    if (!organizacao) return soDonoOuAdmin(c);
    return c.json(await pagamentos.criarPortal({ organizacao }));
  });

  // --- Conta -----------------------------------------------------------------
  // Exclusão da própria conta (direito de eliminação - LGPD). O gatilho do banco
  // (ao_excluir_usuario) apaga junto as organizações em que a pessoa é a única dona.
  app.delete('/api/conta', async (c) => {
    await repositorio.excluirUsuario(c.get('usuario').id);
    return c.json({ excluida: true });
  });

  function agendar(tarefa) {
    const p = limitar(tarefa)
      .catch((e) => log.erro(`Tarefa em segundo plano falhou: ${e?.stack ?? e}`))
      .finally(() => tarefas.delete(p));
    tarefas.add(p);
  }

  async function processar({ id, pedido, origem, licitacao, db }) {
    const agora = () => new Date().toISOString();
    try {
      await repositorio.atualizarAnalise(id, { status: 'processando' });

      let entrada;
      if (origem === 'texto') {
        entrada = { texto: pedido.texto, nomeArquivo: pedido.nome_arquivo ?? 'edital.txt' };
      } else if (origem === 'upload') {
        const pdf = await db.baixarDoStorage(pedido.arquivo_path);
        if (!pdf) throw new ErroAnalise('Arquivo não encontrado no Storage (ou sem permissão).', { codigo: 'arquivo_nao_encontrado', status: 404 });
        verificarPdf(pdf, pdfMaxBytes);
        entrada = { pdf, nomeArquivo: pedido.nome_arquivo ?? pedido.arquivo_path.split('/').pop() };
      } else {
        const edital = await obterEdital(licitacao, { maxBytes: pdfMaxBytes });
        entrada = {
          pdf: edital.pdf,
          nomeArquivo: edital.nomeArquivo,
          contexto: {
            objeto: licitacao.objeto,
            orgao: licitacao.orgao_razao_social,
            modalidade: licitacao.modalidade_nome,
            numeroControle: licitacao.numero_controle_pncp,
            sistemaOrigem: licitacao.sistema_origem,
          },
        };
      }

      const hash = sha256(entrada.pdf ?? Buffer.from(entrada.texto, 'utf8'));
      await repositorio.atualizarAnalise(id, { arquivo_nome: entrada.nomeArquivo, arquivo_sha256: hash });

      // Mesmo arquivo já analisado pela organização: reaproveita (custo zero).
      if (!pedido.forcar) {
        const anterior = await repositorio.analiseConcluidaPorHash(pedido.organizacao_id, hash, id);
        if (anterior) {
          await repositorio.atualizarAnalise(id, {
            status: 'concluida', resultado: anterior.resultado, modelo: 'reaproveitado',
            tokens_entrada: 0, tokens_saida: 0, custo_estimado_usd: 0, concluido_em: agora(),
          });
          log.info(`Análise ${id}: reaproveitada de ${anterior.id} (mesmo arquivo).`);
          return;
        }
      }

      const r = await analisar(entrada);
      await repositorio.atualizarAnalise(id, {
        status: 'concluida',
        resultado: r.analise,
        modelo: r.modelo,
        tokens_entrada: r.uso?.entrada ?? null,
        tokens_saida: r.uso?.saida ?? null,
        custo_estimado_usd: r.custoEstimadoUsd ?? null,
        concluido_em: agora(),
      });
      log.info(`Análise ${id} concluída (${r.modelo}${r.custoEstimadoUsd != null ? `, ~US$ ${r.custoEstimadoUsd}` : ''}).`);
    } catch (erro) {
      const conhecido = erro instanceof ErroAnalise;
      if (conhecido) log.aviso(`Análise ${id}: ${erro.codigo} - ${erro.message}`);
      else log.erro(`Análise ${id}: ${erro?.stack ?? erro}`);
      await repositorio
        .atualizarAnalise(id, {
          status: 'erro',
          erro: conhecido ? erro.message : 'Erro inesperado ao analisar o edital. Tente novamente.',
          concluido_em: agora(),
        })
        .catch((e) => log.erro(`Não foi possível registrar o erro da análise ${id}: ${e.message}`));
    }
  }

  /** Para testes e desligamento: espera as análises em andamento terminarem. */
  app.aguardarTarefas = () => Promise.allSettled([...tarefas]);
  return app;
}
