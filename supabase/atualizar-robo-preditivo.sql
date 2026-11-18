-- =============================================================================
-- Uso LicitaHub · Robô Turbo 2.0: camada preditiva
--   robo_historico      fechamentos de disputas (base do deságio para a estimativa)
--   robo_concorrentes   perfil acumulado de cada concorrente (velocidade e agressividade)
--   robo_alertas        webhook da organização para os alertas preditivos
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
-- (O schema.sql completo já inclui isto.)
-- =============================================================================

-- Fechamentos: uma linha por item disputado (real) ou homologação importada.
create table if not exists public.robo_historico (
  id               bigint generated always as identity primary key,
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  robo_item_id     uuid references public.robo_itens (id) on delete set null,
  origem           text not null default 'disputa' check (origem in ('disputa', 'homologacao')),
  portal           text check (portal is null or char_length(portal) <= 40),
  descricao        text not null check (char_length(btrim(descricao)) between 1 and 300),
  teto             numeric(18, 2) not null check (teto > 0),
  preco_fechamento numeric(18, 2) not null check (preco_fechamento > 0),
  desagio_pct      numeric(7, 3) generated always as (round((1 - preco_fechamento / teto) * 100, 3)) stored,
  vencemos         boolean,
  lances           int check (lances is null or lances >= 0),
  encerrado_em     timestamptz not null default now()
);
create index if not exists robo_historico_org_idx on public.robo_historico (organizacao_id, encerrado_em desc);
alter table public.robo_historico enable row level security;
drop policy if exists robo_historico_membros_leem on public.robo_historico;
create policy robo_historico_membros_leem on public.robo_historico for select to authenticated
  using (public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.robo_historico from anon, authenticated;

-- Perfil acumulado por concorrente (o identificador é o CNPJ quando o portal mostra;
-- senão o apelido da sala, que só vale dentro daquele pregão).
create table if not exists public.robo_concorrentes (
  id                   bigint generated always as identity primary key,
  organizacao_id       uuid not null references public.organizacoes (id) on delete cascade,
  portal               text not null check (char_length(portal) <= 40),
  identificador        text not null check (char_length(identificador) between 1 and 200),
  cnpj                 text check (cnpj is null or cnpj ~ '^\d{14}$'),
  disputas             int not null default 0 check (disputas >= 0),
  lances               int not null default 0 check (lances >= 0),
  resposta_mediana_ms  int check (resposta_mediana_ms is null or resposta_mediana_ms >= 0),
  agressividade_pct    numeric(7, 3),
  perfil               text check (perfil is null or perfil in ('agressivo', 'moderado', 'passivo')),
  atualizado_em        timestamptz not null default now(),
  unique (organizacao_id, portal, identificador)
);
alter table public.robo_concorrentes enable row level security;
drop policy if exists robo_concorrentes_membros_leem on public.robo_concorrentes;
create policy robo_concorrentes_membros_leem on public.robo_concorrentes for select to authenticated
  using (public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.robo_concorrentes from anon, authenticated;

-- Webhook dos alertas (Slack, Discord, Teams, n8n, Zapier...). Só o servidor lê:
-- a URL funciona como senha de quem a recebe.
create table if not exists public.robo_alertas (
  organizacao_id  uuid primary key references public.organizacoes (id) on delete cascade,
  webhook_url     text check (webhook_url is null or (webhook_url ~ '^https://' and char_length(webhook_url) <= 500)),
  atualizado_em   timestamptz not null default now()
);
alter table public.robo_alertas enable row level security;
revoke all on public.robo_alertas from anon, authenticated;

notify pgrst, 'reload schema';

select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('robo_historico', 'robo_concorrentes', 'robo_alertas')
order by 1;
