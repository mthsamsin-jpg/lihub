-- =============================================================================
-- Uso LicitaHub · Fase 1 da automação: base de INTELIGÊNCIA DE MERCADO e
-- leitura AUTOMÁTICA de editais por IA.
-- Pode rodar mais de uma vez (idempotente). Não apaga nem altera dados existentes.
--
-- Fonte dos dados de mercado: resultados HOMOLOGADOS publicados no PNCP
--   /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens/{n}/resultados
-- O PNCP publica o VENCEDOR de cada item (CNPJ, porte, valor unitário homologado,
-- desconto). Perdedores e lances NÃO são públicos: esses só existem para as
-- disputas acompanhadas pelo Robô Turbo 2.0 (robo_historico / auction_live_bids).
-- =============================================================================

-- 1. Resultados homologados por item (dado público, igual para todos os clientes).
create table if not exists public.mercado_resultados (
  id                     bigint generated always as identity primary key,
  numero_controle_pncp   text not null,
  licitacao_id           bigint references public.licitacoes (id) on delete set null,
  orgao_cnpj             text,
  orgao_nome             text,
  uf                     text,
  municipio              text,
  modalidade_id          smallint,
  modalidade_nome        text,
  portal                 text,              -- sistema de origem (Compras.gov.br, BLL, BNC...)
  objeto                 text,
  item_numero            int not null,
  item_descricao         text,
  material_servico       text check (material_servico is null or material_servico in ('M', 'S')),
  unidade                text,
  quantidade             numeric(18, 4),
  valor_unit_estimado    numeric(18, 4),
  sequencial_resultado   int not null default 1,
  fornecedor_ni          text,              -- CNPJ (14) ou CPF (11), só dígitos
  fornecedor_nome        text,
  fornecedor_porte       text,              -- ME, EPP, Demais...
  quantidade_homologada  numeric(18, 4),
  valor_unit_homologado  numeric(18, 4),
  valor_total_homologado numeric(18, 2),
  desconto_pct           numeric(9, 3) generated always as (
    case when valor_unit_estimado > 0 and valor_unit_homologado > 0
         then round((1 - valor_unit_homologado / valor_unit_estimado) * 100, 3) end
  ) stored,
  data_resultado         date,
  coletado_em            timestamptz not null default now(),
  unique (numero_controle_pncp, item_numero, sequencial_resultado)
);
create index if not exists mercado_resultados_fornecedor_idx on public.mercado_resultados (fornecedor_ni);
create index if not exists mercado_resultados_uf_idx         on public.mercado_resultados (uf, data_resultado desc);
create index if not exists mercado_resultados_orgao_idx      on public.mercado_resultados (orgao_cnpj);
create index if not exists mercado_resultados_data_idx       on public.mercado_resultados (data_resultado desc);

alter table public.mercado_resultados enable row level security;
drop policy if exists mercado_resultados_leitura on public.mercado_resultados;
create policy mercado_resultados_leitura on public.mercado_resultados for select to authenticated using (true);
revoke insert, update, delete, truncate on public.mercado_resultados from anon, authenticated;
grant select on public.mercado_resultados to authenticated;

-- 2. Controle da coleta: quais compras já foram consultadas e quando tentar de novo.
create table if not exists public.mercado_coleta (
  numero_controle_pncp  text primary key,
  licitacao_id          bigint references public.licitacoes (id) on delete set null,
  situacao              text not null default 'pendente'
                          check (situacao in ('pendente', 'ok', 'sem_resultado', 'erro', 'desistiu')),
  itens                 int,
  resultados            int,
  tentativas            int not null default 0,
  erro                  text,
  proxima_em            timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists mercado_coleta_proxima_idx on public.mercado_coleta (situacao, proxima_em);
alter table public.mercado_coleta enable row level security;  -- sem políticas: só o servidor (service role)
revoke all on public.mercado_coleta from anon, authenticated;

-- 3. Leitura automática de editais por IA (liga/desliga por organização).
alter table public.organizacoes add column if not exists ia_automatica boolean not null default false;
grant update (ia_automatica) on public.organizacoes to authenticated;
-- quem pode mudar: dono/admin (a política de update de organizacoes já restringe).

-- Análise feita pelo robô de leitura automática (sem pessoa que pediu).
alter table public.analises_edital add column if not exists automatica boolean not null default false;

-- 4. Consultas de inteligência (rodam com a permissão de quem consulta).

-- 4.1 Concorrentes: por CNPJ (só dígitos, parcial) ou parte da razão social.
create or replace function public.mercado_concorrentes(p_busca text, p_limite int default 20)
returns table (
  fornecedor_ni     text,
  fornecedor_nome   text,
  fornecedor_porte  text,
  compras_vencidas  bigint,
  itens_vencidos    bigint,
  valor_total       numeric,
  desconto_medio    numeric,
  desconto_mediano  numeric,
  ufs               text[],
  orgaos            bigint,
  primeira          date,
  ultima            date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g') as digitos,
           lower(extensions.unaccent(btrim(coalesce(p_busca, '')))) as texto
  )
  select r.fornecedor_ni, max(r.fornecedor_nome), max(r.fornecedor_porte),
         count(distinct r.numero_controle_pncp), count(*),
         round(sum(r.valor_total_homologado), 2),
         round(avg(r.desconto_pct) filter (where r.desconto_pct between -50 and 100), 2),
         round((percentile_cont(0.5) within group (order by r.desconto_pct)
                filter (where r.desconto_pct between -50 and 100))::numeric, 2),
         array_agg(distinct r.uf) filter (where r.uf is not null),
         count(distinct r.orgao_cnpj),
         min(r.data_resultado), max(r.data_resultado)
  from public.mercado_resultados r cross join b
  where r.fornecedor_ni is not null
    and ((length(b.digitos) >= 8 and r.fornecedor_ni like b.digitos || '%')
         or (length(b.texto) >= 3 and lower(extensions.unaccent(coalesce(r.fornecedor_nome, ''))) like '%' || b.texto || '%'))
  group by r.fornecedor_ni
  order by count(*) desc
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;

drop function if exists public.mercado_concorrente_itens(text, int);
-- 4.2 Histórico de um concorrente (itens vencidos, mais recentes primeiro).
create or replace function public.mercado_concorrente_itens(p_ni text, p_limite int default 100)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.data_resultado desc nulls last, r.id desc), '[]'::jsonb)
  from (select * from public.mercado_resultados
        where fornecedor_ni = regexp_replace(coalesce(p_ni, ''), '[^0-9]', '', 'g')
        order by data_resultado desc nulls last, id desc
        limit least(greatest(coalesce(p_limite, 100), 1), 500)) r;
