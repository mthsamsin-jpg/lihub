// Gerenciador das sessões do modo real (roda dentro do servidor da API).
// Cria a sessão no banco, abre a credencial do cofre, escolhe o adaptador do
// portal e liga tudo. As escritas usam o cliente admin (service role): as
// tabelas do modo real não aceitam escrita vinda do navegador.
import { criarAdaptador, situacaoDosPortais } from './adaptadores/index.js';
import { SessaoReal } from './sessao.js';
import { enviarWebhook } from './webhook.js';

export class ErroModoReal extends Error {
  constructor(mensagem, status = 400, codigo = 'modo_real') {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

const num = (v) => (v == null ? null : Number(v));

// Palavras que identificam o produto (sem acentos, sem palavras curtas e sem medidas soltas).
const palavras = (t) => new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !['item', 'lote', 'para', 'com', 'tipo', 'unidade'].includes(w)));

/** Fechamentos parecidos com a descrição do item (pelo menos 40% das palavras em comum). */
export function historicoParecido(descricao, linhas, minimo = 0.4) {
  const alvo = palavras(descricao);
  if (!alvo.size) return [];
  return linhas.filter((h) => {
    const p = palavras(h.descricao);
    let comum = 0;
    for (const w of alvo) if (p.has(w)) comum += 1;
    return comum / Math.min(alvo.size, p.size || 1) >= minimo;
  }).map((h) => ({ desagioPct: num(h.desagio_pct), descricao: h.descricao }));
}
const itemDoBanco = (r) => ({
  id: r.id, organizacaoId: r.organizacao_id, plataforma: r.plataforma, descricao: r.descricao,
  teto: num(r.max_price), custo: num(r.supplier_cost), piso: num(r.min_floor_price), decremento: num(r.decremento) ?? 0.01,
  intervaloSeg: r.intervalo_seg ?? 20, nossoPorte: r.nosso_porte || 'demais', fugirEmpate: !!r.fugir_empate, quantidade: r.quantidade || 1,
  sniperSeg: r.sniper_seg ?? 0, margemMinPct: num(r.margem_min_pct),
});

/**
 * @param {object} deps
 * @param {object} deps.admin             cliente Supabase com a chave secreta
 * @param {ReturnType<import('../src/cofre.js').criarCofre>|null} deps.cofre
 * @param {() => Promise<object>} [deps.carregarPlaywright]
 * @param {(portal: string, deps: object) => object} [deps.fabricaAdaptador]  troca nos testes
 */
