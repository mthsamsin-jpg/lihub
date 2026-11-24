-- =============================================================================
-- Integridade da proposta (24/11/2026): snapshot da empresa e numeração única.
-- Pode rodar mais de uma vez.
-- =============================================================================

-- 1. extras passa a guardar o snapshot da empresa (com o logo): limite maior.
alter table public.propostas drop constraint if exists propostas_extras_tamanho;
alter table public.propostas add constraint propostas_extras_tamanho
  check (jsonb_typeof(extras) = 'object' and pg_column_size(extras) <= 393216);

-- 2. Último número usado por organização e ano (não volta quando se exclui).
create table if not exists public.proposta_numeros (
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  ano            int  not null,
  ultimo         int  not null,
  primary key (organizacao_id, ano)
);
alter table public.proposta_numeros enable row level security; -- sem políticas: só a função usa
revoke all on public.proposta_numeros from anon, authenticated;

create or replace function public.proximo_numero_proposta(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano int := extract(year from now() at time zone 'America/Sao_Paulo')::int;
  v_maior int;
  v_n int;
begin
  if not public.eh_membro(p_org) then
    raise exception 'Sem permissão nesta organização.' using errcode = '42501';
  end if;
  select coalesce(max(substring(numero from '^PROP-\d{4}-(\d{1,9})$')::int), 0) into v_maior
    from public.propostas
   where organizacao_id = p_org and numero ~ ('^PROP-' || v_ano || '-\d{1,9}$');
  insert into public.proposta_numeros as n (organizacao_id, ano, ultimo)
  values (p_org, v_ano, v_maior + 1)
  on conflict (organizacao_id, ano) do update set ultimo = greatest(n.ultimo, v_maior) + 1
  returning n.ultimo into v_n;
  return 'PROP-' || v_ano || '-' || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
end $$;
revoke all on function public.proximo_numero_proposta(uuid) from public, anon;
grant execute on function public.proximo_numero_proposta(uuid) to authenticated;

create unique index if not exists propostas_numero_unico on public.propostas (organizacao_id, numero);

-- 3. Propostas já salvas: congela os dados atuais da empresa (só onde ainda não há snapshot).
update public.propostas p
   set extras = p.extras || jsonb_build_object('empresa',
     coalesce(e.dados, '{}'::jsonb) || jsonb_build_object(
       'id', e.id, 'razao', e.razao_social, 'fantasia', coalesce(e.nome_fantasia, ''), 'cnpj', coalesce(e.cnpj, ''),
       'porte', case when e.porte = 'DEMAIS' then 'Demais' else coalesce(e.porte, 'ME') end,
       'uf', coalesce(e.uf, ''), 'cidade', coalesce(e.municipio, ''),
       'email', coalesce(e.email_contato, ''), 'telefone', coalesce(e.telefone_contato, '')))
  from public.empresas e
 where e.id = p.empresa_id and e.organizacao_id = p.organizacao_id and not (p.extras ? 'empresa');
