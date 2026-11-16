// Acesso ao banco usado pela API. Fica separado para os testes poderem
// trocar por uma versão em memória.
import { hojeBrasilia } from '../util.js';

const falhar = (contexto, error) => {
  throw new Error(`${contexto}: ${error.message}`);
};

// Pastas do Storage separadas por organização (<id-da-organizacao>/...).
export const PASTAS_DA_ORGANIZACAO = ['editais', 'documentos'];

/** Apaga todos os arquivos de uma pasta do Storage, inclusive das subpastas. */
export async function apagarPasta(admin, bucket, prefixo) {
  const armazenamento = admin.storage.from(bucket);
  let itens;
  do {
    const { data, error } = await armazenamento.list(prefixo, { limit: 1000 });
    if (error) falhar(`Falha ao listar ${bucket}/${prefixo}`, error);
    itens = data ?? [];
    for (const pasta of itens.filter((i) => !i.id)) await apagarPasta(admin, bucket, `${prefixo}/${pasta.name}`);
    const arquivos = itens.filter((i) => i.id).map((i) => `${prefixo}/${i.name}`);
    if (arquivos.length) {
      const { error: erro } = await armazenamento.remove(arquivos);
      if (erro) falhar(`Falha ao apagar arquivos de ${bucket}/${prefixo}`, erro);
    }
  } while (itens.length === 1000);
}

/**
 * @param {object} deps
 * @param {import('@supabase/supabase-js').SupabaseClient} deps.admin  cliente com chave secreta
 * @param {(token: string) => import('@supabase/supabase-js').SupabaseClient} deps.criarClienteDoUsuario
 */
