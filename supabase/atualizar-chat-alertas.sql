-- =============================================================================
-- Uso LicitaHub · Chat Unificado, Fase 2: alertas no celular (Telegram e WhatsApp).
-- Idempotente; não apaga nem altera dados existentes.
-- =============================================================================

-- Telegram: a pessoa abre o robô do Uso LicitaHub pelo link com o código de
-- vínculo; o servidor confirma o código e guarda o chat (id) para mandar alertas.
alter table public.monitoramentos add column if not exists telegram_chats jsonb not null default '[]'::jsonb;  -- [{ "id": 123, "nome": "Maria" }]
alter table public.monitoramentos add column if not exists telegram_codigo text
  check (telegram_codigo is null or telegram_codigo ~ '^[A-Za-z0-9]{8,32}$');
alter table public.monitoramentos add column if not exists telegram_codigo_ate timestamptz;

-- WhatsApp (API oficial da Meta): números que recebem o alerta, só dígitos com DDI.
alter table public.monitoramentos add column if not exists whatsapp_numeros text[] not null default '{}';
alter table public.monitoramentos drop constraint if exists monitoramentos_whatsapp_ck;
alter table public.monitoramentos add constraint monitoramentos_whatsapp_ck
  check (cardinality(whatsapp_numeros) <= 5);
