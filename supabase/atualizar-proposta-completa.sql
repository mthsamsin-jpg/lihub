-- =============================================================================
-- Proposta comercial completa (23/11/2026)
-- Guarda, por proposta: as declarações (texto revisado), os dados bancários usados
-- (do cadastro ou informados só nesta proposta) e o fechamento (cidade, data e
-- responsável legal). O logo, o RG e os dados bancários padrão ficam em
-- empresas.dados (jsonb que já existe).
-- Pode rodar mais de uma vez.
-- =============================================================================

alter table public.propostas add column if not exists extras jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'propostas_extras_tamanho') then
    alter table public.propostas add constraint propostas_extras_tamanho
      check (jsonb_typeof(extras) = 'object' and pg_column_size(extras) <= 65536);
  end if;
  -- Logo da empresa (imagem pequena, já reduzida no navegador) cabe em empresas.dados.
  if not exists (select 1 from pg_constraint where conname = 'empresas_dados_tamanho') then
    alter table public.empresas add constraint empresas_dados_tamanho
      check (pg_column_size(dados) <= 262144);
  end if;
end $$;
