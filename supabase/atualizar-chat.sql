-- =============================================================================
-- Uso LicitaHub · Chat Unificado Multiportal (Fase 1)
-- Caixa de entrada única das mensagens das salas de disputa, de qualquer portal
-- e de qualquer fonte (sessão do Robô Turbo 2.0 ou leitura pública do portal).
-- Idempotente; não apaga nem altera dados existentes.
-- =============================================================================

create table if not exists public.chat_mensagens (
  id              bigint generated always as identity primary key,
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  portal          text not null check (char_length(portal) between 1 and 40),     -- comprasnet, bll, bnc, pcp, bbmnet...
  compra_ref      text not null check (char_length(compra_ref) between 1 and 120), -- nº do pregão / chave da compra no portal
  licitacao_id    bigint references public.licitacoes (id) on delete set null,
  fonte           text not null default 'publica' check (fonte in ('publica', 'robo', 'manual')),
  autor           text check (autor is null or char_length(autor) <= 200),
  papel           text not null default 'outro' check (papel in ('pregoeiro', 'sistema', 'fornecedor', 'outro')),
  texto           text not null check (char_length(texto) between 1 and 4000),
  enviada_em      timestamptz not null default now(),
  hash            text not null,                    -- evita gravar a mesma mensagem duas vezes
  gatilhos        text[] not null default '{}',     -- mencao_cnpj, mencao_nome, convocacao, anexo, prazo, suspensao, resultado, palavra
  relevante       boolean not null default false,
  lida            boolean not null default false,
  alertada_em     timestamptz,
  criada_em       timestamptz not null default now(),
  unique (organizacao_id, portal, compra_ref, hash)
);
create index if not exists chat_mensagens_caixa_idx on public.chat_mensagens (organizacao_id, enviada_em desc);
create index if not exists chat_mensagens_relevantes_idx on public.chat_mensagens (organizacao_id, relevante, lida);

alter table public.chat_mensagens enable row level security;
drop policy if exists chat_mensagens_membros_leem on public.chat_mensagens;
create policy chat_mensagens_membros_leem on public.chat_mensagens for select to authenticated
  using (public.eh_membro(organizacao_id));
drop policy if exists chat_mensagens_membros_marcam on public.chat_mensagens;
create policy chat_mensagens_membros_marcam on public.chat_mensagens for update to authenticated
  using (public.eh_membro(organizacao_id)) with check (public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.chat_mensagens from anon, authenticated;
grant select on public.chat_mensagens to authenticated;
grant update (lida) on public.chat_mensagens to authenticated;   -- o navegador só marca como lida

-- Tempo real: a caixa de entrada recebe as mensagens novas sem recarregar.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagens') then
    execute 'alter publication supabase_realtime add table public.chat_mensagens';
  end if;
end $$;

-- Configuração do monitoramento (tabela já existente): canais e nomes extras.
alter table public.monitoramentos add column if not exists webhook_url text
  check (webhook_url is null or (webhook_url ~ '^https://' and char_length(webhook_url) <= 500));
alter table public.monitoramentos add column if not exists nomes_alerta text[] not null default '{}';  -- outros nomes da empresa
alter table public.monitoramentos add column if not exists portais_publicos boolean not null default true; -- ler o chat público dos pregões cadastrados
