-- =============================================================================
-- Uso LicitaHub · CAPAG (Capacidade de Pagamento - Tesouro Nacional)
-- Cache das notas oficiais. Chave: código IBGE (7 dígitos) do município ou
-- "UF-SP" para o estado/DF. Preenchida pelo servidor (scripts/importar-capag.js
-- e a atualização automática); leitura pública (é dado aberto).
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
-- =============================================================================
create table if not exists public.capag (
  chave         text primary key check (chave ~ '^(\d{7}|UF-[A-Z]{2})$'),
  nota          text not null check (nota ~ '^[ABCD]\+?$'),
  fonte         text,
  atualizado_em timestamptz not null default now()
);
alter table public.capag enable row level security;
drop policy if exists capag_leitura on public.capag;
create policy capag_leitura on public.capag for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.capag from anon, authenticated;
grant select on public.capag to anon, authenticated;

notify pgrst, 'reload schema';