export function criarGerenciador({
  admin, cofre, carregarPlaywright = () => import('playwright'), fabricaAdaptador = criarAdaptador,
  maxSessoes = 3, permitirNaoValidado = false, headless = true, executavel = null, log = console,
}) {
  const ativas = new Map(); // sessao_id -> SessaoReal

  async function falhaBanco(promessa, texto) {
    const { data, error } = await promessa;
    if (error) throw new ErroModoReal(`${texto}: ${error.message}`, 500, 'banco');
    return data;
  }

  async function credencialAberta(userId, portal) {
    if (!cofre) throw new ErroModoReal('O cofre de credenciais não está configurado no servidor (CREDENCIAIS_CHAVE).', 503, 'sem_cofre');
    const linha = await falhaBanco(admin.from('portal_credentials').select('id, segredo_cifrado').eq('user_id', userId).eq('portal', portal).maybeSingle(), 'Falha ao ler o cofre');
    if (!linha) throw new ErroModoReal('Salve a credencial deste portal no cofre antes de conectar.', 409, 'sem_credencial');
    const segredo = cofre.decifrar(linha.segredo_cifrado, { dono: userId, portal });
    await admin.from('portal_credentials').update({ ultimo_uso_em: new Date().toISOString() }).eq('id', linha.id);
    return segredo;
  }

  return {
    situacao: () => ({ ativas: ativas.size, maxSessoes, portais: situacaoDosPortais() }),

    /** Conecta um item do robô a um pregão real. Quem chama já conferiu que o usuário é membro da organização. */
    async iniciar({ usuario, item: linhaItem, pregao, lote = null, modo = 'monitorar' }) {
      if (ativas.size >= maxSessoes) throw new ErroModoReal(`O servidor já está com ${maxSessoes} sessões reais abertas. Encerre uma antes.`, 429, 'limite');
      for (const s of ativas.values()) {
        if (s.sessao.robo_item_id === linhaItem.id) throw new ErroModoReal('Este item já está conectado a uma sala.', 409, 'ja_conectado');
      }
      const item = itemDoBanco(linhaItem);
      if (item.plataforma === 'pncp') throw new ErroModoReal('O PNCP só publica as compras: conecte o item ao portal onde a disputa acontece.', 400, 'portal');
      const credencial = await credencialAberta(usuario.id, item.plataforma);

      await falhaBanco(admin.from('robo_itens').update({ pregao_ref: pregao, lote_ref: lote }).eq('id', item.id), 'Falha ao gravar o pregão no item');
      const sessao = await falhaBanco(admin.from('robo_sessoes').insert({
        organizacao_id: item.organizacaoId, robo_item_id: item.id, user_id: usuario.id, portal: item.plataforma,
        pregao_ref: pregao, lote_ref: lote, modo,
      }).select('*').single(), 'Falha ao criar a sessão');

      const adaptador = fabricaAdaptador(item.plataforma, { credencial, carregarPlaywright, permitirNaoValidado, headless, executavel, log });
      // Camada preditiva: histórico de fechamentos parecidos e o webhook da organização.
      const { data: linhasHist } = await admin.from('robo_historico').select('descricao, desagio_pct')
        .eq('organizacao_id', item.organizacaoId).order('encerrado_em', { ascending: false }).limit(500);
      const historico = historicoParecido(item.descricao, linhasHist || []);
      const { data: alertas } = await admin.from('robo_alertas').select('webhook_url').eq('organizacao_id', item.organizacaoId).maybeSingle();
      const webhook = alertas?.webhook_url || null;
      const base = { sessao_id: sessao.id, organizacao_id: item.organizacaoId, robo_item_id: item.id };
      const s = new SessaoReal({
        sessao, item, adaptador, log,
        gravar: (ev) => falhaBanco(admin.from('auction_live_bids').insert({
          ...base, tipo: ev.tipo, autor: ev.autor ?? null, porte: ev.porte ?? null, valor: ev.valor ?? null, fase: ev.fase ?? null, texto: ev.texto ?? null,
        }), 'Falha ao gravar o evento'),
        atualizarSessao: (campos) => falhaBanco(admin.from('robo_sessoes').update(campos).eq('id', sessao.id), 'Falha ao atualizar a sessão'),
        atualizarItem: (campos) => falhaBanco(admin.from('robo_itens').update(campos).eq('id', item.id), 'Falha ao atualizar o item'),
        historico,
        notificar: webhook ? (dados) => enviarWebhook(webhook, dados) : null,
        salvarFechamento: ({ preco, vencemos, lances }) => falhaBanco(admin.from('robo_historico').insert({
          organizacao_id: item.organizacaoId, robo_item_id: item.id, origem: 'disputa', portal: item.plataforma,
          descricao: item.descricao, teto: item.teto, preco_fechamento: preco, vencemos, lances,
        }), 'Falha ao gravar o histórico'),
        salvarPerfis: async (perfis) => {
          for (const c of perfis) {
            const identificador = c.cnpj || c.autor;
            const { data: atual } = await admin.from('robo_concorrentes').select('disputas, lances')
              .eq('organizacao_id', item.organizacaoId).eq('portal', item.plataforma).eq('identificador', identificador).maybeSingle();
            await falhaBanco(admin.from('robo_concorrentes').upsert({
              organizacao_id: item.organizacaoId, portal: item.plataforma, identificador, cnpj: c.cnpj || null,
              disputas: (atual?.disputas || 0) + 1, lances: (atual?.lances || 0) + c.lances,
              resposta_mediana_ms: c.respostaMedianaMs, agressividade_pct: c.agressividadePct, perfil: c.perfil,
              atualizado_em: new Date().toISOString(),
            }, { onConflict: 'organizacao_id,portal,identificador' }), 'Falha ao gravar o perfil');
          }
        },
      });
      ativas.set(sessao.id, s);
      const fim = s.encerrar.bind(s);
      s.encerrar = async (...args) => { try { await fim(...args); } finally { ativas.delete(sessao.id); } };
      s.iniciar(); // segue em segundo plano; o andamento chega pela tabela robo_sessoes
      return sessao;
    },

    sessao: (id) => ativas.get(id) || null,

    async pausar(id) { await this.exigir(id).pausar(); },
    async retomar(id) { await this.exigir(id).retomar(); },
    async parar(id) { await this.exigir(id).encerrar('Robô desconectado pelo operador.'); },
    async atualizarLimites(id, linhaItem) {
      const i = itemDoBanco(linhaItem);
      this.exigir(id).atualizarLimites({ piso: i.piso, teto: i.teto });
    },
    exigir(id) {
      const s = ativas.get(id);
      if (!s) throw new ErroModoReal('Esta sessão não está mais ativa no servidor.', 404, 'sem_sessao');
      return s;
    },
    /** Desligamento do servidor: fecha os navegadores. */
    async encerrarTudo() {
      await Promise.all([...ativas.values()].map((s) => s.encerrar('Servidor reiniciado: sessão encerrada.')));
    },
  };
}