$$;

-- 4.3 Preços praticados para um item/segmento (mesmas regras de palavra da busca:
--     vírgula ou "or" = alternativas; cada palavra casa com o começo de uma palavra).
create or replace function public.mercado_precos(
  p_termo  text,
  p_ufs    text[] default null,
  p_unidade text  default null,
  p_desde  date   default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with grupos as (
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  base as (
    select r.*
    from public.mercado_resultados r
    where exists (select 1 from grupos)
      and r.valor_unit_homologado > 0
      and (p_ufs is null or cardinality(p_ufs) = 0 or r.uf = any (p_ufs))
      and (p_unidade is null or p_unidade = '' or lower(extensions.unaccent(coalesce(r.unidade, ''))) like lower(extensions.unaccent(p_unidade)) || '%')
      and (p_desde is null or r.data_resultado >= p_desde)
      and exists (select 1 from grupos g
                  where (select bool_and(lower(extensions.unaccent(coalesce(r.item_descricao, ''))) ~ p) from unnest(g.padroes) as p))
  ),
  fornecedores as (
    select fornecedor_ni, max(fornecedor_nome) as nome, count(*) as itens,
           round(avg(valor_unit_homologado), 2) as preco_medio
    from base where fornecedor_ni is not null
    group by fornecedor_ni order by count(*) desc limit 10
  )
  select jsonb_build_object(
    'amostras',          (select count(*) from base),
    'preco_min',         (select min(valor_unit_homologado) from base),
    'preco_p25',         (select percentile_cont(0.25) within group (order by valor_unit_homologado) from base),
    'preco_mediano',     (select percentile_cont(0.5)  within group (order by valor_unit_homologado) from base),
    'preco_p75',         (select percentile_cont(0.75) within group (order by valor_unit_homologado) from base),
    'preco_max',         (select max(valor_unit_homologado) from base),
    'desconto_medio',    (select round(avg(desconto_pct), 2) from base where desconto_pct between -50 and 100),
    'desconto_mediano',  (select round((percentile_cont(0.5) within group (order by desconto_pct))::numeric, 2) from base where desconto_pct between -50 and 100),
    'unidades',          (select jsonb_agg(u) from (select unidade as u from base where unidade is not null group by unidade order by count(*) desc limit 5) x),
    'fornecedores',      (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fornecedores f),
    'recentes',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
                            select item_descricao, unidade, quantidade_homologada, valor_unit_estimado, valor_unit_homologado,
                                   desconto_pct, fornecedor_nome, fornecedor_ni, uf, municipio, orgao_nome, data_resultado, numero_controle_pncp
                            from base order by data_resultado desc nulls last limit 30) x)
  );
$$;

revoke execute on function public.mercado_concorrentes(text, int) from public, anon;
revoke execute on function public.mercado_concorrente_itens(text, int) from public, anon;
revoke execute on function public.mercado_precos(text, text[], text, date) from public, anon;
grant execute on function public.mercado_concorrentes(text, int) to authenticated, service_role;
grant execute on function public.mercado_concorrente_itens(text, int) to authenticated, service_role;
grant execute on function public.mercado_precos(text, text[], text, date) to authenticated, service_role;
