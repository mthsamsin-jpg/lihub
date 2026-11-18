-- =============================================================================
-- Uso LicitaHub · Licita Lances: MODO REAL
--   portal_credentials : cofre de credenciais dos portais (cifradas no servidor)
--   robo_sessoes       : uma conexão do robô a um pregão real (worker Playwright)
--   auction_live_bids  : eventos ao vivo da sala (lances, fases, mensagens),
--                        transmitidos para a tela pelo Supabase Realtime
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
-- (O schema.sql completo já inclui isto.) Precisa do atualizar-robo.sql antes.
-- =============================================================================

-- Cofre de credenciais ---------------------------------------------------------
-- O segredo (senha ou certificado A1 + senha) chega aqui JÁ CIFRADO pelo servidor
-- (AES-256-GCM, chave CREDENCIAIS_CHAVE que existe só no servidor). O banco nunca
-- vê o segredo aberto. Sem políticas de RLS: só o servidor (service role) acessa;
-- a tela lista apenas os metadados pela API.
create table if not exists public.portal_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  portal            text not null,
  tipo              text not null check (tipo in ('senha', 'certificado')),
  login_mascarado   text check (login_mascarado is null or char_length(login_mascarado) <= 80),
  certificado_nome  text check (certificado_nome is null or char_length(certificado_nome) <= 200),
  segredo_cifrado   text not null check (char_length(segredo_cifrado) <= 200000),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  ultimo_uso_em     timestamptz,
  unique (user_id, portal)
);
alter table public.portal_credentials drop constraint if exists portal_credentials_portal;
alter table public.portal_credentials add constraint portal_credentials_portal check (portal in (
  'comprasnet', 'licitacoes-e', 'bbmnet', 'bnc', 'pcp', 'bll', 'licitanet', 'licitar', 'licitamais',
  'comprasbr', 'petronect', 'outros'));
alter table public.portal_credentials enable row level security;
revoke all on public.portal_credentials from anon, authenticated;
drop trigger if exists tocar_atualizado_em on public.portal_credentials;
create trigger tocar_atualizado_em before update on public.portal_credentials
  for each row execute function public.tocar_atualizado_em();

-- Item do robô ligado a um pregão real -----------------------------------------
alter table public.robo_itens add column if not exists pregao_ref text;
alter table public.robo_itens add column if not exists lote_ref text;
alter table public.robo_itens drop constraint if exists robo_itens_pregao_ref;
alter table public.robo_itens add constraint robo_itens_pregao_ref check (pregao_ref is null or char_length(pregao_ref) between 1 and 120);
alter table public.robo_itens drop constraint if exists robo_itens_lote_ref;
alter table public.robo_itens add constraint robo_itens_lote_ref check (lote_ref is null or char_length(lote_ref) between 1 and 40);

-- Sessões do worker -------------------------------------------------------------
create table if not exists public.robo_sessoes (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  robo_item_id    uuid not null references public.robo_itens (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  portal          text not null,
  pregao_ref      text not null check (char_length(pregao_ref) between 1 and 120),
  lote_ref        text check (lote_ref is null or char_length(lote_ref) between 1 and 40),
  -- "monitorar": só lê a sala. "lances": o robô envia lances de verdade.
  modo            text not null default 'monitorar' check (modo in ('monitorar', 'lances')),
  status          text not null default 'iniciando'
                  check (status in ('iniciando', 'conectado', 'pausado', 'erro', 'encerrada')),
  erro            text check (erro is null or char_length(erro) <= 1000),
  iniciado_em     timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  encerrado_em    timestamptz
);
create index if not exists robo_sessoes_item_idx on public.robo_sessoes (robo_item_id, iniciado_em desc);
alter table public.robo_sessoes enable row level security;
drop policy if exists robo_sessoes_membros_leem on public.robo_sessoes;
create policy robo_sessoes_membros_leem on public.robo_sessoes for select to authenticated
  using (public.eh_membro(organizacao_id));
-- Escrita só pelo servidor (service role).
revoke insert, update, delete on public.robo_sessoes from anon, authenticated;
drop trigger if exists tocar_atualizado_em on public.robo_sessoes;
create trigger tocar_atualizado_em before update on public.robo_sessoes
  for each row execute function public.tocar_atualizado_em();

-- Eventos ao vivo da sala ---------------------------------------------------------
create table if not exists public.auction_live_bids (
  id              bigint generated always as identity primary key,
  sessao_id       uuid not null references public.robo_sessoes (id) on delete cascade,
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  robo_item_id    uuid not null references public.robo_itens (id) on delete cascade,
  tipo            text not null check (tipo in ('lance', 'fase', 'mensagem', 'status', 'alerta')),
  autor           text check (autor is null or char_length(autor) <= 200),
  porte           text check (porte is null or porte in ('me', 'epp', 'demais', 'nos')),
  valor           numeric(18, 2) check (valor is null or valor > 0),
  fase            text check (fase is null or fase in ('aberta', 'prorrogacao', 'desempate', 'negociacao', 'habilitacao', 'encerrada')),
  texto           text check (texto is null or char_length(texto) <= 2000),
  criado_em       timestamptz not null default now()
);
create index if not exists auction_live_bids_item_idx on public.auction_live_bids (robo_item_id, id);
create index if not exists auction_live_bids_sessao_idx on public.auction_live_bids (sessao_id, id);
alter table public.auction_live_bids enable row level security;
drop policy if exists auction_live_bids_membros_leem on public.auction_live_bids;
create policy auction_live_bids_membros_leem on public.auction_live_bids for select to authenticated
  using (public.eh_membro(organizacao_id));
revoke insert, update, delete on public.auction_live_bids from anon, authenticated;

-- Tempo real: a tela recebe cada evento da sala e cada mudança da sessão.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'auction_live_bids') then
      alter publication supabase_realtime add table public.auction_live_bids;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'robo_sessoes') then
      alter publication supabase_realtime add table public.robo_sessoes;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Conferência: deve mostrar as 3 tabelas.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('portal_credentials', 'robo_sessoes', 'auction_live_bids')
order by 1;
