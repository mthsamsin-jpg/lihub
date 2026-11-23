-- =============================================================================
-- Uso LicitaHub · Assinatura no cartão com ciclo e janela do Robô Turbo 2.0
-- Rode no Supabase (SQL Editor) ou com o script de migração. Pode rodar de novo.
--
-- Cada cobrança aprovada abre um ciclo (padrão: 30 dias, configurável no servidor):
--   robo_de .. robo_ate      plataforma + Robô Turbo 2.0 (plano Max)   (padrão: 7 dias)
--   ciclo_inicio .. plano_ate  plataforma (o ciclo inteiro)
-- Conta isenta: acesso total, sem janela.
-- Conta paga ANTES desta regra (robo_ate vazio): robô até o fim do prazo já pago.
-- =============================================================================

-- 1. Datas do ciclo na organização (lidas pelo app e pelo banco) ------------------------
alter table public.organizacoes add column if not exists ciclo_inicio timestamptz;
alter table public.organizacoes add column if not exists robo_de      timestamptz;
alter table public.organizacoes add column if not exists robo_ate     timestamptz;
-- O usuário continua sem poder alterar plano/datas (só nome e cnpj).
revoke insert, update on public.organizacoes from authenticated;
grant  update (nome, cnpj) on public.organizacoes to authenticated;

-- 2. Estado da assinatura e do pagamento ----------------------------------------------
alter table public.assinaturas add column if not exists ciclo_inicio        timestamptz;
alter table public.assinaturas add column if not exists robo_de             timestamptz;
alter table public.assinaturas add column if not exists robo_ate            timestamptz;
alter table public.assinaturas add column if not exists status_pagamento    text;  -- approved | rejected | cancelled
alter table public.assinaturas add column if not exists ultimo_pagamento_em timestamptz;
alter table public.assinaturas add column if not exists falhas_pagamento    int not null default 0;
alter table public.assinaturas add column if not exists proxima_cobranca    timestamptz;

-- 3. Regra do robô no banco (a mesma de src/pagamentos/ciclo.js) ------------------------
create or replace function public.robo_liberado(p_org uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((
    select o.isento
        or (o.plano = 'max'
            and o.plano_ate is not null and o.plano_ate > now()
            and (o.robo_de is null or o.robo_de <= now())
            and coalesce(o.robo_ate, o.plano_ate) > now())
      from public.organizacoes o
     where o.id = p_org
  ), false);
$$;
revoke all on function public.robo_liberado(uuid) from public, anon;
grant execute on function public.robo_liberado(uuid) to authenticated, service_role;

-- 4. Robô travado de verdade: fora da janela, não cria item nem liga o robô ---------------
--    (ler, pausar, parar e apagar continuam liberados para os membros)
drop policy if exists robo_itens_membros on public.robo_itens;
drop policy if exists robo_itens_ler on public.robo_itens;
drop policy if exists robo_itens_criar on public.robo_itens;
drop policy if exists robo_itens_alterar on public.robo_itens;
drop policy if exists robo_itens_apagar on public.robo_itens;
create policy robo_itens_ler on public.robo_itens for select to authenticated
  using (public.eh_membro(organizacao_id));
create policy robo_itens_criar on public.robo_itens for insert to authenticated
  with check (public.eh_membro(organizacao_id) and public.robo_liberado(organizacao_id));
create policy robo_itens_alterar on public.robo_itens for update to authenticated
  using (public.eh_membro(organizacao_id))
  with check (public.eh_membro(organizacao_id) and (public.robo_liberado(organizacao_id) or bid_status <> 'running'));
create policy robo_itens_apagar on public.robo_itens for delete to authenticated
  using (public.eh_membro(organizacao_id));

notify pgrst, 'reload schema';
