-- Coletores próprios de licitações (PNCP hoje; Diários Oficiais e portais de
-- prefeituras depois). Aplicar uma vez no SQL Editor do Supabase; pode rodar de novo.
--
-- O catálogo continua sendo public.licitacoes (busca, radar, favoritos e propostas já
-- leem dela). Esta migração só acrescenta:
--   - fonte livre (antes: só 'pncp' e 'manual');
--   - external_id: identificador da licitação NA FONTE (no PNCP, o número de controle);
--   - url_edital: link direto do edital, quando a fonte informar;
--   - chave única (fonte, external_id): o upsert em lote atualiza retificações sem duplicar.
-- Nenhuma coluna existente muda ou perde dado.

alter table public.licitacoes drop constraint if exists licitacoes_fonte_check;
alter table public.licitacoes add constraint licitacoes_fonte_check
  check (fonte ~ '^[a-z][a-z0-9_]{1,39}$');

alter table public.licitacoes add column if not exists external_id text;
alter table public.licitacoes add column if not exists url_edital  text;

-- No PNCP o identificador é o número de controle (preenche o que já existe).
update public.licitacoes set external_id = numero_controle_pncp
 where external_id is null and numero_controle_pncp is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'licitacoes_fonte_external_id_key') then
    alter table public.licitacoes add constraint licitacoes_fonte_external_id_key unique (fonte, external_id);
  end if;
end $$;

-- Quem grava só o número de controle (sincronizador antigo, busca ao vivo) ganha o external_id.
create or replace function public.licitacoes_external_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.external_id is null and new.numero_controle_pncp is not null then
    new.external_id := new.numero_controle_pncp;
  end if;
  return new;
end $$;

drop trigger if exists licitacoes_external_id on public.licitacoes;
create trigger licitacoes_external_id before insert or update on public.licitacoes
  for each row execute function public.licitacoes_external_id();
