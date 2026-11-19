-- =============================================================================
-- Uso LicitaHub · Fase 3: inteligência de mercado ampliada.
-- Pode rodar mais de uma vez. Não apaga nem altera dados existentes.
--
--   1. Coleta RETROATIVA direcionada (12 meses): compras encerradas encontradas
--      pela busca do PNCP para as palavras dos radares dos clientes entram na fila
--      da coleta (mercado_coleta) mesmo sem estar no catálogo (que guarda 90 dias).
--   2. Pesquisa de Preço com a base real (mercado_pesquisa).
--   3. Painel do concorrente: evolução mês a mês e onde ele mais vence.
--   4. Trava de espaço: o servidor consulta o tamanho do banco antes de crescer.
--
-- Atas e contratos do PNCP foram avaliados e NÃO são gravados em massa:
-- ~9 mil contratos/dia (3,3 milhões/ano) não cabem no plano gratuito, e o preço por
-- item de uma ata é o próprio resultado homologado da compra, que já é coletado.
-- =============================================================================

-- 1. Fila da coleta guarda os dados mínimos da compra (para as retroativas, que não
--    estão em public.licitacoes).
alter table public.mercado_coleta add column if not exists origem            text not null default 'catalogo';
alter table public.mercado_coleta add column if not exists orgao_cnpj        text;
alter table public.mercado_coleta add column if not exists ano_compra        int;
alter table public.mercado_coleta add column if not exists sequencial_compra int;
alter table public.mercado_coleta add column if not exists orgao_nome        text;
alter table public.mercado_coleta add column if not exists uf                text;
alter table public.mercado_coleta add column if not exists municipio         text;
alter table public.mercado_coleta add column if not exists modalidade_nome   text;
alter table public.mercado_coleta add column if not exists portal            text;
alter table public.mercado_coleta add column if not exists objeto            text;
alter table public.mercado_coleta add column if not exists encerrada_em      timestamptz;
alter table public.mercado_coleta drop constraint if exists mercado_coleta_origem_ck;
alter table public.mercado_coleta add constraint mercado_coleta_origem_ck check (origem in ('catalogo', 'retro'));
create index if not exists mercado_coleta_retro_idx on public.mercado_coleta (origem, situacao, proxima_em);

-- Termos da coleta retroativa e até onde cada um já foi lido.
create table if not exists public.mercado_retro_termos (
  termo          text primary key,
  pagina         int not null default 0,          -- última página da busca já lida
  compras        int not null default 0,          -- compras enfileiradas por este termo
  concluido_em   timestamptz,                     -- leu tudo da janela; recomeça depois de 30 dias
  atualizado_em  timestamptz not null default now()
);
alter table public.mercado_retro_termos enable row level security;  -- só o servidor
revoke all on public.mercado_retro_termos from anon, authenticated;

create index if not exists mercado_resultados_fornecedor_data_idx on public.mercado_resultados (fornecedor_ni, data_resultado);

-- 2. Pesquisa de Preço: registros de um item (mesmas regras de palavra da busca).
create or replace function public.mercado_pesquisa(
  p_termo     text,
  p_ufs       text[] default null,
  p_municipio text   default null,
  p_meses     int    default 12,
  p_limite    int    default 300
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
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc), '[]'::jsonb)
  from (
    select r.data_resultado as data, r.orgao_nome as orgao, r.uf, r.municipio,
           r.quantidade_homologada as quantidade, r.valor_unit_homologado as unitario,
           r.valor_unit_estimado as estimado, r.unidade, r.item_descricao as item,
           r.fornecedor_nome as fornecedor, r.fornecedor_ni, r.portal, r.numero_controle_pncp
    from public.mercado_resultados r
    where exists (select 1 from grupos)
      and r.valor_unit_homologado > 0
      and r.data_resultado >= (current_date - make_interval(months => least(greatest(coalesce(p_meses, 12), 1), 36)))
      and (p_ufs is null or cardinality(p_ufs) = 0 or r.uf = any (p_ufs))
      and (p_municipio is null or p_municipio = ''
           or lower(extensions.unaccent(coalesce(r.municipio, ''))) = lower(extensions.unaccent(p_municipio)))
      and exists (select 1 from grupos g
                  where (select bool_and(lower(extensions.unaccent(coalesce(r.item_descricao, ''))) ~ p) from unnest(g.padroes) as p))
    order by r.data_resultado desc nulls last
    limit least(greatest(coalesce(p_limite, 300), 1), 1000)
  ) x;
$$;

-- 3. Painel do concorrente: evolução mensal, órgãos e estados onde mais vence.
create or replace function public.mercado_concorrente_painel(p_ni text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select * from public.mercado_resultados
    where fornecedor_ni = regexp_replace(coalesce(p_ni, ''), '[^0-9]', '', 'g')
      and data_resultado >= current_date - interval '24 months'
  )
  select jsonb_build_object(
    'mensal', (select coalesce(jsonb_agg(to_jsonb(m) order by m.mes), '[]'::jsonb) from (
        select to_char(date_trunc('month', data_resultado), 'YYYY-MM') as mes,
               count(*) as itens, count(distinct numero_controle_pncp) as compras,
               round(sum(valor_total_homologado), 2) as valor,
               round((percentile_cont(0.5) within group (order by desconto_pct)
                      filter (where desconto_pct between -50 and 100))::numeric, 2) as desconto_mediano
        from r where data_resultado is not null group by 1) m),
    'orgaos', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from (
        select orgao_cnpj, max(orgao_nome) as orgao, max(uf) as uf, count(*) as itens,
               count(distinct numero_controle_pncp) as compras, round(sum(valor_total_homologado), 2) as valor
        from r group by orgao_cnpj order by count(distinct numero_controle_pncp) desc, sum(valor_total_homologado) desc nulls last limit 10) o),
    'ufs', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from (
        select uf, count(*) as itens, round(sum(valor_total_homologado), 2) as valor
        from r where uf is not null group by uf order by count(*) desc limit 27) u),
    'portais', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (
        select coalesce(portal, 'Não informado') as portal, count(*) as itens
        from r group by 1 order by count(*) desc limit 8) p)
  );
$$;

revoke execute on function public.mercado_pesquisa(text, text[], text, int, int) from public, anon;
revoke execute on function public.mercado_concorrente_painel(text) from public, anon;
grant execute on function public.mercado_pesquisa(text, text[], text, int, int) to authenticated, service_role;
grant execute on function public.mercado_concorrente_painel(text) to authenticated, service_role;

-- 4. Tamanho do banco em MB (trava de espaço da coleta retroativa). Só o servidor.
create or replace function public.banco_tamanho_mb()
returns int
language sql
stable
security definer
set search_path = ''
as $$ select (pg_database_size(current_database()) / 1048576)::int; $$;
revoke execute on function public.banco_tamanho_mb() from public, anon, authenticated;
grant execute on function public.banco_tamanho_mb() to service_role;
