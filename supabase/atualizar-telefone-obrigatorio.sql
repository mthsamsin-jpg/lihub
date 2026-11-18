-- =============================================================================
-- Uso LicitaHub · Telefone (WhatsApp) obrigatório no cadastro
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
-- (O schema.sql completo já inclui isto.) Contas que já existem não mudam.
-- =============================================================================

-- Telefone brasileiro (WhatsApp) -> "(11) 98765-4321" ou "(11) 3333-4444"; null se inválido.
-- Aceita com ou sem +55, com ou sem máscara. Celular: 9 dígitos começando com 9;
-- fixo: 8 dígitos começando com 2 a 5. DDD de 11 a 99.
create or replace function public.telefone_br(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
  ddd int;
  num text;
begin
  if left(btrim(coalesce(p, '')), 1) = '+' and left(d, 2) <> '55' then return null; end if;
  d := regexp_replace(d, '^0+', '');
  if length(d) in (12, 13) and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) not in (10, 11) then return null; end if;
  ddd := substr(d, 1, 2)::int;
  num := substr(d, 3);
  if ddd < 11 then return null; end if;
  if length(num) = 9 and left(num, 1) <> '9' then return null; end if;
  if length(num) = 8 and left(num, 1) not in ('2', '3', '4', '5') then return null; end if;
  return format('(%s) %s-%s', substr(d, 1, 2), left(num, length(num) - 4), right(num, 4));
end;
$$;

-- 4.4 Novo usuário (cadastro pelo Supabase Auth): cria perfil, organização e
-- registra os consentimentos enviados no cadastro.
-- O telefone (WhatsApp) é OBRIGATÓRIO e validado aqui: sem um número brasileiro
-- válido o cadastro é recusado (o Supabase Auth desfaz a criação da conta).
--   No front-end: supabase.auth.signUp({ email, password, options: { data: {
--     nome, empresa, telefone: '(11) 98765-4321', versao_termos: '2026-11',
--     versao_privacidade: '2026-11', aceita_marketing: false } } })
create or replace function public.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_nome text := left(coalesce(nullif(btrim(meta ->> 'nome'), ''),
                               split_part(coalesce(new.email, ''), '@', 1)), 120);
  v_empresa text := left(coalesce(nullif(btrim(meta ->> 'empresa'), ''), 'Minha organização'), 160);
  v_telefone text := public.telefone_br(meta ->> 'telefone');
  v_org uuid;
begin
  if v_telefone is null then
    raise exception 'telefone_invalido: informe um WhatsApp com DDD, ex.: (11) 98765-4321'
      using errcode = '22023';
  end if;

  insert into public.organizacoes (nome, criado_por)
  values (v_empresa, new.id)
  returning id into v_org;

  insert into public.perfis (id, nome, telefone, organizacao_padrao_id)
  values (new.id, v_nome, v_telefone, v_org)
  on conflict (id) do nothing;

  if nullif(btrim(meta ->> 'versao_termos'), '') is not null then
    insert into public.consentimentos (user_id, tipo, versao, aceito, origem)
    values (new.id, 'termos_uso', left(meta ->> 'versao_termos', 40), true, 'cadastro');
  end if;

  if nullif(btrim(meta ->> 'versao_privacidade'), '') is not null then
    insert into public.consentimentos (user_id, tipo, versao, aceito, origem)
    values (new.id, 'politica_privacidade', left(meta ->> 'versao_privacidade', 40), true, 'cadastro');
  end if;

  if meta ? 'aceita_marketing' then
    insert into public.consentimentos (user_id, tipo, versao, aceito, origem)
    values (new.id, 'comunicacoes_marketing',
            left(coalesce(nullif(meta ->> 'versao_privacidade', ''), 'cadastro'), 40),
            coalesce(meta ->> 'aceita_marketing', '') = 'true', 'cadastro');
  end if;

  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.ao_criar_usuario();

notify pgrst, 'reload schema';
