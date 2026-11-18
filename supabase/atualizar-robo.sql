-- =============================================================================
-- Uso LicitaHub · Robô Turbo 2.0 (itens em disputa, limites e status)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
-- (O schema.sql completo já inclui isto.)
-- =============================================================================

create table if not exists public.robo_itens (
  id               uuid primary key default gen_random_uuid(),
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  licitacao_id     bigint references public.licitacoes (id) on delete set null,
  item_numero      int check (item_numero is null or item_numero > 0),
  descricao        text not null check (char_length(btrim(descricao)) between 1 and 300),
  max_price        numeric(18, 2) not null check (max_price > 0),          -- preço teto (valor da administração)
  supplier_cost    numeric(18, 2) check (supplier_cost is null or supplier_cost >= 0), -- custo do fornecedor
  min_floor_price  numeric(18, 2) not null check (min_floor_price > 0),    -- piso de segurança
  decremento       numeric(18, 2) not null default 0.01 check (decremento >= 0.01),
  intervalo_seg    int not null default 20 check (intervalo_seg between 0 and 600),
  bid_status       text not null default 'idle'
                   check (bid_status in ('idle', 'running', 'paused', 'stopped_at_floor')),
  nosso_lance      numeric(18, 2),
  melhor_lance     numeric(18, 2),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  -- TRAVAS no próprio banco: piso entre o custo e o teto.
  constraint robo_itens_piso_teto  check (min_floor_price <= max_price),
  constraint robo_itens_piso_custo check (supplier_cost is null or min_floor_price >= supplier_cost)
);
alter table public.robo_itens drop constraint if exists robo_itens_lance_piso;

-- TRAVA: todo lance NOVO gravado precisa estar entre o piso e o teto. (Subir o piso
-- depois de um lance dado é permitido: o lance antigo já foi enviado e não muda.)
create or replace function public.robo_conferir_lance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nosso_lance is not null
     and (tg_op = 'INSERT' or new.nosso_lance is distinct from old.nosso_lance)
     and (new.nosso_lance < new.min_floor_price or new.nosso_lance > new.max_price) then
    raise exception 'Lance de % bloqueado: fora do intervalo entre o piso (%) e o teto (%).',
      new.nosso_lance, new.min_floor_price, new.max_price
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists robo_conferir_lance on public.robo_itens;
create trigger robo_conferir_lance before insert or update on public.robo_itens
  for each row execute function public.robo_conferir_lance();
-- Portal onde o robô atua (o mesmo do filtro da tela).
alter table public.robo_itens add column if not exists plataforma text not null default 'comprasnet';
alter table public.robo_itens drop constraint if exists robo_itens_plataforma;
alter table public.robo_itens add constraint robo_itens_plataforma check (plataforma in (
  'comprasnet', 'pncp', 'licitacoes-e', 'bbmnet', 'bnc', 'pcp', 'bll', 'licitanet', 'licitar', 'licitamais',
  'comprasbr', 'petronect', 'outros'));
-- Sala de disputa: quantidade (lance pelo valor unitário), nosso porte para a LC 123,
-- fuga da faixa de 5% de ME/EPP (só até o piso) e a fase atual do pregão.
alter table public.robo_itens add column if not exists quantidade int not null default 1;
alter table public.robo_itens add column if not exists nosso_porte text not null default 'demais';
alter table public.robo_itens add column if not exists fugir_empate boolean not null default false;
alter table public.robo_itens add column if not exists fase text;
alter table public.robo_itens drop constraint if exists robo_itens_quantidade;
alter table public.robo_itens add constraint robo_itens_quantidade check (quantidade between 1 and 100000000);
alter table public.robo_itens drop constraint if exists robo_itens_nosso_porte;
alter table public.robo_itens add constraint robo_itens_nosso_porte check (nosso_porte in ('me', 'epp', 'demais'));
alter table public.robo_itens drop constraint if exists robo_itens_fase;
alter table public.robo_itens add constraint robo_itens_fase check (fase is null or fase in (
  'aberta', 'prorrogacao', 'desempate', 'negociacao', 'habilitacao', 'encerrada'));
create index if not exists robo_itens_organizacao_idx on public.robo_itens (organizacao_id);

alter table public.robo_itens enable row level security;
drop policy if exists robo_itens_membros on public.robo_itens;
create policy robo_itens_membros on public.robo_itens for all to authenticated
  using (public.eh_membro(organizacao_id))
  with check (public.eh_membro(organizacao_id));

drop trigger if exists tocar_atualizado_em on public.robo_itens;
create trigger tocar_atualizado_em before update on public.robo_itens
  for each row execute function public.tocar_atualizado_em();

grant select, insert, update, delete on public.robo_itens to authenticated, service_role;
revoke execute on function public.robo_conferir_lance() from public, anon, authenticated;
revoke all on public.robo_itens from anon;

notify pgrst, 'reload schema';

-- Conferência: deve mostrar "robo_itens".
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'robo_itens';
