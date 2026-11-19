-- Estabilidade dos coletores (aplicar depois de atualizar-coletores.sql; pode rodar de novo).
--   - ultimo_sinal: cada coleta "dá sinal de vida" a cada página. Execução sem sinal há
--     mais de 30 min é considerada abandonada (servidor reiniciou/caiu no meio).
--   - trava entre servidores: só UMA execução "executando" por fonte e tipo
--     (coletor novo ou sincronizador antigo), mesmo com Render + VPS ligados.

alter table public.sync_execucoes add column if not exists ultimo_sinal timestamptz not null default now();
create index if not exists sync_execucoes_iniciado_idx on public.sync_execucoes (iniciado_em);

-- Fecha as execuções que já estão presas (sem sinal há mais de 30 min).
update public.sync_execucoes
   set status = 'erro', finalizado_em = now(),
       detalhes = coalesce(detalhes, '{}'::jsonb) || jsonb_build_object('erro', 'abandonada (o servidor reiniciou ou caiu durante a coleta)')
 where status = 'executando' and greatest(ultimo_sinal, iniciado_em) < now() - interval '30 minutes';

-- Se ainda sobrar mais de uma "executando" do mesmo tipo, só a mais nova pode estar viva.
update public.sync_execucoes s
   set status = 'erro', finalizado_em = now(),
       detalhes = coalesce(s.detalhes, '{}'::jsonb) || jsonb_build_object('erro', 'abandonada (substituída por uma execução mais nova)')
 where s.status = 'executando'
   and exists (select 1 from public.sync_execucoes n
                where n.status = 'executando' and n.fonte = s.fonte
                  and (n.modo like 'coletor:%') = (s.modo like 'coletor:%') and n.id > s.id);

create unique index if not exists sync_execucoes_uma_por_vez
  on public.sync_execucoes (fonte, (modo like 'coletor:%')) where status = 'executando';

-- url_edital não repete o link do portal no PNCP (lá o link do edital é o link_pncp).
update public.licitacoes set url_edital = null
 where fonte = 'pncp' and url_edital is not null and url_edital = link_sistema_origem;
