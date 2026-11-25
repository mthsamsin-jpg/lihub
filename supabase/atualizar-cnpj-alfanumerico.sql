-- CNPJ alfanumérico no perfil de concorrentes e na busca de fornecedores.
-- (empresas, organizações e monitoramentos já aceitavam.) Pode rodar mais de uma vez; não altera dados.
begin;

alter table public.robo_concorrentes drop constraint if exists robo_concorrentes_cnpj_check;
alter table public.robo_concorrentes add constraint robo_concorrentes_cnpj_check
  check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$');

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
           upper(regexp_replace(coalesce(p_busca, ''), '[^0-9A-Za-z]', '', 'g')) as codigo,
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
         or (length(b.codigo) between 8 and 14 and b.codigo ~ '[0-9]' and r.fornecedor_ni like b.codigo || '%')
         or (length(b.texto) >= 3 and lower(extensions.unaccent(coalesce(r.fornecedor_nome, ''))) like '%' || b.texto || '%'))
  group by r.fornecedor_ni
  order by count(*) desc
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;

create or replace function public.mercado_concorrente_itens(p_ni text, p_limite int default 100)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.data_resultado desc nulls last, r.id desc), '[]'::jsonb)
  from (select * from public.mercado_resultados
        where fornecedor_ni = upper(regexp_replace(coalesce(p_ni, ''), '[^0-9A-Za-z]', '', 'g'))
        order by data_resultado desc nulls last, id desc
        limit least(greatest(coalesce(p_limite, 100), 1), 500)) r;
$$;

create or replace function public.mercado_concorrente_painel(p_ni text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select * from public.mercado_resultados
    where fornecedor_ni = upper(regexp_replace(coalesce(p_ni, ''), '[^0-9A-Za-z]', '', 'g'))
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

commit;
