-- 6.2 Busca de licitações: filtros, total para paginação e busca RIGOROSA por palavra.
--   supabase.rpc('buscar_licitacoes', { p_termo: 'copo, papel A4', p_ufs: ['SP'],
--     p_municipios: ['Campinas'], p_tipo: 'material', p_limite: 20, p_offset: 0 })
-- Palavra-chave (p_termo):
--   - vírgula separa alternativas ("copo, papel A4" = copo OU papel A4);
--   - dentro de cada alternativa, TODAS as palavras precisam aparecer;
--   - cada palavra casa com o começo de uma palavra do texto, sem acento nem
--     maiúscula ("copo" acha "copos", mas não "copa"; "a4" acha "A4");
--   - o texto conferido é o objeto da licitação e a descrição dos itens já baixados.
-- Tipo (p_tipo): 'material' tira o que é claramente serviço; 'servico' tira o que é
--   claramente compra de material. A classificação vem do texto do objeto (o PNCP
--   não informa a natureza da compra inteira, só a de cada item).
-- Plataforma: p_plataformas = padrões ilike do sistema de origem; p_plataforma_outros
--   inclui também as que não casam com nenhum padrão de p_plataformas_conhecidas.
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int);
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[]);

create or replace function public.tipo_objeto(p_objeto text)
returns text
language sql
stable
set search_path = ''
as $$
  with t as (select lower(extensions.unaccent(coalesce(p_objeto, ''))) as x)
  select case
    when (x ~ '\m(prestacao de servico|servicos? (de|continuad|comum|tecnic|especializad|terceirizad|grafic|medic|odontolog|laborator)|contratacao de (empresa )?(especializada )?(para )?(a )?(prestacao|execucao|realizacao|manutencao|locacao|organizacao)|manutencao|locacao|obras?\M|reforma|construcao|pavimentacao|consultoria|assessoria|vigilancia|limpeza e conservacao|transporte escolar|coleta de residuos|recapeamento|engenharia)')
         and not (x ~ '\m(aquisic|fornecimento de (materia|produto|equipament|genero|insumo|medicament)|compra de)')
      then 'servico'
    when x ~ '\m(aquisic|fornecimento|compra de|materia(l|is)|produtos?|equipamentos?|generos? alimenticios|medicamentos?|insumos?|mobiliario|veiculos?)'
         and not (x ~ '\m(prestacao de servico|contratacao de (empresa )?(especializada )?(para )?(a )?(prestacao|execucao))')
      then 'material'
    else 'misto'
  end from t;
$$;

drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]);
create or replace function public.buscar_licitacoes(
  p_termo                  text        default null,
  p_ufs                    text[]      default null,
  p_modalidades            int[]       default null,
  p_valor_min              numeric     default null,
  p_valor_max              numeric     default null,
  p_encerramento_ate       timestamptz default null,
  p_somente_abertas        boolean     default true,
  p_ordem                  text        default 'relevancia',  -- relevancia | prazo | valor | recentes
  p_limite                 int         default 20,
  p_offset                 int         default 0,
  p_municipios             text[]      default null,
  p_tipo                   text        default null,          -- null | material | servico
  p_encerramento_de        timestamptz default null,
  p_orgao                  text        default null,
  p_plataformas            text[]      default null,
  p_plataforma_outros      boolean     default false,
  p_plataformas_conhecidas text[]      default null
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
  tipo                        text,
  total                       bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with grupos as (
    -- cada alternativa (entre vírgulas) vira uma lista de padrões de palavra
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  consulta as (
    select (select count(*) from grupos) as n_grupos,
           case when nullif(btrim(coalesce(p_termo, '')), '') is null then null::tsquery
                else websearch_to_tsquery('public.portugues_sem_acento', regexp_replace(p_termo, '[[:space:]]*,[[:space:]]*', ' or ', 'g')) end as q
  ),
  base as (
    select l.*, lower(extensions.unaccent(
             coalesce(l.objeto, '') || ' ' ||
             coalesce((select string_agg(i.descricao, ' ') from public.licitacao_itens i where i.licitacao_id = l.id), '')
           )) as texto
    from public.licitacoes l
    where (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or lower(extensions.unaccent(coalesce(l.municipio, ''))) = any (
                select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
      and (p_valor_min is null or l.valor_estimado >= p_valor_min)
      and (p_valor_max is null or l.valor_estimado <= p_valor_max)
      and (not coalesce(p_somente_abertas, true) or l.data_encerramento_proposta >= now())
      and (p_encerramento_ate is null or l.data_encerramento_proposta <= p_encerramento_ate)
      and (p_encerramento_de is null or l.data_encerramento_proposta >= p_encerramento_de)
      and (nullif(btrim(coalesce(p_orgao, '')), '') is null
           or lower(extensions.unaccent(coalesce(l.orgao_razao_social, '') || ' ' || coalesce(l.unidade_nome, '')))
              like '%' || lower(extensions.unaccent(btrim(p_orgao))) || '%')
      and (((p_plataformas is null or cardinality(p_plataformas) = 0) and not coalesce(p_plataforma_outros, false))
           or l.sistema_origem ilike any (coalesce(p_plataformas, '{}'))
           or (coalesce(p_plataforma_outros, false)
               and (l.sistema_origem is null or not (l.sistema_origem ilike any (coalesce(p_plataformas_conhecidas, '{}'))))))
  ),
  filtrada as (
    select b.*, public.tipo_objeto(b.objeto) as tipo_calc
    from base b cross join consulta c
    where c.n_grupos = 0
       or exists (select 1 from grupos g where (select bool_and(b.texto ~ p) from unnest(g.padroes) as p))
  )
  select f.id, f.fonte, f.numero_controle_pncp, f.objeto, f.orgao_razao_social,
         f.uf, f.municipio, f.modalidade_id, f.modalidade_nome, f.situacao_nome,
         f.valor_estimado, f.srp, f.data_publicacao, f.data_abertura_proposta,
         f.data_encerramento_proposta, f.sistema_origem, f.link_sistema_origem, f.link_pncp,
         (case when c.q is null then 0 else ts_rank(f.busca, c.q) end)::real as relevancia,
         f.tipo_calc as tipo,
         count(*) over () as total
  from filtrada f cross join consulta c
  where p_tipo is null or p_tipo = ''
     or (p_tipo = 'material' and f.tipo_calc <> 'servico')
     or (p_tipo = 'servico'  and f.tipo_calc <> 'material')
  order by
    case when p_ordem = 'prazo'    then f.data_encerramento_proposta end asc  nulls last,
    case when p_ordem = 'valor'    then f.valor_estimado             end desc nulls last,
    case when p_ordem = 'recentes' then f.data_publicacao            end desc nulls last,
    relevancia desc,
    f.data_encerramento_proposta asc nulls last,
    f.id
  limit least(greatest(coalesce(p_limite, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


-- 6.2b Radar: contagem por município com as mesmas regras de palavra.
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
  -- Mesmas regras de palavra da buscar_licitacoes: "a or b" / "a, b" = alternativas;
  -- cada palavra casa com o começo de uma palavra do objeto ou dos itens (sem radical).
  with grupos as (
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  base as (
    select l.uf, l.municipio, lower(extensions.unaccent(
             coalesce(l.objeto, '') || ' ' ||
             coalesce((select string_agg(i.descricao, ' ') from public.licitacao_itens i where i.licitacao_id = l.id), '')
           )) as texto
    from public.licitacoes l
    where l.municipio is not null
      and l.data_encerramento_proposta >= now()
      and (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or lower(extensions.unaccent(l.municipio)) = any (
                select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
      and (p_abertura_de is null or l.data_abertura_proposta >= p_abertura_de::timestamptz)
      and (p_abertura_ate is null or l.data_abertura_proposta < (p_abertura_ate + 1)::timestamptz)
  )
  select b.uf, b.municipio, count(*) as total
  from base b
  where not exists (select 1 from grupos)
     or exists (select 1 from grupos g where (select bool_and(b.texto ~ p) from unnest(g.padroes) as p))
  group by b.uf, b.municipio
  order by total desc
  limit 5000;
$$;

revoke execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) from public, anon;
grant execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) to authenticated, service_role;
grant execute on function public.tipo_objeto(text) to authenticated, service_role;
grant execute on function public.radar_contagem(text, text[], text[], int[], date, date) to authenticated, service_role;
