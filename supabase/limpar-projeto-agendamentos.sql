-- =============================================================================
-- LIMPEZA do projeto do SISTEMA DE AGENDAMENTOS (pssqwsoiinynndeagpkf)
--
-- Em 15/11/2026 o schema.sql do LicitaHub foi rodado por engano nesse projeto.
-- Este script tira de lá tudo o que o LicitaHub criou e NÃO toca no sistema de
-- agendamentos (tabelas agendamentos, cadastros, função horarios_ocupados...).
--
-- Travas de segurança. Ele só apaga se:
--   1. existir a tabela public.agendamentos (ou seja, é o projeto do agendamentos);
--   2. as tabelas do LicitaHub nesse projeto estiverem vazias.
-- Se uma trava disparar, aparece um erro começando com "PARADO" e nada é apagado.
--
-- NUNCA rode este arquivo no projeto do LicitaHub (lstyjthunravkwdszbwi).
-- No SQL Editor, o Supabase vai avisar "destructive operation": confirme em
-- "Run this query". No fim aparece uma linha com zeros = limpeza feita.
-- =============================================================================
do $$
declare
  tem_dados boolean := false;
  funcao text;
begin
  -- Trava 1: só no projeto do agendamentos
  if to_regclass('public.agendamentos') is null then
    raise exception 'PARADO: este não é o projeto do sistema de agendamentos. Nada foi apagado.';
  end if;

  -- Trava 2: as tabelas do LicitaHub aqui precisam estar vazias
  if to_regclass('public.organizacoes') is not null then
    execute 'select exists (select 1 from public.organizacoes)' into tem_dados;
  end if;
  if not tem_dados and to_regclass('public.licitacoes') is not null then
    execute 'select exists (select 1 from public.licitacoes)' into tem_dados;
  end if;
  if tem_dados then
    raise exception 'PARADO: as tabelas do LicitaHub neste projeto têm dados. Nada foi apagado.';
  end if;

  -- 1. Gatilhos que o LicitaHub pôs no cadastro de usuários
  drop trigger if exists ao_criar_usuario on auth.users;
  drop trigger if exists ao_excluir_usuario on auth.users;

  -- 2. Regras e pasta de PDFs do LicitaHub (só o bucket "editais")
  drop policy if exists "editais: membros leem" on storage.objects;
  drop policy if exists "editais: membros enviam" on storage.objects;
  drop policy if exists "editais: membros apagam" on storage.objects;
  drop policy if exists "documentos: membros leem" on storage.objects;
  drop policy if exists "documentos: membros enviam" on storage.objects;
  drop policy if exists "documentos: membros apagam" on storage.objects;
  begin
    delete from storage.buckets where id in ('editais', 'documentos');
  exception when others then
    raise notice 'As pastas "editais"/"documentos" ficaram: apague no painel (Storage > pasta > Delete bucket).';
  end;

  -- 3. Visões e tabelas do LicitaHub (as do agendamentos não estão na lista)
  drop view if exists public.vw_crm_cards, public.vw_consentimentos_atuais;
  drop table if exists
    public.robo_concorrentes, public.robo_historico, public.mercado_resultados, public.mercado_coleta, public.chat_mensagens,
    public.auction_live_bids, public.robo_sessoes, public.portal_credentials,
    public.robo_itens, public.documentos, public.propostas, public.radares, public.eventos, public.monitoramentos,
    public.crm_cards, public.favoritos, public.licitacao_observacoes, public.analises_edital, public.licitacao_itens,
    public.kanban_etapas, public.empresas, public.consentimentos, public.assinaturas,
    public.sync_execucoes, public.mercado_retro_termos, public.licitacoes_busca, public.busca_correlatos, public.membros, public.perfis, public.licitacoes, public.organizacoes;

  -- 4. Funções do LicitaHub. Se outro sistema usar alguma, ela fica e aparece um aviso.
  foreach funcao in array array[
    'public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int)',
    'public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[])',
    'public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[])',
    'public.tipo_objeto(text)', 'public.radical_busca(text)', 'public.licitacoes_busca_sincronizar()', 'public.radar_novidades(text, text[], text[], int[], timestamptz, int)', 'public.radar_destinatarios(uuid[])', 'public.mercado_pesquisa(text, text[], text, int, int)', 'public.mercado_concorrente_painel(text)', 'public.banco_tamanho_mb()', 'public.licitacoes_external_id()',
    'public.mercado_concorrentes(text, int)', 'public.mercado_concorrente_itens(text, int)', 'public.mercado_precos(text, text[], text, date)',
    'public.radar_contagem(text, text[], text[], int[], date, date)',
    'public.exportar_meus_dados()', 'public.criar_organizacao(text, text)',
    'public.limpar_licitacoes_antigas(int)', 'public.validar_card()', 'public.verificar_limite_empresas()',
    'public.proteger_ultimo_dono()', 'public.ao_excluir_usuario()', 'public.ao_criar_usuario()',
    'public.ao_criar_organizacao()', 'public.normalizar_cnpj()', 'public.compartilha_organizacao(uuid)',
    'public.tem_papel(uuid, text[])', 'public.eh_membro(uuid)', 'public.tocar_atualizado_em()', 'public.robo_conferir_lance()',
    'public.uuid_ou_nulo(text)', 'public.cnpj_valido(text)', 'public.cnpj_limpo(text)'
  ] loop
    begin
      execute 'drop function if exists ' || funcao;
    exception when dependent_objects_still_exist then
      raise notice 'Mantida porque outro sistema usa: %', funcao;
    end;
  end loop;

  -- 5. Configuração de busca em português sem acento
  drop text search configuration if exists public.portugues_sem_acento;
end $$;

-- Conferência: tudo zero = o projeto do agendamentos não tem mais nada do LicitaHub.
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('organizacoes', 'perfis', 'membros', 'empresas', 'licitacoes', 'assinaturas'))
    as tabelas_do_licitahub,
  (select count(*) from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname in ('ao_criar_usuario', 'ao_excluir_usuario'))
    as gatilhos_do_licitahub;
