-- =============================================================================
-- Painel ADM de usuários: listar, acompanhar, bloquear e desbloquear.
-- Tudo aqui é chamado SÓ pelo servidor (chave service_role), depois de conferir a
-- sessão ADM. Nenhuma função fica disponível para anon/authenticated.
-- Idempotente: pode rodar de novo.
-- =============================================================================

-- Histórico das ações do ADM (quem foi bloqueado/desbloqueado, quando e por quê).
create table if not exists public.adm_auditoria (
  id            bigint generated always as identity primary key,
  acao          text not null check (acao in ('bloquear', 'desbloquear')),
  alvo_user_id  uuid,
  alvo_email    text,
  motivo        text check (motivo is null or char_length(motivo) <= 300),
  ip            text,
  criado_em     timestamptz not null default now()
);
create index if not exists adm_auditoria_alvo on public.adm_auditoria (alvo_user_id, criado_em desc);
alter table public.adm_auditoria enable row level security; -- sem políticas: só service_role
revoke all on public.adm_auditoria from anon, authenticated;

-- Lista de usuários com dados de acompanhamento.
-- p_estado: todos | ativos | bloqueados | pendentes (e-mail não confirmado)
drop function if exists public.adm_usuarios(text, text, int, int);
create function public.adm_usuarios(p_busca text default null, p_estado text default 'todos', p_limite int default 50, p_offset int default 0)
returns table (
  id uuid, email text, nome text, telefone text,
  organizacao text, plano text, isento boolean, plano_ate timestamptz,
  criado_em timestamptz, confirmado_em timestamptz, ultimo_login timestamptz, ultima_atividade timestamptz,
  bloqueado boolean, bloqueado_ate timestamptz, total bigint
)
language sql stable security definer set search_path = public, auth, pg_temp
as $$
  with base as (
    select u.id, u.email::text as email, coalesce(p.nome, '') as nome, p.telefone,
           o.nome as organizacao, o.plano, coalesce(o.isento, false) as isento, o.plano_ate,
           u.created_at as criado_em, u.email_confirmed_at as confirmado_em, u.last_sign_in_at as ultimo_login,
           greatest(u.last_sign_in_at, (select max(s.updated_at) from auth.sessions s where s.user_id = u.id)) as ultima_atividade,
           (u.banned_until is not null and u.banned_until > now()) as bloqueado,
           case when u.banned_until > now() then u.banned_until end as bloqueado_ate
      from auth.users u
      left join public.perfis p on p.id = u.id
      left join public.organizacoes o on o.id = p.organizacao_padrao_id
     where u.deleted_at is null
  )
  select b.*, count(*) over () as total
    from base b
   where (coalesce(btrim(p_busca), '') = ''
          or b.email ilike '%' || btrim(p_busca) || '%'
          or b.nome ilike '%' || btrim(p_busca) || '%'
          or coalesce(b.telefone, '') ilike '%' || btrim(p_busca) || '%'
          or coalesce(b.organizacao, '') ilike '%' || btrim(p_busca) || '%')
     and case coalesce(p_estado, 'todos')
           when 'ativos' then not b.bloqueado
           when 'bloqueados' then b.bloqueado
           when 'pendentes' then b.confirmado_em is null
           else true
         end
   order by b.ultima_atividade desc nulls last, b.criado_em desc, b.id
   limit least(greatest(coalesce(p_limite, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Números do topo do painel.
drop function if exists public.adm_usuarios_resumo();
create function public.adm_usuarios_resumo()
returns json
language sql stable security definer set search_path = public, auth, pg_temp
as $$
  select json_build_object(
    'total',       count(*),
    'ativos',      count(*) filter (where not (banned_until is not null and banned_until > now())),
    'bloqueados',  count(*) filter (where banned_until is not null and banned_until > now()),
    'pendentes',   count(*) filter (where email_confirmed_at is null),
    'novos7d',     count(*) filter (where created_at > now() - interval '7 days'),
    'ativos24h',   count(*) filter (where last_sign_in_at > now() - interval '24 hours'
                     or exists (select 1 from auth.sessions s where s.user_id = u.id and s.updated_at > now() - interval '24 hours')),
    'ativos7d',    count(*) filter (where last_sign_in_at > now() - interval '7 days'
                     or exists (select 1 from auth.sessions s where s.user_id = u.id and s.updated_at > now() - interval '7 days'))
  )
  from auth.users u
  where u.deleted_at is null;
$$;

-- Ao bloquear: derruba as sessões abertas (o app não consegue mais renovar o login).
drop function if exists public.adm_encerrar_sessoes(uuid);
create function public.adm_encerrar_sessoes(p_user uuid)
returns int
language plpgsql security definer set search_path = auth, pg_temp
as $$
declare n int;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.adm_usuarios(text, text, int, int) from public, anon, authenticated;
revoke all on function public.adm_usuarios_resumo() from public, anon, authenticated;
revoke all on function public.adm_encerrar_sessoes(uuid) from public, anon, authenticated;
grant execute on function public.adm_usuarios(text, text, int, int) to service_role;
grant execute on function public.adm_usuarios_resumo() to service_role;
grant execute on function public.adm_encerrar_sessoes(uuid) to service_role;
