-- =============================================================================
-- Uso LicitaHub · Aviso por e-mail de NOVOS editais dos radares.
-- Pode rodar mais de uma vez. Não apaga dados.
--
-- Uma vez por dia (RADAR_AVISO_CRON, padrão 7h de Brasília), o servidor procura as
-- licitações que ENTRARAM no catálogo desde o último aviso de cada radar ativo com
-- e-mail ligado e manda um resumo para quem criou o radar.
-- =============================================================================

-- Até quando cada radar já foi avisado (null = nunca; começa pela criação do radar).
alter table public.radares add column if not exists ultimo_aviso_em timestamptz;

-- Correção: a chave de origem só aceitava 'pncp' e 'manual'. Fontes novas dos coletores
-- (Diários Oficiais etc.) seguem a regra do PNCP: catálogo público, sem organização.
alter table public.licitacoes drop constraint if exists licitacoes_origem_ck;
alter table public.licitacoes add constraint licitacoes_origem_ck check (
     (fonte = 'pncp'   and organizacao_id is null and numero_controle_pncp is not null)
  or (fonte = 'manual' and organizacao_id is not null and numero_controle_pncp is null)
  or (fonte not in ('pncp', 'manual') and organizacao_id is null and external_id is not null)
);

-- Licitações novas de um radar: mesmas regras de palavra e local do mapa do Radar
-- (radar_contagem), só as que entraram no catálogo depois de p_desde e ainda abertas.
create or replace function public.radar_novidades(
  p_termo       text,
  p_ufs         text[],
  p_municipios  text[],
  p_modalidades int[],
  p_desde       timestamptz,
  p_limite      int default 10
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
    select l.id, l.objeto, l.orgao_razao_social, l.uf, l.municipio, l.modalidade_nome, l.valor_estimado,
           l.data_encerramento_proposta, l.link_pncp, l.criado_em,
           lower(extensions.unaccent(
             coalesce(l.objeto, '') || ' ' ||
             coalesce((select string_agg(i.descricao, ' ') from public.licitacao_itens i where i.licitacao_id = l.id), '')
           )) as texto
    from public.licitacoes l
    where l.criado_em > p_desde
      and l.data_encerramento_proposta >= now()
      and (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or lower(extensions.unaccent(l.municipio)) = any (
                select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
  ),
  achadas as (
    select b.* from base b
    where not exists (select 1 from grupos)
       or exists (select 1 from grupos g where (select bool_and(b.texto ~ p) from unnest(g.padroes) as p))
  )
  select jsonb_build_object(
    'total', (select count(*) from achadas),
    'itens', (select coalesce(jsonb_agg(to_jsonb(x) order by x.encerra_em), '[]'::jsonb) from (
        select id, objeto, orgao_razao_social as orgao, uf, municipio, modalidade_nome as modalidade,
               valor_estimado as valor, data_encerramento_proposta as encerra_em, link_pncp
        from achadas order by data_encerramento_proposta limit least(greatest(coalesce(p_limite, 10), 1), 50)) x)
  );
$$;

-- Para quem vai o aviso: quem criou o radar; se não houver, os donos da organização.
-- Só o servidor (lê auth.users).
create or replace function public.radar_destinatarios(p_radares uuid[])
returns table (radar_id uuid, email text, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, u.email, coalesce(nullif(p.nome, ''), split_part(u.email, '@', 1))
  from public.radares r
  join lateral (
    select r.criado_por as uid where r.criado_por is not null
      and exists (select 1 from public.membros m where m.organizacao_id = r.organizacao_id and m.user_id = r.criado_por)
    union
    select m.user_id from public.membros m
    where m.organizacao_id = r.organizacao_id and m.papel = 'dono'
      and (r.criado_por is null or not exists (select 1 from public.membros x where x.organizacao_id = r.organizacao_id and x.user_id = r.criado_por))
  ) d on true
  join auth.users u on u.id = d.uid and u.email is not null
  left join public.perfis p on p.id = d.uid
  where r.id = any (p_radares);
$$;

revoke execute on function public.radar_novidades(text, text[], text[], int[], timestamptz, int) from public, anon, authenticated;
revoke execute on function public.radar_destinatarios(uuid[]) from public, anon, authenticated;
grant execute on function public.radar_novidades(text, text[], text[], int[], timestamptz, int) to service_role;
grant execute on function public.radar_destinatarios(uuid[]) to service_role;
