-- =============================================================================
-- Uso LicitaHub · Busca em CAMADAS (pirâmide de relevância) + desempenho.
-- Pode rodar mais de uma vez. Não apaga dados.
--
-- Com termo, a busca não esconde mais nada: ordena em 4 camadas.
--   1 Exata ........ a frase inteira OU todas as palavras no OBJETO
--   2 Principal .... o termo principal (1ª palavra) no objeto, ou todas as palavras só
--                    nos campos secundários (itens, órgão)
--   3 Relacionada .. só as palavras secundárias, ou um termo relacionado (busca_correlatos)
--   4 Restante ..... todas as outras, com os mesmos filtros
-- Dentro da camada: nota (peso do campo: objeto > itens > órgão) e depois a ordem escolhida.
-- Comparação sem acento/maiúscula, pelo começo da palavra, com radical leve
-- (plural/singular): "copos descartáveis" ~ "copo descartável"; "copo" NÃO casa "copa".
-- Sem termo: igual a antes (sem camadas).
--
-- Desempenho: a ordenação roda na tabela enxuta licitacoes_busca (texto já normalizado e tipo
-- material/serviço já calculado); só as linhas da página são lidas na licitacoes larga
-- (antes: 6 a 18 s por busca no plano gratuito, por ler 27 mil linhas largas do disco).
-- =============================================================================

-- 1. Tabela ENXUTA de busca (~300 bytes por linha, contra ~2,8 KB da licitacoes):
--    a ordenação em camadas lê só ela; a linha completa é lida só para a página pedida.
--    Mantida por gatilho; mesma regra de acesso (RLS) da licitacoes.
-- (uma versão anterior desta migração pôs colunas na própria licitacoes: são retiradas)
drop trigger if exists licitacoes_normalizar on public.licitacoes;
drop function if exists public.licitacoes_normalizar();
alter table public.licitacoes drop column if exists objeto_norm;
alter table public.licitacoes drop column if exists orgao_norm;
alter table public.licitacoes drop column if exists tipo_calc;

