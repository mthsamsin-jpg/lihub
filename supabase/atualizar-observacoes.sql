-- =============================================================================
-- LicitaHub · Observações nos cards de licitação (guardadas na conta)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run.
-- Pode rodar mais de uma vez sem problema. (O schema.sql completo já inclui isto.)
-- =============================================================================

create table if not exists public.licitacao_observacoes (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  licitacao_id   bigint not null references public.licitacoes (id) on delete cascade,
  texto          text not null check (char_length(btrim(texto)) between 1 and 2000),
  atualizado_em  timestamptz not null default now(),
  primary key (user_id, licitacao_id)
);

alter table public.licitacao_observacoes enable row level security;

-- Cada pessoa vê e edita só as próprias observações.
drop policy if exists observacoes_proprias on public.licitacao_observacoes;
create policy observacoes_proprias on public.licitacao_observacoes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.licitacoes l where l.id = licitacao_observacoes.licitacao_id));

grant select, insert, update, delete on public.licitacao_observacoes to authenticated, service_role;
revoke all on public.licitacao_observacoes from anon;

notify pgrst, 'reload schema';

-- Conferência: deve mostrar uma linha com "licitacao_observacoes".
select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'licitacao_observacoes';
