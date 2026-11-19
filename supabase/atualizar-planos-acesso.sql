-- =============================================================================
-- Uso LicitaHub · Planos Free / Pro / Max (Mercado Pago) e isenção de contas antigas
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run. Pode rodar de novo.
--   - plano 'max' (R$ 197/mês, com o Robô Turbo 2.0) aceito pelo banco
--   - organizacoes.isento: acesso a TUDO, sem cobrança, para sempre
--   - TODAS as organizações que já existem quando este arquivo roda pela
--     primeira vez ficam isentas (contas já cadastradas nunca são bloqueadas)
-- =============================================================================
alter table public.organizacoes drop constraint if exists organizacoes_plano_check;
alter table public.organizacoes add constraint organizacoes_plano_check
  check (plano in ('gratuito', 'starter', 'prime', 'pro', 'max'));
alter table public.assinaturas drop constraint if exists assinaturas_plano_check;
alter table public.assinaturas add constraint assinaturas_plano_check
  check (plano is null or plano in ('starter', 'prime', 'pro', 'max'));

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'organizacoes' and column_name = 'isento') then
    alter table public.organizacoes add column isento boolean not null default false;
    -- Primeira vez: isenta todas as contas já cadastradas.
    update public.organizacoes set isento = true;
  end if;
end $$;
-- O usuário não altera "isento" (só update de nome e cnpj é liberado).
revoke insert, update on public.organizacoes from authenticated;
grant  update (nome, cnpj) on public.organizacoes to authenticated;

-- Mercado Pago: cada pagamento aprovado libera 15 dias (plano_ate). Vencido = Free.
alter table public.organizacoes add column if not exists plano_ate timestamptz;
alter table public.assinaturas add column if not exists mp_assinatura_id text unique;  -- cobrança mensal no cartão (preapproval)
alter table public.assinaturas add column if not exists mp_pagamentos text;            -- ids já processados (evita liberar 2x)
alter table public.assinaturas add column if not exists forma text
  check (forma is null or forma in ('avulso', 'recorrente'));

notify pgrst, 'reload schema';