create table if not exists public.licitacoes_busca (
  id              bigint primary key references public.licitacoes (id) on delete cascade,
  organizacao_id  uuid,
  encerramento    timestamptz,
  publicacao      timestamptz,
  uf              text,
  municipio_norm  text,
  modalidade_id   smallint,
  valor           numeric(18, 2),
  sistema_origem  text,
  tipo_calc       text,
  objeto_norm     text,
  orgao_norm      text
);
create index if not exists licitacoes_busca_encerramento_idx on public.licitacoes_busca (encerramento);
alter table public.licitacoes_busca enable row level security;
drop policy if exists licitacoes_busca_ver on public.licitacoes_busca;
create policy licitacoes_busca_ver on public.licitacoes_busca for select to authenticated
  using (organizacao_id is null or public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.licitacoes_busca from anon, authenticated;
grant select on public.licitacoes_busca to authenticated, service_role;

create or replace function public.licitacoes_busca_sincronizar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.licitacoes_busca as b (id, organizacao_id, encerramento, publicacao, uf, municipio_norm, modalidade_id, valor,
                                            sistema_origem, tipo_calc, objeto_norm, orgao_norm)
  values (new.id, new.organizacao_id, new.data_encerramento_proposta, new.data_publicacao, new.uf,
          lower(extensions.unaccent(coalesce(new.municipio, ''))), new.modalidade_id, new.valor_estimado, new.sistema_origem,
          public.tipo_objeto(new.objeto), lower(extensions.unaccent(coalesce(new.objeto, ''))),
          lower(extensions.unaccent(coalesce(new.orgao_razao_social, '') || ' ' || coalesce(new.unidade_nome, ''))))
  on conflict (id) do update set
    organizacao_id = excluded.organizacao_id, encerramento = excluded.encerramento, publicacao = excluded.publicacao,
    uf = excluded.uf, municipio_norm = excluded.municipio_norm, modalidade_id = excluded.modalidade_id, valor = excluded.valor,
    sistema_origem = excluded.sistema_origem, tipo_calc = excluded.tipo_calc, objeto_norm = excluded.objeto_norm,
    orgao_norm = excluded.orgao_norm;
  return null;
end $$;
revoke execute on function public.licitacoes_busca_sincronizar() from public, anon, authenticated;
drop trigger if exists licitacoes_busca_sincronizar on public.licitacoes;
create trigger licitacoes_busca_sincronizar after insert or update on public.licitacoes
  for each row execute function public.licitacoes_busca_sincronizar();

-- preenche o que já existe
insert into public.licitacoes_busca (id, organizacao_id, encerramento, publicacao, uf, municipio_norm, modalidade_id, valor,
                                     sistema_origem, tipo_calc, objeto_norm, orgao_norm)
select l.id, l.organizacao_id, l.data_encerramento_proposta, l.data_publicacao, l.uf,
       lower(extensions.unaccent(coalesce(l.municipio, ''))), l.modalidade_id, l.valor_estimado, l.sistema_origem,
       public.tipo_objeto(l.objeto), lower(extensions.unaccent(coalesce(l.objeto, ''))),
       lower(extensions.unaccent(coalesce(l.orgao_razao_social, '') || ' ' || coalesce(l.unidade_nome, '')))
from public.licitacoes l
on conflict (id) do nothing;

-- 2. Radical leve (plural/singular), aplicado à palavra BUSCADA; o texto casa pelo começo.
create or replace function public.radical_busca(p text)
returns text language sql immutable set search_path = '' as $$
  select case when length(r) >= 3 then r else p end
  from (select case
    when p ~ 'veis$'                       then regexp_replace(p, 'veis$', 've')
    when p ~ 'vel$'                        then regexp_replace(p, 'vel$', 've')
    when length(p) > 4 and p ~ '(oes|aes|aos)$' then left(p, length(p) - 3)
    when length(p) > 4 and p ~ 'ao$'       then left(p, length(p) - 2)
    when length(p) > 4 and p ~ '[ae]is$'   then left(p, length(p) - 2)
    when length(p) > 4 and p ~ '[ae]l$'    then left(p, length(p) - 1)
    when length(p) > 4 and p ~ '(r|z)es$'  then left(p, length(p) - 2)
    when length(p) > 3 and p ~ 's$'        then left(p, length(p) - 1)
    else p end as r) x;
$$;

-- 3. Termos relacionados (camada 3). Editável: insira/atualize linhas aqui, sem mudar código.
--    termo e correlatos sem acento e em minúsculas.
create table if not exists public.busca_correlatos (
  termo       text primary key check (termo = lower(termo)),
  correlatos  text[] not null default '{}'
);
alter table public.busca_correlatos enable row level security;
drop policy if exists busca_correlatos_leitura on public.busca_correlatos;
create policy busca_correlatos_leitura on public.busca_correlatos for select to authenticated using (true);
revoke insert, update, delete, truncate on public.busca_correlatos from anon, authenticated;
grant select on public.busca_correlatos to authenticated;
insert into public.busca_correlatos (termo, correlatos) values
  ('copo',        array['caneca', 'taca', 'xicara']),
  ('papel',       array['sulfite', 'resma']),
  ('computador',  array['notebook', 'desktop', 'microcomputador', 'estacao de trabalho']),
  ('caneta',      array['esferografica', 'marca texto']),
  ('limpeza',     array['higienizacao', 'conservacao', 'zeladoria']),
  ('combustivel', array['gasolina', 'diesel', 'etanol']),
  ('medicamento', array['farmaco', 'remedio']),
  ('pneu',        array['camara de ar']),
  ('toner',       array['cartucho', 'tinta para impressora'])
on conflict (termo) do nothing;

-- 4. Busca com camadas (mesmas entradas de antes; devolve também camada, nota e total da camada).
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
  total                       bigint,
  camada                      smallint,
  total_camada                bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with palavras as (
    -- alternativa n (entre vírgulas / "or"), posição k da palavra, radical
    select g.n, w.k, public.radical_busca(w.p) as r
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(btrim(g.txt), '[^a-z0-9]+') with ordinality as w(p, k)
    where w.p <> ''
      -- palavras vazias não ordenam nada (e "de" casaria com quase tudo)
      and w.p not in ('de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com',
                      'a', 'o', 'as', 'os', 'um', 'uma', 'ao', 'aos', 'sem', 'sob', 'tipo')
  ),
  grupos as (
    select p.n,
           array_agg('\m' || p.r order by p.k) as padroes,                                        -- todas as palavras
           '\m' || string_agg(p.r, '[a-z0-9]*[^a-z0-9]+' order by p.k) as frase,                 -- frase em sequência
           (array_agg('\m' || p.r order by p.k))[1] as nucleo,                                    -- termo principal
           coalesce((array_agg('\m' || p.r order by p.k))[2:], '{}') as secundarias,
           coalesce((select array_agg('\m' || public.radical_busca(c2))
                     from public.busca_correlatos bc, unnest(bc.correlatos) as c2
                     where bc.termo = any (array_agg(p.r)) or public.radical_busca(bc.termo) = any (array_agg(p.r))), '{}') as correlatos
    from palavras p group by p.n
  ),
  qualquer as (
    select coalesce('(' || string_agg(distinct x, '|') || ')', '$^') as re
    from (select unnest(g.padroes || g.correlatos) as x from grupos g) y
  ),
  consulta as (
    select (select count(*) from grupos) as n_grupos
  ),
  base as (
    select l.id, l.encerramento, l.publicacao, l.valor, l.objeto_norm as obj,
           l.orgao_norm || ' ' || coalesce(it.txt, '') as sec, l.tipo_calc as tipo_c
    from public.licitacoes_busca l
    left join lateral (select lower(extensions.unaccent(string_agg(i.descricao, ' '))) as txt
                       from public.licitacao_itens i where i.licitacao_id = l.id) it on true
    where (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or l.municipio_norm = any (select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
      and (p_valor_min is null or l.valor >= p_valor_min)
      and (p_valor_max is null or l.valor <= p_valor_max)
      and (not coalesce(p_somente_abertas, true) or l.encerramento >= now())
      and (p_encerramento_ate is null or l.encerramento <= p_encerramento_ate)
      and (p_encerramento_de is null or l.encerramento >= p_encerramento_de)
      and (nullif(btrim(coalesce(p_orgao, '')), '') is null
           or l.orgao_norm like '%' || lower(extensions.unaccent(btrim(p_orgao))) || '%')
      and (((p_plataformas is null or cardinality(p_plataformas) = 0) and not coalesce(p_plataforma_outros, false))
           or l.sistema_origem ilike any (coalesce(p_plataformas, '{}'))
           or (coalesce(p_plataforma_outros, false)
               and (l.sistema_origem is null or not (l.sistema_origem ilike any (coalesce(p_plataformas_conhecidas, '{}'))))))
      and (p_tipo is null or p_tipo = ''
           or (p_tipo = 'material' and l.tipo_calc <> 'servico')
           or (p_tipo = 'servico'  and l.tipo_calc <> 'material'))
  ),
  pontuada as (
    -- melhor (camada, nota) entre as alternativas; sem termo = camada 0 (ordem normal)
    select b.*, coalesce(m.camada, case when c.n_grupos = 0 then 0 else 4 end)::smallint as camada_c, coalesce(m.nota, 0) as nota_c
    from base b cross join consulta c
    left join lateral (
      select x.camada, x.nota from grupos g
      cross join lateral (
        select
          (b.obj ~ g.frase) as frase_obj,
          (select bool_and(b.obj ~ p) from unnest(g.padroes) p) as todas_obj,
          (select bool_and((b.obj || ' ' || b.sec) ~ p) from unnest(g.padroes) p) as todas_qualquer,
          (b.obj ~ g.nucleo) as nucleo_obj,
          (b.sec ~ g.nucleo) as nucleo_sec,
          (select count(*) from unnest(g.secundarias) p where b.obj ~ p) as sec_obj,
          (select count(*) from unnest(g.secundarias) p where b.sec ~ p) as sec_sec,
          (select count(*) from unnest(g.correlatos) p where (b.obj || ' ' || b.sec) ~ p) as correl
      ) t
      cross join lateral (
        select case
          when t.frase_obj or t.todas_obj                         then 1
          when t.nucleo_obj or t.todas_qualquer or t.nucleo_sec   then 2
          when t.sec_obj > 0 or t.sec_sec > 0 or t.correl > 0     then 3
          else 4 end as camada,
          -- peso do campo dentro da camada: objeto 3 > itens/órgão 1
          (case when t.frase_obj then 3 else 0 end + case when t.todas_obj then 2 else 0 end
           + case when t.nucleo_obj then 3 else 0 end + case when t.todas_qualquer then 2 else 0 end
           + case when t.nucleo_sec then 1 else 0 end
           + 2 * t.sec_obj + t.sec_sec + 0.5 * t.correl)::real as nota
      ) x
      -- pré-filtro: sem NENHUMA palavra buscada (nem correlata) = camada 4 direto (1 comparação só)
      where (b.obj || ' ' || b.sec) ~ (select q.re from qualquer q)
      order by x.camada, x.nota desc limit 1
    ) m on true
  ),
  ordenada as (
    select f.id, f.nota_c as relevancia, f.tipo_c as tipo, f.camada_c as camada,
           count(*) over () as total,
           count(*) over (partition by f.camada_c) as total_camada,
           row_number() over (order by
             f.camada_c,                                                               -- pirâmide (0 = sem termo)
             case when p_ordem = 'prazo'    then f.encerramento end asc  nulls last,
             case when p_ordem = 'valor'    then f.valor        end desc nulls last,
             case when p_ordem = 'recentes' then f.publicacao   end desc nulls last,
             f.nota_c desc,
             f.encerramento asc nulls last,
             f.id) as pos                                                             -- desempate total: páginas estáveis
    from pontuada f
  ),
  pagina as (
    select * from ordenada o
    order by o.pos
    limit least(greatest(coalesce(p_limite, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select l.id, l.fonte, l.numero_controle_pncp, l.objeto, l.orgao_razao_social,
         l.uf, l.municipio, l.modalidade_id, l.modalidade_nome, l.situacao_nome,
         l.valor_estimado, l.srp, l.data_publicacao, l.data_abertura_proposta,
         l.data_encerramento_proposta, l.sistema_origem, l.link_sistema_origem, l.link_pncp,
         p.relevancia::real, p.tipo, p.total, p.camada, p.total_camada
  from pagina p join public.licitacoes l on l.id = p.id
  order by p.pos;
$$;

revoke execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) from public, anon;
grant execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) to authenticated, service_role;
grant execute on function public.radical_busca(text) to authenticated, service_role;