export function criarRepositorio({ admin, criarClienteDoUsuario }) {
  return {
    /** Valida o token de login no Supabase Auth e devolve o usuário (ou null). */
    async usuarioDoToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user) return null;
      return data.user;
    },

    /** Operações feitas COMO o usuário: o RLS do banco decide o que ele pode ver. */
    comoUsuario(token) {
      const db = criarClienteDoUsuario(token);
      return {
        async ehMembro(organizacaoId) {
          const { data, error } = await db.rpc('eh_membro', { p_org: organizacaoId });
          if (error) falhar('Falha ao verificar a organização', error);
          return data === true;
        },

        async temPapel(organizacaoId, papeis) {
          const { data, error } = await db.rpc('tem_papel', { p_org: organizacaoId, p_papeis: papeis });
          if (error) falhar('Falha ao verificar o papel na organização', error);
          return data === true;
        },

        async organizacao(id) {
          const { data, error } = await db.from('organizacoes').select('id, nome').eq('id', id).maybeSingle();
          if (error) falhar('Falha ao buscar a organização', error);
          return data;
        },

        async licitacao(id) {
          const { data, error } = await db
            .from('licitacoes')
            .select('id, fonte, numero_controle_pncp, orgao_cnpj, ano_compra, sequencial_compra, objeto, orgao_razao_social, modalidade_nome, sistema_origem')
            .eq('id', id)
            .maybeSingle();
          if (error) falhar('Falha ao buscar a licitação', error);
          return data;
        },

        async baixarDoStorage(caminho) {
          const { data, error } = await db.storage.from('editais').download(caminho);
          if (error || !data) return null;
          return Buffer.from(await data.arrayBuffer());
        },

        async analise(id) {
          const { data, error } = await db.from('analises_edital').select('*').eq('id', id).maybeSingle();
          if (error) falhar('Falha ao buscar a análise', error);
          return data;
        },
      };
    },

    /**
     * Exclui a conta (LGPD). O gatilho ao_excluir_usuario do banco apaga as
     * organizações em que a pessoa estava sozinha, mas o banco não apaga
     * ARQUIVOS do Storage: por isso as pastas dessas organizações saem antes.
     */
    async excluirUsuario(userId) {
      const { data: minhas, error: e1 } = await admin.from('membros').select('organizacao_id').eq('user_id', userId);
      if (e1) falhar('Falha ao ler as organizações da conta', e1);
      for (const { organizacao_id: org } of minhas ?? []) {
        const { count, error: e2 } = await admin.from('membros').select('user_id', { count: 'exact', head: true }).eq('organizacao_id', org);
        if (e2) falhar('Falha ao contar os membros da organização', e2);
        if (count === 1) {
          for (const pasta of PASTAS_DA_ORGANIZACAO) await apagarPasta(admin, pasta, org);
        }
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) falhar('Falha ao excluir a conta', error);
    },

    /** Quantas análises a organização já usou no mês (horário de Brasília) e o limite do plano. */
    async cotaMensal(organizacaoId) {
      const { data: org, error: e1 } = await admin
        .from('organizacoes').select('limite_analises_ia_mes').eq('id', organizacaoId).single();
      if (e1) falhar('Falha ao ler o plano da organização', e1);

      const inicioDoMes = `${hojeBrasilia().slice(0, 7)}-01T00:00:00-03:00`;
      const { count, error: e2 } = await admin
        .from('analises_edital')
        .select('id', { count: 'exact', head: true })
        .eq('organizacao_id', organizacaoId)
        .gte('criado_em', inicioDoMes)
        .neq('status', 'erro')
        .or('modelo.is.null,modelo.neq.reaproveitado');
      if (e2) falhar('Falha ao contar as análises do mês', e2);
      return { limite: org.limite_analises_ia_mes, usadas: count ?? 0 };
    },

    async criarAnalise(campos) {
      const { data, error } = await admin.from('analises_edital').insert(campos).select('id').single();
      if (error) falhar('Falha ao registrar a análise', error);
      return data.id;
    },

    async atualizarAnalise(id, campos) {
      const { error } = await admin.from('analises_edital').update(campos).eq('id', id);
      if (error) falhar('Falha ao atualizar a análise', error);
    },

    /** Análise já concluída do mesmo arquivo (evita pagar duas vezes). */
    async analiseConcluidaPorHash(organizacaoId, hash, ignorarId) {
      const { data, error } = await admin
        .from('analises_edital')
        .select('id, resultado')
        .eq('organizacao_id', organizacaoId)
        .eq('arquivo_sha256', hash)
        .eq('status', 'concluida')
        .neq('id', ignorarId)
        .order('concluido_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) falhar('Falha ao procurar análise anterior', error);
      return data;
    },

    // --- Assinaturas (Stripe). Só o servidor grava; ver src/pagamentos/stripe.js ---

    async assinatura(organizacaoId) {
      const { data, error } = await admin.from('assinaturas').select('*').eq('organizacao_id', organizacaoId).maybeSingle();
      if (error) falhar('Falha ao ler a assinatura', error);
      return data;
    },

    /** Cria ou atualiza a assinatura da organização (só os campos enviados). */
    async salvarAssinatura(organizacaoId, campos) {
      const { error } = await admin
        .from('assinaturas')
        .upsert({ organizacao_id: organizacaoId, ...campos }, { onConflict: 'organizacao_id' });
      if (error) falhar('Falha ao gravar a assinatura', error);
    },

    async organizacaoDoClienteStripe(clienteId) {
      if (!clienteId) return null;
      const { data, error } = await admin
        .from('assinaturas').select('organizacao_id').eq('stripe_cliente_id', clienteId).maybeSingle();
      if (error) falhar('Falha ao procurar o cliente da Stripe', error);
      return data?.organizacao_id ?? null;
    },

    async organizacaoExiste(organizacaoId) {
      const { data, error } = await admin.from('organizacoes').select('id').eq('id', organizacaoId).maybeSingle();
      if (error) falhar('Falha ao verificar a organização', error);
      return Boolean(data);
    },

    /** Troca o plano e os limites da organização (o usuário não consegue fazer isso sozinho). */
    async aplicarPlano(organizacaoId, plano, limites) {
      const { error } = await admin
        .from('organizacoes')
        .update({ plano, limite_empresas: limites.empresas, limite_analises_ia_mes: limites.analisesMes })
        .eq('id', organizacaoId);
      if (error) falhar('Falha ao aplicar o plano', error);
    },

    /** Marca como erro as análises presas há mais de N minutos (ex.: servidor reiniciou). */
    async encerrarTravadas(minutos = 30) {
      const limite = new Date(Date.now() - minutos * 60_000).toISOString();
      const { data, error } = await admin
        .from('analises_edital')
        .update({
          status: 'erro',
          erro: 'A análise foi interrompida (o servidor reiniciou ou demorou demais). Tente novamente.',
          concluido_em: new Date().toISOString(),
        })
        .in('status', ['pendente', 'processando'])
        .lt('criado_em', limite)
        .select('id');
      if (error) falhar('Falha ao encerrar análises travadas', error);
      return data?.length ?? 0;
    },
  };
}
