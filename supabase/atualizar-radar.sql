-- ATENÇÃO: depois deste arquivo, rode supabase/atualizar-busca.sql (a busca atual, com tipo e palavras rigorosas).
-- =============================================================================
-- LicitaHub · atualização do Radar (novembro/2026)
-- Só as mudanças do Radar com mapa, para quem já rodou o schema.sql antigo.
-- Rode no SQL Editor do projeto do LicitaHub (lstyjthunravkwdszbwi).
-- Pode rodar mais de uma vez: não apaga dados.
-- O mesmo conteúdo está no schema.sql; este arquivo é só um atalho.
-- =============================================================================

-- 1. Radares: coluna de municípios e limites
-- Busca regional (nov/2026): municípios escolhidos no mapa e até 20 termos por radar.
alter table public.radares add column if not exists municipios text[] not null default '{}';
alter table public.radares drop constraint if exists radares_limites;
alter table public.radares add constraint radares_limites
  check (cardinality(palavras) <= 20 and cardinality(ufs) <= 27 and cardinality(municipios) <= 2000);

-- 2. Busca com filtro de municípios e 3. contagem por município (mapa)
-- 6.2 Busca de licitações com relevância, filtros e total para paginação.
--   supabase.rpc('buscar_licitacoes', { p_termo: 'manutenção ar condicionado',
--     p_ufs: ['SP','RJ'], p_modalidades: [6], p_limite: 20, p_offset: 0,
--     p_municipios: ['Ananindeua'] })   -- municípios: sem diferença de acento ou maiúscula
-- A versão antiga (sem p_municipios) é apagada para não ficarem duas funções com o mesmo nome.
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int);
create or replace function public.buscar_licitacoes(
  p_termo             text        default null,
  p_ufs               text[]      default null,
  p_modalidades       int[]       default null,
  p_valor_min         numeric     default null,
  p_valor_max         numeric     default null,
  p_encerramento_ate  timestamptz default null,
  p_somente_abertas   boolean     default true,
  p_ordem             text        default 'relevancia',  -- relevancia | prazo | valor | recentes
  p_limite            int         default 20,
  p_offset            int         default 0,
  p_municipios        text[]      default null
)
returns table (
  id                          bigint,
  fonte                       text,
  numero_controle_pncp        text,
  objeto                      text,
  orgao_razao_social          text,
  uf                          text,
  municipio                   text,
  modalidade_id               smallint,
  modalidade_nome             text,
  situacao_nome               text,
  valor_estimado              numeric,
  srp                         boolean,
  data_publicacao             timestamptz,
  data_abertura_proposta      timestamptz,
  data_encerramento_proposta  timestamptz,
  sistema_origem              text,
  link_sistema_origem         text,
  link_pncp                   text,
  relevancia                  real,
  total                       bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with consulta as (
    select case
             when nullif(btrim(coalesce(p_termo, '')), '') is null then null::tsquery
             else websearch_to_tsquery('public.portugues_sem_acento', p_termo)
           end as q
  )
  select l.id, l.fonte, l.numero_controle_pncp, l.objeto, l.orgao_razao_social,
         l.uf, l.municipio, l.modalidade_id, l.modalidade_nome, l.situacao_nome,
         l.valor_estimado, l.srp, l.data_publicacao, l.data_abertura_proposta,
         l.data_encerramento_proposta, l.sistema_origem, l.link_sistema_origem, l.link_pncp,
         (case when c.q is null then 0 else ts_rank(l.busca, c.q) end)::real as relevancia,
         count(*) over () as total
  from public.licitacoes l
  cross join consulta c
  where (c.q is null or l.busca @@ c.q)
    and (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
    and (p_municipios is null or cardinality(p_municipios) = 0
         or lower(extensions.unaccent(coalesce(l.municipio, ''))) = any (
              select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
    and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
    and (p_valor_min is null or l.valor_estimado >= p_valor_min)
    and (p_valor_max is null or l.valor_estimado <= p_valor_max)
    and (not coalesce(p_somente_abertas, true) or l.data_encerramento_proposta >= now())
    and (p_encerramento_ate is null or l.data_encerramento_proposta <= p_encerramento_ate)
  order by
    case when p_ordem = 'prazo'    then l.data_encerramento_proposta end asc  nulls last,
    case when p_ordem = 'valor'    then l.valor_estimado             end desc nulls last,
    case when p_ordem = 'recentes' then l.data_publicacao            end desc nulls last,
    relevancia desc,
    l.data_encerramento_proposta asc nulls last,
    l.id
  limit least(greatest(coalesce(p_limite, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- 6.2b Radar: quantas licitações abertas há em cada município (para o mapa).
--   Mesmos filtros da busca, mais a data de abertura das propostas.
--   supabase.rpc('radar_contagem', { p_termo: 'cadeira or computador', p_ufs: ['SC'],
--     p_municipios: ['Braço do Trombudo', 'Rio do Sul'], p_abertura_de: '2026-11-01' })
create or replace function public.radar_contagem(
  p_termo        text   default null,
  p_ufs          text[] default null,
  p_municipios   text[] default null,
  p_modalidades  int[]  default null,
  p_abertura_de  date   default null,
  p_abertura_ate date   default null
)
returns table (uf text, municipio text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with consulta as (
    select case
             when nullif(btrim(coalesce(p_termo, '')), '') is null then null::tsquery
             else websearch_to_tsquery('public.portugues_sem_acento', p_termo)
           end as q
  )
  select l.uf, l.municipio, count(*) as total
  from public.licitacoes l
  cross join consulta c
  where (c.q is null or l.busca @@ c.q)
    and l.municipio is not null
    and l.data_encerramento_proposta >= now()
    and (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
    and (p_municipios is null or cardinality(p_municipios) = 0
         or lower(extensions.unaccent(l.municipio)) = any (
              select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
    and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
    and (p_abertura_de is null or l.data_abertura_proposta >= p_abertura_de::timestamptz)
    and (p_abertura_ate is null or l.data_abertura_proposta < (p_abertura_ate + 1)::timestamptz)
  group by l.uf, l.municipio
  order by total desc
  limit 5000;
$$;


-- 4. Permissões
revoke execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[]) from public, anon;
revoke execute on function public.radar_contagem(text, text[], text[], int[], date, date) from public, anon;
grant execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[]) to authenticated, service_role;
grant execute on function public.radar_contagem(text, text[], text[], int[], date, date) to authenticated, service_role;

-- 5. Avisa a API do Supabase para enxergar as funções novas na hora
notify pgrst, 'reload schema';

-- Conferência: deve mostrar 2 linhas (buscar_licitacoes e radar_contagem) e a coluna municipios
select p.proname as funcao, pg_get_function_identity_arguments(p.oid) as parametros
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('buscar_licitacoes', 'radar_contagem');
