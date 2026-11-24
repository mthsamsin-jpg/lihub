-- =============================================================================
-- Situação de cada credencial do cofre (23/11/2026)
-- nao_testada | aguardando_validacao | credencial_ok | bloqueada
-- (sem_credencial = não existe a linha). Gravada só pelo servidor (service role),
-- depois de um teste de login, de uma conexão ou quando o usuário avisa que a
-- conta ainda está em análise no portal. Ver worker/fases.js.
-- Pode rodar mais de uma vez.
-- =============================================================================

alter table public.portal_credentials add column if not exists situacao text not null default 'nao_testada';
alter table public.portal_credentials add column if not exists situacao_detalhe text;
alter table public.portal_credentials add column if not exists situacao_em timestamptz;
alter table public.portal_credentials add column if not exists testado_em timestamptz;

alter table public.portal_credentials drop constraint if exists portal_credentials_situacao;
alter table public.portal_credentials add constraint portal_credentials_situacao
  check (situacao in ('nao_testada', 'aguardando_validacao', 'credencial_ok', 'bloqueada'));
alter table public.portal_credentials drop constraint if exists portal_credentials_situacao_detalhe;
alter table public.portal_credentials add constraint portal_credentials_situacao_detalhe
  check (situacao_detalhe is null or char_length(situacao_detalhe) <= 500);
