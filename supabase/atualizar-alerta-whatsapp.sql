-- Alertas do Robô Turbo 2.0 por WhatsApp (no telefone do cadastro). Desligado até a pessoa pedir.
-- Pode rodar mais de uma vez; não altera dados.
alter table public.perfis add column if not exists alerta_whatsapp boolean not null default false;
grant update (alerta_email, alerta_whatsapp) on public.perfis to authenticated;
