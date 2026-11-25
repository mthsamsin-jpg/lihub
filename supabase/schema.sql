-- =============================================================================
-- LicitaHub - esquema do banco de dados (Supabase / PostgreSQL 15+)
--
-- Como usar: copie este arquivo inteiro no "SQL Editor" do Supabase e clique em
-- "Run". O script pode ser executado de novo sem apagar dados (é idempotente).
-- Depois, confira com: npm run verificar
--
-- Recomendado: um projeto do Supabase só para o LicitaHub. Num projeto
-- compartilhado, os gatilhos em auth.users criam perfil e organização do
-- LicitaHub para TODO usuário novo, inclusive os do outro sistema.
--
-- Organização:
--   1. Extensões e busca em português sem acentos
--   2. Funções utilitárias (CNPJ, datas de atualização, checagem de membro)
--   3. Tabelas
--   4. Gatilhos (cadastro de usuário, organização, CRM, LGPD)
--   5. Segurança: RLS (cada cliente só enxerga os próprios dados) e permissões
--   6. Funções chamadas pelo app (busca, exportação de dados, organização)
--   7. Armazenamento de PDFs de editais (Storage) e tempo real
--
-- Modelo de acesso (multiempresa / SaaS):
--   usuário (auth.users) -> membro de uma ou mais ORGANIZAÇÕES (a conta assinante)
--   organização -> cadastra EMPRESAS clientes -> cada empresa tem cards no CRM
--   LICITAÇÕES do PNCP são um catálogo público compartilhado (somente leitura
--   para os usuários; quem grava é o sincronizador com a chave service_role).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extensões e busca textual em português (sem diferenciar acentos)
-- -----------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;

do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'portugues_sem_acento') then
    create text search configuration public.portugues_sem_acento (copy = pg_catalog.portuguese);
    alter text search configuration public.portugues_sem_acento
      alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. Funções utilitárias
-- -----------------------------------------------------------------------------

-- Remove pontuação e coloca em maiúsculas. Aceita o CNPJ alfanumérico
-- (Receita Federal, a partir de julho/2026) e o numérico tradicional.
create or replace function public.cnpj_limpo(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

-- Valida os dígitos verificadores do CNPJ (numérico ou alfanumérico).
-- Regra oficial: cada caractere vale (código ASCII - 48), pesos módulo 11.
create or replace function public.cnpj_valido(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  c text := public.cnpj_limpo(p);
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int;
  resto int;
  dv1 int;
  dv2 int;
begin
  if c !~ '^[0-9A-Z]{12}[0-9]{2}$' then
    return false;
  end if;
  if c ~ '^(.)\1{13}$' then          -- 00000000000000, 11111111111111...
    return false;
  end if;

  soma := 0;
  for i in 1..12 loop
    soma := soma + (ascii(substr(c, i, 1)) - 48) * pesos1[i];
  end loop;
  resto := soma % 11;
  dv1 := case when resto < 2 then 0 else 11 - resto end;

  soma := 0;
  for i in 1..12 loop
    soma := soma + (ascii(substr(c, i, 1)) - 48) * pesos2[i];
  end loop;
  soma := soma + dv1 * pesos2[13];
  resto := soma % 11;
  dv2 := case when resto < 2 then 0 else 11 - resto end;

  return substr(c, 13, 1)::int = dv1 and substr(c, 14, 1)::int = dv2;
end;
$$;

-- Converte texto em uuid; devolve null se não for um uuid válido.
create or replace function public.uuid_ou_nulo(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
  end;
$$;

-- Atualiza a coluna atualizado_em em todo UPDATE.
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. Tabelas
-- -----------------------------------------------------------------------------

-- 3.1 Organizações: a conta assinante do SaaS (empresa ou consultoria).
create table if not exists public.organizacoes (
  id                      uuid primary key default gen_random_uuid(),
  nome                    text not null check (char_length(btrim(nome)) between 1 and 160),
  cnpj                    text check (cnpj is null or public.cnpj_valido(cnpj)),
  plano                   text not null default 'gratuito'
                            check (plano in ('gratuito', 'starter', 'prime', 'pro', 'max')),
  -- Isenta do paywall: acesso a tudo, sem cobrança, para sempre (contas antigas).
  isento                  boolean not null default false,
  -- Fim dos dias pagos no Mercado Pago (15 por pagamento). Vencido = Free.
  plano_ate               timestamptz,
  limite_empresas         int  not null default 3   check (limite_empresas >= 0),
  limite_analises_ia_mes  int  not null default 10  check (limite_analises_ia_mes >= 0),
  criado_por              uuid references auth.users (id) on delete set null,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);

-- 3.2 Perfis: dados do usuário além do login (1 para 1 com auth.users).
-- O e-mail fica só em auth.users (minimização de dados - LGPD).
create table if not exists public.perfis (
  id                      uuid primary key references auth.users (id) on delete cascade,
  nome                    text not null default '' check (char_length(nome) <= 120),
  telefone                text check (telefone is null or char_length(telefone) <= 30),
  avatar_url              text,
  organizacao_padrao_id   uuid references public.organizacoes (id) on delete set null,
  criado_em               timestamptz not null default now(),
  atualizado_em           timestamptz not null default now()
);

-- 3.3 Membros: quem participa de cada organização e com qual papel.
create table if not exists public.membros (
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  papel           text not null default 'membro' check (papel in ('dono', 'admin', 'membro')),
  criado_em       timestamptz not null default now(),
  primary key (organizacao_id, user_id)
);
create index if not exists membros_user_idx on public.membros (user_id);

-- Funções de checagem de acesso. SECURITY DEFINER evita recursão nas
-- políticas de RLS. Elas só respondem sobre o próprio usuário logado.
create or replace function public.eh_membro(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membros m
    where m.organizacao_id = p_org
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.tem_papel(p_org uuid, p_papeis text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.membros m
    where m.organizacao_id = p_org
      and m.user_id = (select auth.uid())
      and m.papel = any (p_papeis)
  );
$$;

create or replace function public.compartilha_organizacao(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membros a
    join public.membros b on b.organizacao_id = a.organizacao_id
    where a.user_id = (select auth.uid())
      and b.user_id = p_user
  );
$$;

-- 3.4 Empresas clientes: as empresas que participam das licitações.
create table if not exists public.empresas (
  id                uuid primary key default gen_random_uuid(),
  organizacao_id    uuid not null references public.organizacoes (id) on delete cascade,
  cnpj              text not null check (public.cnpj_valido(cnpj)),
  razao_social      text not null check (char_length(btrim(razao_social)) between 1 and 200),
  nome_fantasia     text,
  porte             text check (porte in ('MEI', 'ME', 'EPP', 'DEMAIS')),
  uf                text check (uf ~ '^[A-Z]{2}$'),
  municipio         text,
  cnaes             text[] not null default '{}',
  palavras_chave    text[] not null default '{}',   -- termos de interesse (radar)
  ufs_interesse     text[] not null default '{}',
  email_contato     text,
  telefone_contato  text,
  observacoes       text,
  ativo             boolean not null default true,
  criado_por        uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  unique (organizacao_id, cnpj),
  unique (id, organizacao_id)                       -- usado por chaves estrangeiras compostas
);
-- Dados extras da empresa usados em propostas e declarações (endereço, inscrições,
-- regime tributário, representante legal, dados bancários). Adicionada em 15/11/2026.
alter table public.empresas add column if not exists dados jsonb not null default '{}'::jsonb;

-- 3.5 Licitações: catálogo do PNCP (público) + licitações manuais (privadas).
create table if not exists public.licitacoes (
  id                          bigint generated by default as identity primary key,
  fonte                       text not null default 'pncp' check (fonte ~ '^[a-z][a-z0-9_]{1,39}$'),
  external_id                 text,          -- identificador na fonte (PNCP: número de controle)
  url_edital                  text,          -- link direto do edital, quando a fonte informa
  organizacao_id              uuid references public.organizacoes (id) on delete cascade,
  numero_controle_pncp        text unique,
  orgao_cnpj                  text,
  orgao_razao_social          text,
  orgao_esfera                text,          -- F federal, E estadual, M municipal, D distrital, N não informado
  orgao_poder                 text,          -- E executivo, L legislativo, J judiciário, N não informado
  unidade_codigo              text,
  unidade_nome                text,
  uf                          text check (uf is null or uf ~ '^[A-Z]{2}$'),
  municipio                   text,
  municipio_ibge              text,
  ano_compra                  int,
  sequencial_compra           int,
  numero_compra               text,
  processo                    text,
  modalidade_id               smallint,
  modalidade_nome             text,
  modo_disputa_id             smallint,
  modo_disputa_nome           text,
  instrumento_convocatorio    text,
  situacao_id                 smallint,
  situacao_nome               text,
  objeto                      text not null,
  informacao_complementar     text,
  srp                         boolean,
  amparo_legal                text,
  valor_estimado              numeric(18, 2),
  valor_homologado            numeric(18, 2),
  orcamento_sigiloso          boolean,
  data_publicacao             timestamptz,
  data_abertura_proposta      timestamptz,
  data_encerramento_proposta  timestamptz,
  data_atualizacao_pncp       timestamptz,
  sistema_origem              text,          -- portal onde ocorre a disputa (ex.: Compras.gov.br)
  link_sistema_origem         text,
  link_pncp                   text generated always as (
    case
      when fonte = 'pncp' and orgao_cnpj is not null
           and ano_compra is not null and sequencial_compra is not null
      then 'https://pncp.gov.br/app/editais/' || orgao_cnpj || '/'
           || ano_compra::text || '/' || sequencial_compra::text
    end
  ) stored,
  busca                       tsvector generated always as (
    setweight(to_tsvector('public.portugues_sem_acento', coalesce(objeto, '')), 'A')
    || setweight(to_tsvector('public.portugues_sem_acento',
         coalesce(orgao_razao_social, '') || ' ' || coalesce(unidade_nome, '') || ' '
         || coalesce(municipio, '')), 'B')
    || setweight(to_tsvector('public.portugues_sem_acento', coalesce(informacao_complementar, '')), 'C')
  ) stored,
  dados_brutos                jsonb,
  sincronizado_em             timestamptz,
  criado_em                   timestamptz not null default now(),
  atualizado_em               timestamptz not null default now(),
  constraint licitacoes_origem_ck check (
       (fonte = 'pncp'   and organizacao_id is null     and numero_controle_pncp is not null)
    or (fonte = 'manual' and organizacao_id is not null and numero_controle_pncp is null)
  )
);
create index if not exists licitacoes_busca_idx         on public.licitacoes using gin (busca);
create index if not exists licitacoes_encerramento_idx  on public.licitacoes (data_encerramento_proposta);
create index if not exists licitacoes_uf_modalidade_idx on public.licitacoes (uf, modalidade_id, data_encerramento_proposta);
create index if not exists licitacoes_publicacao_idx    on public.licitacoes (data_publicacao desc);
create index if not exists licitacoes_orgao_idx         on public.licitacoes (orgao_cnpj);
create index if not exists licitacoes_organizacao_idx   on public.licitacoes (organizacao_id) where organizacao_id is not null;
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

-- 3.6 Itens de cada licitação (baixados do PNCP sob demanda).
create table if not exists public.licitacao_itens (
  licitacao_id             bigint not null references public.licitacoes (id) on delete cascade,
  numero_item              int not null,
  descricao                text,
  material_ou_servico      text,            -- M material, S serviço
  quantidade               numeric(18, 4),
  unidade_medida           text,
  valor_unitario_estimado  numeric(18, 4),
  valor_total_estimado     numeric(18, 2),
  criterio_julgamento      text,
  beneficio_me_epp         text,            -- ex.: participação exclusiva ME/EPP
  situacao                 text,
  informacao_complementar  text,
  atualizado_em            timestamptz not null default now(),
  primary key (licitacao_id, numero_item)
);

-- 3.7 Favoritas (pessoais de cada usuário).
create table if not exists public.favoritos (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  licitacao_id  bigint not null references public.licitacoes (id) on delete cascade,
  criado_em     timestamptz not null default now(),
  primary key (user_id, licitacao_id)
);
create index if not exists favoritos_licitacao_idx on public.favoritos (licitacao_id);

-- 3.7b Observações de cada usuário nos cards de licitação.
create table if not exists public.licitacao_observacoes (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  licitacao_id   bigint not null references public.licitacoes (id) on delete cascade,
  texto          text not null check (char_length(btrim(texto)) between 1 and 2000),
  atualizado_em  timestamptz not null default now(),
  primary key (user_id, licitacao_id)
);

-- 3.8 Etapas do Kanban (personalizáveis por organização).
create table if not exists public.kanban_etapas (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  nome            text not null check (char_length(btrim(nome)) between 1 and 60),
  cor             text not null default '#3b82f6' check (cor ~ '^#[0-9a-fA-F]{6}$'),
  posicao         int  not null default 0,
  tipo            text not null default 'aberta' check (tipo in ('aberta', 'ganha', 'perdida')),
  criado_em       timestamptz not null default now(),
  unique (id, organizacao_id)
);
create index if not exists kanban_etapas_org_idx on public.kanban_etapas (organizacao_id, posicao);

-- 3.9 Cards do CRM: uma licitação acompanhada por uma empresa cliente.
create table if not exists public.crm_cards (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  empresa_id      uuid not null,
  licitacao_id    bigint not null references public.licitacoes (id),
  etapa_id        uuid not null,
  posicao         double precision not null default 0,  -- ordem dentro da coluna
  responsavel_id  uuid references auth.users (id) on delete set null,
  prioridade      smallint not null default 2 check (prioridade between 1 and 3),  -- 1 alta, 3 baixa
  valor_proposta  numeric(18, 2) check (valor_proposta is null or valor_proposta >= 0),
  valor_ganho     numeric(18, 2) check (valor_ganho is null or valor_ganho >= 0),
  prazo_interno   timestamptz,
  etiquetas       text[] not null default '{}',
  observacoes     text,
  arquivado       boolean not null default false,
  criado_por      uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  -- chaves compostas: empresa e etapa precisam ser da MESMA organização do card
  foreign key (empresa_id, organizacao_id) references public.empresas (id, organizacao_id) on delete cascade,
  foreign key (etapa_id, organizacao_id) references public.kanban_etapas (id, organizacao_id),
  unique (empresa_id, licitacao_id)
);
create index if not exists crm_cards_quadro_idx     on public.crm_cards (organizacao_id, empresa_id, etapa_id, posicao);
create index if not exists crm_cards_licitacao_idx  on public.crm_cards (licitacao_id);
create index if not exists crm_cards_etapa_idx      on public.crm_cards (etapa_id);

-- 3.10 Análises de edital feitas pela IA (Claude).
create table if not exists public.analises_edital (
  id                  uuid primary key default gen_random_uuid(),
  organizacao_id      uuid not null references public.organizacoes (id) on delete cascade,
  licitacao_id        bigint references public.licitacoes (id) on delete set null,
  solicitado_por      uuid references auth.users (id) on delete set null,
  origem              text not null check (origem in ('pncp', 'upload', 'texto')),
  arquivo_nome        text,
  arquivo_path        text,               -- caminho no Storage (bucket "editais") quando origem = upload
  arquivo_sha256      text,               -- evita pagar duas vezes pela análise do mesmo arquivo
  status              text not null default 'pendente'
                        check (status in ('pendente', 'processando', 'concluida', 'erro')),
  modelo              text,
  resultado           jsonb,
  erro                text,
  tokens_entrada      int,
  tokens_saida        int,
  custo_estimado_usd  numeric(10, 4),
  criado_em           timestamptz not null default now(),
  concluido_em        timestamptz
);
create index if not exists analises_org_idx   on public.analises_edital (organizacao_id, criado_em desc);
create index if not exists analises_hash_idx  on public.analises_edital (organizacao_id, arquivo_sha256) where status = 'concluida';
create index if not exists analises_licitacao_idx on public.analises_edital (licitacao_id);

-- 3.11 Consentimentos (LGPD): registro histórico, só cresce (sem edição).
create table if not exists public.consentimentos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tipo        text not null check (tipo in ('termos_uso', 'politica_privacidade',
                                            'processamento_ia', 'comunicacoes_marketing')),
  versao      text not null check (char_length(versao) between 1 and 40),
  aceito      boolean not null,
  origem      text not null default 'app' check (origem in ('cadastro', 'app')),
  criado_em   timestamptz not null default now()
);
create index if not exists consentimentos_user_idx on public.consentimentos (user_id, tipo, criado_em desc);

-- 3.12 Histórico das sincronizações com o PNCP (uso interno).
create table if not exists public.sync_execucoes (
  id             bigint generated always as identity primary key,
  fonte          text not null default 'pncp',
  modo           text not null,
  parametros     jsonb not null default '{}',
  status         text not null default 'executando'
                   check (status in ('executando', 'concluida', 'parcial', 'erro')),
  recebidos      int not null default 0,
  gravados       int not null default 0,
  falhas         int not null default 0,
  detalhes       jsonb,
  iniciado_em    timestamptz not null default now(),
  finalizado_em  timestamptz,
  ultimo_sinal   timestamptz not null default now()  -- sinal de vida: sem sinal há 30 min = abandonada
);
create index if not exists sync_execucoes_iniciado_idx on public.sync_execucoes (iniciado_em);
-- trava entre servidores: uma execução por fonte e tipo (coletor novo / sincronizador antigo)
create unique index if not exists sync_execucoes_uma_por_vez
  on public.sync_execucoes (fonte, (modo like 'coletor:%')) where status = 'executando';

-- 3.13 Assinaturas pagas (Stripe): uma por organização. Só o servidor grava
-- (chave service_role, a partir dos avisos da Stripe); os membros consultam.
-- Atenção: antes de apagar uma organização ou conta pelo app, cancele a
-- assinatura na Stripe, senão o cartão continua sendo cobrado.
create table if not exists public.assinaturas (
  organizacao_id        uuid primary key references public.organizacoes (id) on delete cascade,
  stripe_cliente_id     text unique,
  stripe_assinatura_id  text unique,
  plano                 text check (plano is null or plano in ('starter', 'prime', 'pro', 'max')),
  ciclo                 text check (ciclo is null or ciclo in ('mensal', 'anual')),
  status                text,          -- situação na Stripe: trialing, active, past_due, canceled, unpaid...
  periodo_fim           timestamptz,   -- fim do período pago (data da próxima cobrança)
  teste_fim             timestamptz,
  cancelar_no_fim       boolean not null default false,
  teste_usado           boolean not null default false,  -- teste grátis só uma vez por organização
  mp_assinatura_id      text unique,   -- Mercado Pago: cobrança mensal no cartão (preapproval)
  mp_pagamentos         text,          -- ids de pagamento já processados (evita liberar 2x)
  forma                 text check (forma is null or forma in ('avulso', 'recorrente')),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

-- 3.14 Documentos da empresa (certidões, balanço, atestados) com validade.
--      Arquivo no Storage: documentos/<id-da-organizacao>/<id-da-empresa>/<arquivo>
create table if not exists public.documentos (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  empresa_id      uuid not null,
  nome            text not null check (char_length(btrim(nome)) between 1 and 200),
  tipo            text not null default 'Outros' check (char_length(tipo) between 1 and 40),
  emissao         date,
  validade        date,
  arquivo_path    text,
  arquivo_nome    text check (arquivo_nome is null or char_length(arquivo_nome) <= 200),
  criado_por      uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  foreign key (empresa_id, organizacao_id) references public.empresas (id, organizacao_id) on delete cascade
);
create index if not exists documentos_empresa_idx on public.documentos (organizacao_id, empresa_id, validade);

-- 3.15 Propostas comerciais (Gerador de proposta).
create table if not exists public.propostas (
  id                uuid primary key default gen_random_uuid(),
  organizacao_id    uuid not null references public.organizacoes (id) on delete cascade,
  empresa_id        uuid,
  licitacao_id      bigint references public.licitacoes (id) on delete set null,
  numero            text not null check (char_length(btrim(numero)) between 1 and 40),
  status            text not null default 'Rascunho'
                      check (status in ('Rascunho', 'Enviada', 'Em análise', 'Aceita', 'Recusada')),
  licitacao_resumo  jsonb,          -- número, objeto e órgão da licitação no dia da proposta
  validade_dias     int check (validade_dias is null or validade_dias between 1 and 365),
  prazo             text check (prazo is null or char_length(prazo) <= 200),
  pagamento         text check (pagamento is null or char_length(pagamento) <= 200),
  observacoes       text check (observacoes is null or char_length(observacoes) <= 2000),
  itens             jsonb not null default '[]'::jsonb,
  total             numeric(18, 2) not null default 0 check (total >= 0),
  criado_por        uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  foreign key (empresa_id, organizacao_id) references public.empresas (id, organizacao_id) on delete set null (empresa_id)
);
create index if not exists propostas_org_idx on public.propostas (organizacao_id, criado_em desc);
-- Declarações, dados bancários e fechamento de cada proposta (atualizar-proposta-completa.sql).
alter table public.propostas add column if not exists extras jsonb not null default '{}'::jsonb;

-- 3.16 Radares: buscas salvas que avisam quando entra uma licitação parecida.
create table if not exists public.radares (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  nome            text not null check (char_length(btrim(nome)) between 1 and 120),
  palavras        text[] not null default '{}',
  ufs             text[] not null default '{}',
  modalidades     text[] not null default '{}',
  canais          jsonb not null default '{"email": true, "telegram": false, "computador": true}'::jsonb,
  ativo           boolean not null default true,
  criado_por      uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em       timestamptz not null default now()
);
create index if not exists radares_org_idx on public.radares (organizacao_id);
-- Busca regional (nov/2026): municípios escolhidos no mapa e até 20 termos por radar.
alter table public.radares add column if not exists municipios text[] not null default '{}';
alter table public.radares drop constraint if exists radares_limites;
alter table public.radares add constraint radares_limites
  check (cardinality(palavras) <= 20 and cardinality(ufs) <= 27 and cardinality(municipios) <= 2000);

-- 3.17 Eventos do calendário criados pelo usuário (sessões, prazos, lembretes).
create table if not exists public.eventos (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  data            date not null,
  hora            time,
  titulo          text not null check (char_length(btrim(titulo)) between 1 and 200),
  detalhe         text check (detalhe is null or char_length(detalhe) <= 400),
  tipo            text not null default 'sessao' check (tipo in ('sessao', 'prazo', 'abertura')),
  criado_por      uuid references auth.users (id) on delete set null default auth.uid(),
  criado_em       timestamptz not null default now()
);
create index if not exists eventos_org_data_idx on public.eventos (organizacao_id, data);

-- 3.18 Monitoramento (Cadastro Comprasnet): o que acompanhar, SÓ com dados
--      públicos (CNPJ, UASG, número do pregão). Nenhuma senha do gov.br é guardada.
create table if not exists public.monitoramentos (
  organizacao_id  uuid primary key references public.organizacoes (id) on delete cascade,
  cnpj            text check (cnpj is null or public.cnpj_valido(cnpj)),
  nome            text check (nome is null or char_length(nome) <= 200),
  pregoes         jsonb not null default '[]'::jsonb,   -- [{ "uasg": "...", "numero": "...", "ano": "..." }]
  palavras        text[] not null default '{}',         -- palavras que disparam alerta no chat
  atualizado_em   timestamptz not null default now()
);


-- 3.x Robô Turbo 2.0: itens em disputa, limites e status (políticas e permissões junto).
create table if not exists public.robo_itens (
  id               uuid primary key default gen_random_uuid(),
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  licitacao_id     bigint references public.licitacoes (id) on delete set null,
  item_numero      int check (item_numero is null or item_numero > 0),
  descricao        text not null check (char_length(btrim(descricao)) between 1 and 300),
  max_price        numeric(18, 2) not null check (max_price > 0),          -- preço teto (valor da administração)
  supplier_cost    numeric(18, 2) check (supplier_cost is null or supplier_cost >= 0), -- custo do fornecedor
  min_floor_price  numeric(18, 2) not null check (min_floor_price > 0),    -- piso de segurança
  decremento       numeric(18, 2) not null default 0.01 check (decremento >= 0.01),
  intervalo_seg    int not null default 20 check (intervalo_seg between 0 and 600),
  bid_status       text not null default 'idle'
                   check (bid_status in ('idle', 'running', 'paused', 'stopped_at_floor')),
  nosso_lance      numeric(18, 2),
  melhor_lance     numeric(18, 2),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  -- TRAVAS no próprio banco: piso entre o custo e o teto.
  constraint robo_itens_piso_teto  check (min_floor_price <= max_price),
  constraint robo_itens_piso_custo check (supplier_cost is null or min_floor_price >= supplier_cost)
);
alter table public.robo_itens drop constraint if exists robo_itens_lance_piso;

-- TRAVA: todo lance NOVO gravado precisa estar entre o piso e o teto. (Subir o piso
-- depois de um lance dado é permitido: o lance antigo já foi enviado e não muda.)
create or replace function public.robo_conferir_lance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.nosso_lance is not null
     and (tg_op = 'INSERT' or new.nosso_lance is distinct from old.nosso_lance)
     and (new.nosso_lance < new.min_floor_price or new.nosso_lance > new.max_price) then
    raise exception 'Lance de % bloqueado: fora do intervalo entre o piso (%) e o teto (%).',
      new.nosso_lance, new.min_floor_price, new.max_price
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists robo_conferir_lance on public.robo_itens;
create trigger robo_conferir_lance before insert or update on public.robo_itens
  for each row execute function public.robo_conferir_lance();
-- Portal onde o robô atua (o mesmo do filtro da tela).
alter table public.robo_itens add column if not exists plataforma text not null default 'comprasnet';
alter table public.robo_itens drop constraint if exists robo_itens_plataforma;
alter table public.robo_itens add constraint robo_itens_plataforma check (plataforma in (
  'comprasnet', 'pncp', 'licitacoes-e', 'bbmnet', 'bnc', 'pcp', 'bll', 'licitanet', 'licitar', 'licitamais',
  'comprasbr', 'petronect', 'outros'));
-- Sala de disputa: quantidade (lance pelo valor unitário), nosso porte para a LC 123,
-- fuga da faixa de 5% de ME/EPP (só até o piso) e a fase atual do pregão.
alter table public.robo_itens add column if not exists quantidade int not null default 1;
alter table public.robo_itens add column if not exists nosso_porte text not null default 'demais';
alter table public.robo_itens add column if not exists fugir_empate boolean not null default false;
alter table public.robo_itens add column if not exists fase text;
-- Sniper (segundos finais da etapa de lances) e margem mínima de lucro sobre o custo.
alter table public.robo_itens add column if not exists sniper_seg int not null default 0;
alter table public.robo_itens add column if not exists margem_min_pct numeric(6, 2);
alter table public.robo_itens drop constraint if exists robo_itens_sniper;
alter table public.robo_itens add constraint robo_itens_sniper check (sniper_seg between 0 and 300);
alter table public.robo_itens drop constraint if exists robo_itens_margem;
alter table public.robo_itens add constraint robo_itens_margem check (margem_min_pct is null or margem_min_pct between 0 and 1000);
alter table public.robo_itens drop constraint if exists robo_itens_quantidade;
alter table public.robo_itens add constraint robo_itens_quantidade check (quantidade between 1 and 100000000);
alter table public.robo_itens drop constraint if exists robo_itens_nosso_porte;
alter table public.robo_itens add constraint robo_itens_nosso_porte check (nosso_porte in ('me', 'epp', 'demais'));
alter table public.robo_itens drop constraint if exists robo_itens_fase;
alter table public.robo_itens add constraint robo_itens_fase check (fase is null or fase in (
  'aberta', 'prorrogacao', 'desempate', 'negociacao', 'habilitacao', 'encerrada'));
create index if not exists robo_itens_organizacao_idx on public.robo_itens (organizacao_id);

alter table public.robo_itens enable row level security;
drop policy if exists robo_itens_membros on public.robo_itens;
create policy robo_itens_membros on public.robo_itens for all to authenticated
  using (public.eh_membro(organizacao_id))
  with check (public.eh_membro(organizacao_id));

drop trigger if exists tocar_atualizado_em on public.robo_itens;
create trigger tocar_atualizado_em before update on public.robo_itens
  for each row execute function public.tocar_atualizado_em();

grant select, insert, update, delete on public.robo_itens to authenticated, service_role;
revoke all on public.robo_itens from anon;


-- -----------------------------------------------------------------------------
-- 4. Gatilhos (triggers)
-- -----------------------------------------------------------------------------

-- 4.1 atualizado_em automático
do $$
declare t text;
begin
  foreach t in array array['organizacoes', 'perfis', 'empresas', 'licitacoes', 'crm_cards', 'assinaturas',
                           'documentos', 'propostas', 'monitoramentos'] loop
    execute format('drop trigger if exists tocar_atualizado_em on public.%I', t);
    execute format('create trigger tocar_atualizado_em before update on public.%I
                    for each row execute function public.tocar_atualizado_em()', t);
  end loop;
end $$;

-- 4.2 CNPJ sempre gravado limpo (só letras/números, maiúsculas)
create or replace function public.normalizar_cnpj()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.cnpj is not null then
    new.cnpj := public.cnpj_limpo(new.cnpj);
  end if;
  return new;
end;
$$;

drop trigger if exists normalizar_cnpj on public.empresas;
create trigger normalizar_cnpj before insert or update of cnpj on public.empresas
  for each row execute function public.normalizar_cnpj();

drop trigger if exists normalizar_cnpj on public.organizacoes;
create trigger normalizar_cnpj before insert or update of cnpj on public.organizacoes
  for each row execute function public.normalizar_cnpj();

-- 4.3 Nova organização: quem criou vira "dono" e o Kanban ganha etapas padrão
create or replace function public.ao_criar_organizacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.criado_por is not null then
    insert into public.membros (organizacao_id, user_id, papel)
    values (new.id, new.criado_por, 'dono')
    on conflict do nothing;
  end if;

  insert into public.kanban_etapas (organizacao_id, nome, cor, posicao, tipo) values
    (new.id, 'Triagem',                '#64748b', 1, 'aberta'),
    (new.id, 'Análise do edital',      '#3b82f6', 2, 'aberta'),
    (new.id, 'Proposta em preparo',    '#8b5cf6', 3, 'aberta'),
    (new.id, 'Em disputa',             '#f59e0b', 4, 'aberta'),
    (new.id, 'Habilitação / recursos', '#06b6d4', 5, 'aberta'),
    (new.id, 'Ganha',                  '#22c55e', 6, 'ganha'),
    (new.id, 'Perdida / desistência',  '#ef4444', 7, 'perdida');
  return new;
end;
$$;

drop trigger if exists ao_criar_organizacao on public.organizacoes;
create trigger ao_criar_organizacao after insert on public.organizacoes
  for each row execute function public.ao_criar_organizacao();

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

-- 4.5 Exclusão de conta (direito de eliminação - LGPD): organizações em que a
-- pessoa era a única participante são apagadas com todos os dados; nas demais,
-- se ela era a única dona, outro membro é promovido a dono.
create or replace function public.ao_excluir_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select m.organizacao_id from public.membros m
    where m.user_id = old.id and m.papel = 'dono'
  loop
    if not exists (select 1 from public.membros x
                   where x.organizacao_id = r.organizacao_id and x.user_id <> old.id) then
      delete from public.organizacoes where id = r.organizacao_id;
    elsif not exists (select 1 from public.membros x
                      where x.organizacao_id = r.organizacao_id
                        and x.user_id <> old.id and x.papel = 'dono') then
      update public.membros set papel = 'dono'
      where organizacao_id = r.organizacao_id
        and user_id = (select x.user_id from public.membros x
                       where x.organizacao_id = r.organizacao_id and x.user_id <> old.id
                       order by (x.papel = 'admin') desc, x.criado_em
                       limit 1);
    end if;
  end loop;
  return old;
end;
$$;

drop trigger if exists ao_excluir_usuario on auth.users;
create trigger ao_excluir_usuario before delete on auth.users
  for each row execute function public.ao_excluir_usuario();

-- 4.6 Toda organização precisa de pelo menos um dono (exceto quando a própria
-- organização ou o usuário estão sendo apagados).
create or replace function public.proteger_ultimo_dono()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- só interessa quando um dono sai ou deixa de ser dono
  if old.papel <> 'dono' or (tg_op = 'UPDATE' and new.papel = 'dono') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if exists (select 1 from public.organizacoes o where o.id = old.organizacao_id)
     and exists (select 1 from auth.users u where u.id = old.user_id)
     and not exists (select 1 from public.membros m
                     where m.organizacao_id = old.organizacao_id
                       and m.papel = 'dono' and m.user_id <> old.user_id) then
    raise exception 'A organização precisa ter pelo menos um dono.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists proteger_ultimo_dono on public.membros;
create trigger proteger_ultimo_dono before update of papel or delete on public.membros
  for each row execute function public.proteger_ultimo_dono();

-- 4.7 Limite de empresas do plano
create or replace function public.verificar_limite_empresas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite int;
  v_total int;
begin
  select o.limite_empresas into v_limite from public.organizacoes o where o.id = new.organizacao_id;
  select count(*) into v_total from public.empresas e where e.organizacao_id = new.organizacao_id;
  if v_total >= coalesce(v_limite, 0) then
    raise exception 'Limite de % empresa(s) do plano atingido.', coalesce(v_limite, 0)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists verificar_limite_empresas on public.empresas;
create trigger verificar_limite_empresas before insert on public.empresas
  for each row execute function public.verificar_limite_empresas();

-- 4.8 Consistência dos cards: licitação visível para a organização e
-- responsável precisa ser membro da organização.
create or replace function public.validar_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_existe boolean;
begin
  select true, l.organizacao_id into v_existe, v_org
  from public.licitacoes l where l.id = new.licitacao_id;

  if v_existe and v_org is not null and v_org <> new.organizacao_id then
    raise exception 'A licitação informada pertence a outra organização.' using errcode = '23514';
  end if;

  if new.responsavel_id is not null and not exists (
    select 1 from public.membros m
    where m.organizacao_id = new.organizacao_id and m.user_id = new.responsavel_id
  ) then
    raise exception 'O responsável precisa ser membro da organização.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists validar_card on public.crm_cards;
create trigger validar_card before insert or update of licitacao_id, responsavel_id, organizacao_id
  on public.crm_cards for each row execute function public.validar_card();


-- -----------------------------------------------------------------------------
-- 5. Segurança: Row Level Security (RLS) e permissões por coluna
-- -----------------------------------------------------------------------------
alter table public.organizacoes     enable row level security;
alter table public.perfis           enable row level security;
alter table public.membros          enable row level security;
alter table public.empresas         enable row level security;
alter table public.licitacoes       enable row level security;
alter table public.licitacao_itens  enable row level security;
alter table public.favoritos        enable row level security;
alter table public.licitacao_observacoes enable row level security;
alter table public.kanban_etapas    enable row level security;
alter table public.crm_cards        enable row level security;
alter table public.analises_edital  enable row level security;
alter table public.consentimentos   enable row level security;
alter table public.sync_execucoes   enable row level security;
alter table public.assinaturas      enable row level security;
alter table public.documentos       enable row level security;
alter table public.propostas        enable row level security;
alter table public.radares          enable row level security;
alter table public.eventos          enable row level security;
alter table public.monitoramentos   enable row level security;

-- Permissões básicas. O Supabase costuma concedê-las sozinho a toda tabela
-- nova, mas aqui ficam explícitas para o esquema funcionar em qualquer projeto.
-- Só as tabelas do LicitaHub são tocadas: tabelas de outros sistemas no mesmo
-- projeto continuam como estão.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on
  public.organizacoes, public.perfis, public.membros, public.empresas,
  public.licitacoes, public.licitacao_itens, public.favoritos, public.licitacao_observacoes, public.kanban_etapas,
  public.crm_cards, public.analises_edital, public.consentimentos, public.sync_execucoes,
  public.assinaturas, public.documentos, public.propostas, public.radares, public.eventos,
  public.monitoramentos
  to authenticated, service_role;
grant execute on function
  public.cnpj_limpo(text), public.cnpj_valido(text), public.uuid_ou_nulo(text),
  public.eh_membro(uuid), public.tem_papel(uuid, text[]), public.compartilha_organizacao(uuid)
  to authenticated, service_role;

-- Nada é acessível sem login. Os sincronizadores e o servidor de IA usam a
-- chave service_role, que ignora o RLS e NUNCA pode ir para o navegador.
revoke all on
  public.organizacoes, public.perfis, public.membros, public.empresas,
  public.licitacoes, public.licitacao_itens, public.favoritos, public.licitacao_observacoes, public.kanban_etapas,
  public.crm_cards, public.analises_edital, public.consentimentos, public.sync_execucoes,
  public.assinaturas, public.documentos, public.propostas, public.radares, public.eventos,
  public.monitoramentos
  from anon;

-- Colunas que o usuário NÃO pode alterar diretamente (plano, limites,
-- registros internos). Permissões finas por coluna:
revoke insert, update on public.organizacoes from authenticated;
grant  update (nome, cnpj) on public.organizacoes to authenticated;

revoke insert, update on public.perfis from authenticated;
grant  update (nome, telefone, avatar_url, organizacao_padrao_id) on public.perfis to authenticated;

revoke insert, update on public.membros from authenticated;
grant  update (papel) on public.membros to authenticated;

revoke insert, update, delete on public.licitacao_itens from authenticated;
revoke insert, update on public.analises_edital from authenticated;
revoke update, delete on public.consentimentos from authenticated;
revoke all on public.sync_execucoes from authenticated;
revoke insert, update, delete on public.assinaturas from authenticated;

-- 5.1 organizacoes
drop policy if exists organizacoes_ver on public.organizacoes;
create policy organizacoes_ver on public.organizacoes for select to authenticated
  using (public.eh_membro(id));

drop policy if exists organizacoes_editar on public.organizacoes;
create policy organizacoes_editar on public.organizacoes for update to authenticated
  using (public.tem_papel(id, array['dono', 'admin']))
  with check (public.tem_papel(id, array['dono', 'admin']));

drop policy if exists organizacoes_excluir on public.organizacoes;
create policy organizacoes_excluir on public.organizacoes for delete to authenticated
  using (public.tem_papel(id, array['dono']));

-- 5.2 perfis
drop policy if exists perfis_ver on public.perfis;
create policy perfis_ver on public.perfis for select to authenticated
  using (id = (select auth.uid()) or public.compartilha_organizacao(id));

drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid())
              and (organizacao_padrao_id is null or public.eh_membro(organizacao_padrao_id)));

-- 5.3 membros (convites entram pelo servidor; aqui só ver, mudar papel e sair)
drop policy if exists membros_ver on public.membros;
create policy membros_ver on public.membros for select to authenticated
  using (public.eh_membro(organizacao_id));

drop policy if exists membros_mudar_papel on public.membros;
create policy membros_mudar_papel on public.membros for update to authenticated
  using (public.tem_papel(organizacao_id, array['dono']))
  with check (public.tem_papel(organizacao_id, array['dono']));

drop policy if exists membros_remover on public.membros;
create policy membros_remover on public.membros for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.tem_papel(organizacao_id, array['dono'])
    or (papel <> 'dono' and public.tem_papel(organizacao_id, array['admin']))
  );

-- 5.4 empresas
drop policy if exists empresas_ver on public.empresas;
create policy empresas_ver on public.empresas for select to authenticated
  using (public.eh_membro(organizacao_id));

drop policy if exists empresas_criar on public.empresas;
create policy empresas_criar on public.empresas for insert to authenticated
  with check (public.eh_membro(organizacao_id));

drop policy if exists empresas_editar on public.empresas;
create policy empresas_editar on public.empresas for update to authenticated
  using (public.eh_membro(organizacao_id))
  with check (public.eh_membro(organizacao_id));

drop policy if exists empresas_excluir on public.empresas;
create policy empresas_excluir on public.empresas for delete to authenticated
  using (public.tem_papel(organizacao_id, array['dono', 'admin']));

-- 5.5 licitacoes (catálogo PNCP: só leitura; manuais: CRUD pela organização)
drop policy if exists licitacoes_ver on public.licitacoes;
create policy licitacoes_ver on public.licitacoes for select to authenticated
  using (organizacao_id is null or public.eh_membro(organizacao_id));

drop policy if exists licitacoes_criar_manual on public.licitacoes;
create policy licitacoes_criar_manual on public.licitacoes for insert to authenticated
  with check (fonte = 'manual' and organizacao_id is not null and public.eh_membro(organizacao_id));

drop policy if exists licitacoes_editar_manual on public.licitacoes;
create policy licitacoes_editar_manual on public.licitacoes for update to authenticated
  using (fonte = 'manual' and public.eh_membro(organizacao_id))
  with check (fonte = 'manual' and public.eh_membro(organizacao_id));

drop policy if exists licitacoes_excluir_manual on public.licitacoes;
create policy licitacoes_excluir_manual on public.licitacoes for delete to authenticated
  using (fonte = 'manual' and public.eh_membro(organizacao_id));

-- 5.6 licitacao_itens (leitura acompanha a visibilidade da licitação)
drop policy if exists itens_ver on public.licitacao_itens;
create policy itens_ver on public.licitacao_itens for select to authenticated
  using (exists (select 1 from public.licitacoes l where l.id = licitacao_itens.licitacao_id));

-- 5.7 favoritos (somente os próprios)
drop policy if exists favoritos_proprios on public.favoritos;
create policy favoritos_proprios on public.favoritos for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.licitacoes l where l.id = favoritos.licitacao_id));

-- 5.7b observações (somente as próprias)
drop policy if exists observacoes_proprias on public.licitacao_observacoes;
create policy observacoes_proprias on public.licitacao_observacoes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.licitacoes l where l.id = licitacao_observacoes.licitacao_id));

-- 5.8 kanban_etapas
drop policy if exists etapas_ver on public.kanban_etapas;
create policy etapas_ver on public.kanban_etapas for select to authenticated
  using (public.eh_membro(organizacao_id));

drop policy if exists etapas_gerenciar on public.kanban_etapas;
create policy etapas_gerenciar on public.kanban_etapas for all to authenticated
  using (public.tem_papel(organizacao_id, array['dono', 'admin']))
  with check (public.tem_papel(organizacao_id, array['dono', 'admin']));

-- 5.9 crm_cards
drop policy if exists cards_membros on public.crm_cards;
create policy cards_membros on public.crm_cards for all to authenticated
  using (public.eh_membro(organizacao_id))
  with check (public.eh_membro(organizacao_id));

-- 5.10 analises_edital (gravação só pelo servidor de IA)
drop policy if exists analises_ver on public.analises_edital;
create policy analises_ver on public.analises_edital for select to authenticated
  using (public.eh_membro(organizacao_id));

drop policy if exists analises_excluir on public.analises_edital;
create policy analises_excluir on public.analises_edital for delete to authenticated
  using (public.tem_papel(organizacao_id, array['dono', 'admin'])
         or solicitado_por = (select auth.uid()));

-- 5.11 consentimentos (o próprio usuário registra e consulta)
drop policy if exists consentimentos_ver on public.consentimentos;
create policy consentimentos_ver on public.consentimentos for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists consentimentos_registrar on public.consentimentos;
create policy consentimentos_registrar on public.consentimentos for insert to authenticated
  with check (user_id = (select auth.uid()) and origem = 'app');

-- 5.14 a 5.18 documentos, propostas, radares, eventos e monitoramentos:
-- qualquer membro da organização vê e edita os da própria organização.
do $$
declare t text;
begin
  foreach t in array array['documentos', 'propostas', 'radares', 'eventos', 'monitoramentos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_membros', t);
    execute format('create policy %I on public.%I for all to authenticated
                    using (public.eh_membro(organizacao_id))
                    with check (public.eh_membro(organizacao_id))', t || '_membros', t);
  end loop;
end $$;

-- 5.12 sync_execucoes: sem políticas = invisível para usuários (só service_role).

-- 5.13 assinaturas: membros veem a da própria organização; gravação só pelo servidor.
drop policy if exists assinaturas_ver on public.assinaturas;
create policy assinaturas_ver on public.assinaturas for select to authenticated
  using (public.eh_membro(organizacao_id));


-- -----------------------------------------------------------------------------
-- 6. Funções chamadas pelo app (supabase.rpc)
-- -----------------------------------------------------------------------------

-- 6.0 Propostas: snapshot e numeração (atualizar-proposta-integridade.sql)
-- 1. extras passa a guardar o snapshot da empresa (com o logo): limite maior.
alter table public.propostas drop constraint if exists propostas_extras_tamanho;
alter table public.propostas add constraint propostas_extras_tamanho
  check (jsonb_typeof(extras) = 'object' and pg_column_size(extras) <= 393216);

-- 2. Último número usado por organização e ano (não volta quando se exclui).
create table if not exists public.proposta_numeros (
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  ano            int  not null,
  ultimo         int  not null,
  primary key (organizacao_id, ano)
);
alter table public.proposta_numeros enable row level security; -- sem políticas: só a função usa
revoke all on public.proposta_numeros from anon, authenticated;

create or replace function public.proximo_numero_proposta(p_org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ano int := extract(year from now() at time zone 'America/Sao_Paulo')::int;
  v_maior int;
  v_n int;
begin
  if not public.eh_membro(p_org) then
    raise exception 'Sem permissão nesta organização.' using errcode = '42501';
  end if;
  select coalesce(max(substring(numero from '^PROP-\d{4}-(\d{1,9})$')::int), 0) into v_maior
    from public.propostas
   where organizacao_id = p_org and numero ~ ('^PROP-' || v_ano || '-\d{1,9}$');
  insert into public.proposta_numeros as n (organizacao_id, ano, ultimo)
  values (p_org, v_ano, v_maior + 1)
  on conflict (organizacao_id, ano) do update set ultimo = greatest(n.ultimo, v_maior) + 1
  returning n.ultimo into v_n;
  return 'PROP-' || v_ano || '-' || case when v_n < 1000 then lpad(v_n::text, 3, '0') else v_n::text end;
end $$;
revoke all on function public.proximo_numero_proposta(uuid) from public, anon;
grant execute on function public.proximo_numero_proposta(uuid) to authenticated;

create unique index if not exists propostas_numero_unico on public.propostas (organizacao_id, numero);

-- 6.1 Criar uma nova organização (quem chama vira dono).
create or replace function public.criar_organizacao(p_nome text, p_cnpj text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'É preciso estar logado.' using errcode = '42501';
  end if;
  insert into public.organizacoes (nome, cnpj, criado_por)
  values (btrim(p_nome), nullif(btrim(coalesce(p_cnpj, '')), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- 6.2 Busca de licitações: filtros, total para paginação e busca RIGOROSA por palavra.
--   supabase.rpc('buscar_licitacoes', { p_termo: 'copo, papel A4', p_ufs: ['SP'],
--     p_municipios: ['Campinas'], p_tipo: 'material', p_limite: 20, p_offset: 0 })
-- Palavra-chave (p_termo):
--   - vírgula separa alternativas ("copo, papel A4" = copo OU papel A4);
--   - dentro de cada alternativa, TODAS as palavras precisam aparecer;
--   - cada palavra casa com o começo de uma palavra do texto, sem acento nem
--     maiúscula ("copo" acha "copos", mas não "copa"; "a4" acha "A4");
--   - o texto conferido é o objeto da licitação e a descrição dos itens já baixados.
-- Tipo (p_tipo): 'material' tira o que é claramente serviço; 'servico' tira o que é
--   claramente compra de material. A classificação vem do texto do objeto (o PNCP
--   não informa a natureza da compra inteira, só a de cada item).
-- Plataforma: p_plataformas = padrões ilike do sistema de origem; p_plataforma_outros
--   inclui também as que não casam com nenhum padrão de p_plataformas_conhecidas.
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int);
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[]);

create or replace function public.tipo_objeto(p_objeto text)
returns text
language sql
stable
set search_path = ''
as $$
  with t as (select lower(extensions.unaccent(coalesce(p_objeto, ''))) as x)
  select case
    when (x ~ '\m(prestacao de servico|servicos? (de|continuad|comum|tecnic|especializad|terceirizad|grafic|medic|odontolog|laborator)|contratacao de (empresa )?(especializada )?(para )?(a )?(prestacao|execucao|realizacao|manutencao|locacao|organizacao)|manutencao|locacao|obras?\M|reforma|construcao|pavimentacao|consultoria|assessoria|vigilancia|limpeza e conservacao|transporte escolar|coleta de residuos|recapeamento|engenharia)')
         and not (x ~ '\m(aquisic|fornecimento de (materia|produto|equipament|genero|insumo|medicament)|compra de)')
      then 'servico'
    when x ~ '\m(aquisic|fornecimento|compra de|materia(l|is)|produtos?|equipamentos?|generos? alimenticios|medicamentos?|insumos?|mobiliario|veiculos?)'
         and not (x ~ '\m(prestacao de servico|contratacao de (empresa )?(especializada )?(para )?(a )?(prestacao|execucao))')
      then 'material'
    else 'misto'
  end from t;
$$;

drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]);
create or replace function public.buscar_licitacoes(
  p_termo                  text        default null,
  p_ufs                    text[]      default null,
  p_modalidades            int[]       default null,
  p_valor_min              numeric     default null,
  p_valor_max              numeric     default null,
  p_encerramento_ate       timestamptz default null,
  p_somente_abertas        boolean     default true,
  p_ordem                  text        default 'relevancia',  -- relevancia | prazo | valor | recentes
  p_limite                 int         default 20,
  p_offset                 int         default 0,
  p_municipios             text[]      default null,
  p_tipo                   text        default null,          -- null | material | servico
  p_encerramento_de        timestamptz default null,
  p_orgao                  text        default null,
  p_plataformas            text[]      default null,
  p_plataforma_outros      boolean     default false,
  p_plataformas_conhecidas text[]      default null
)
returns table (
  id                          bigint,
  fonte                       text,
  numero_controle_pncp        text,
  objeto                      text,
  orgao_razao_social          text,
  uf                          text,
  municipio                   text,
  modalidade_id               smallint,
  modalidade_nome             text,
  situacao_nome               text,
  valor_estimado              numeric,
  srp                         boolean,
  data_publicacao             timestamptz,
  data_abertura_proposta      timestamptz,
  data_encerramento_proposta  timestamptz,
  sistema_origem              text,
  link_sistema_origem         text,
  link_pncp                   text,
  relevancia                  real,
  tipo                        text,
  total                       bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with grupos as (
    -- cada alternativa (entre vírgulas) vira uma lista de padrões de palavra
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  consulta as (
    select (select count(*) from grupos) as n_grupos,
           case when nullif(btrim(coalesce(p_termo, '')), '') is null then null::tsquery
                else websearch_to_tsquery('public.portugues_sem_acento', regexp_replace(p_termo, '[[:space:]]*,[[:space:]]*', ' or ', 'g')) end as q
  ),
  base as (
    select l.*, lower(extensions.unaccent(
             coalesce(l.objeto, '') || ' ' ||
             coalesce((select string_agg(i.descricao, ' ') from public.licitacao_itens i where i.licitacao_id = l.id), '')
           )) as texto
    from public.licitacoes l
    where (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or lower(extensions.unaccent(coalesce(l.municipio, ''))) = any (
                select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
      and (p_valor_min is null or l.valor_estimado >= p_valor_min)
      and (p_valor_max is null or l.valor_estimado <= p_valor_max)
      and (not coalesce(p_somente_abertas, true) or l.data_encerramento_proposta >= now())
      and (p_encerramento_ate is null or l.data_encerramento_proposta <= p_encerramento_ate)
      and (p_encerramento_de is null or l.data_encerramento_proposta >= p_encerramento_de)
      and (nullif(btrim(coalesce(p_orgao, '')), '') is null
           or lower(extensions.unaccent(coalesce(l.orgao_razao_social, '') || ' ' || coalesce(l.unidade_nome, '')))
              like '%' || lower(extensions.unaccent(btrim(p_orgao))) || '%')
      and (((p_plataformas is null or cardinality(p_plataformas) = 0) and not coalesce(p_plataforma_outros, false))
           or l.sistema_origem ilike any (coalesce(p_plataformas, '{}'))
           or (coalesce(p_plataforma_outros, false)
               and (l.sistema_origem is null or not (l.sistema_origem ilike any (coalesce(p_plataformas_conhecidas, '{}'))))))
  ),
  filtrada as (
    select b.*, public.tipo_objeto(b.objeto) as tipo_calc
    from base b cross join consulta c
    where c.n_grupos = 0
       or exists (select 1 from grupos g where (select bool_and(b.texto ~ p) from unnest(g.padroes) as p))
  )
  select f.id, f.fonte, f.numero_controle_pncp, f.objeto, f.orgao_razao_social,
         f.uf, f.municipio, f.modalidade_id, f.modalidade_nome, f.situacao_nome,
         f.valor_estimado, f.srp, f.data_publicacao, f.data_abertura_proposta,
         f.data_encerramento_proposta, f.sistema_origem, f.link_sistema_origem, f.link_pncp,
         (case when c.q is null then 0 else ts_rank(f.busca, c.q) end)::real as relevancia,
         f.tipo_calc as tipo,
         count(*) over () as total
  from filtrada f cross join consulta c
  where p_tipo is null or p_tipo = ''
     or (p_tipo = 'material' and f.tipo_calc <> 'servico')
     or (p_tipo = 'servico'  and f.tipo_calc <> 'material')
  order by
    case when p_ordem = 'prazo'    then f.data_encerramento_proposta end asc  nulls last,
    case when p_ordem = 'valor'    then f.valor_estimado             end desc nulls last,
    case when p_ordem = 'recentes' then f.data_publicacao            end desc nulls last,
    relevancia desc,
    f.data_encerramento_proposta asc nulls last,
    f.id
  limit least(greatest(coalesce(p_limite, 20), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- 6.2b Radar: quantas licitações abertas há em cada município (para o mapa).
--   Mesmos filtros da busca, mais a data de abertura das propostas.
--   supabase.rpc('radar_contagem', { p_termo: 'cadeira or computador', p_ufs: ['SC'],
--     p_municipios: ['Braço do Trombudo', 'Rio do Sul'], p_abertura_de: '2026-11-01' })
create or replace function public.radar_contagem(
  p_termo        text   default null,
  p_ufs          text[] default null,
  p_municipios   text[] default null,
  p_modalidades  int[]  default null,
  p_abertura_de  date   default null,
  p_abertura_ate date   default null
)
returns table (uf text, municipio text, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Mesmas regras de palavra da buscar_licitacoes: "a or b" / "a, b" = alternativas;
  -- cada palavra casa com o começo de uma palavra do objeto ou dos itens (sem radical).
  with grupos as (
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  base as (
    select l.uf, l.municipio, lower(extensions.unaccent(
             coalesce(l.objeto, '') || ' ' ||
             coalesce((select string_agg(i.descricao, ' ') from public.licitacao_itens i where i.licitacao_id = l.id), '')
           )) as texto
    from public.licitacoes l
    where l.municipio is not null
      and l.data_encerramento_proposta >= now()
      and (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or lower(extensions.unaccent(l.municipio)) = any (
                select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
      and (p_abertura_de is null or l.data_abertura_proposta >= p_abertura_de::timestamptz)
      and (p_abertura_ate is null or l.data_abertura_proposta < (p_abertura_ate + 1)::timestamptz)
  )
  select b.uf, b.municipio, count(*) as total
  from base b
  where not exists (select 1 from grupos)
     or exists (select 1 from grupos g where (select bool_and(b.texto ~ p) from unnest(g.padroes) as p))
  group by b.uf, b.municipio
  order by total desc
  limit 5000;
$$;

-- 6.3 Exportação dos dados pessoais do usuário (LGPD, art. 18).
create or replace function public.exportar_meus_dados()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'gerado_em', now(),
    'usuario_id', (select auth.uid()),
    'perfil', (select to_jsonb(p) from public.perfis p where p.id = (select auth.uid())),
    'consentimentos', coalesce((select jsonb_agg(to_jsonb(c) order by c.criado_em)
                                from public.consentimentos c
                                where c.user_id = (select auth.uid())), '[]'::jsonb),
    'organizacoes', coalesce((select jsonb_agg(jsonb_build_object(
                                       'id', o.id, 'nome', o.nome, 'papel', m.papel,
                                       'desde', m.criado_em))
                              from public.membros m
                              join public.organizacoes o on o.id = m.organizacao_id
                              where m.user_id = (select auth.uid())), '[]'::jsonb),
    'favoritos', coalesce((select jsonb_agg(to_jsonb(f))
                           from public.favoritos f
                           where f.user_id = (select auth.uid())), '[]'::jsonb)
  );
$$;

-- 6.4 Limpeza do catálogo (uso do sincronizador): apaga licitações do PNCP
-- encerradas há mais de N dias que ninguém acompanha. Mantém o banco pequeno.
create or replace function public.limpar_licitacoes_antigas(p_dias int default 90)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
begin
  delete from public.licitacoes l
  where l.fonte = 'pncp'
    and coalesce(l.data_encerramento_proposta, l.data_publicacao, l.criado_em)
        < now() - make_interval(days => greatest(p_dias, 1))
    and not exists (select 1 from public.crm_cards c       where c.licitacao_id = l.id)
    and not exists (select 1 from public.favoritos f       where f.licitacao_id = l.id)
    and not exists (select 1 from public.analises_edital a where a.licitacao_id = l.id);
  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

-- Funções internas não podem ser chamadas pelo navegador.
revoke execute on function public.limpar_licitacoes_antigas(int) from public, anon, authenticated;
revoke execute on function public.ao_criar_usuario() from public, anon, authenticated;
revoke execute on function public.robo_conferir_lance() from public, anon, authenticated;
revoke execute on function public.ao_excluir_usuario() from public, anon, authenticated;
revoke execute on function public.criar_organizacao(text, text) from public, anon;
revoke execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) from public, anon;
revoke execute on function public.radar_contagem(text, text[], text[], int[], date, date) from public, anon;
revoke execute on function public.exportar_meus_dados() from public, anon;
grant execute on function public.limpar_licitacoes_antigas(int) to service_role;
grant execute on function public.criar_organizacao(text, text) to authenticated;
grant execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) to authenticated, service_role;
grant execute on function public.tipo_objeto(text) to authenticated, service_role;
grant execute on function public.radar_contagem(text, text[], text[], int[], date, date) to authenticated, service_role;
grant execute on function public.exportar_meus_dados() to authenticated;

-- 6.4b CAPAG (Capacidade de Pagamento - Tesouro Nacional): cache das notas oficiais.
-- Chave: IBGE (7 dígitos) do município ou "UF-SP". Leitura pública; só o servidor grava.
create table if not exists public.capag (
  chave         text primary key check (chave ~ '^(\d{7}|UF-[A-Z]{2})$'),
  nota          text not null check (nota ~ '^[ABCD]\+?$'),
  fonte         text,
  atualizado_em timestamptz not null default now()
);
alter table public.capag enable row level security;
drop policy if exists capag_leitura on public.capag;
create policy capag_leitura on public.capag for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.capag from anon, authenticated;
grant select on public.capag to anon, authenticated;


-- 6.5 Visões prontas para o front-end (respeitam o RLS de quem consulta).
create or replace view public.vw_crm_cards with (security_invoker = true) as
select
  c.id, c.organizacao_id, c.empresa_id, c.licitacao_id, c.etapa_id, c.posicao,
  c.responsavel_id, c.prioridade, c.valor_proposta, c.valor_ganho, c.prazo_interno,
  c.etiquetas, c.observacoes, c.arquivado, c.criado_em, c.atualizado_em,
  e.razao_social      as empresa_razao_social,
  e.cnpj              as empresa_cnpj,
  k.nome              as etapa_nome,
  k.tipo              as etapa_tipo,
  k.posicao           as etapa_posicao,
  l.fonte             as licitacao_fonte,
  l.objeto, l.orgao_razao_social, l.uf, l.municipio, l.modalidade_nome,
  l.valor_estimado, l.data_abertura_proposta, l.data_encerramento_proposta,
  l.sistema_origem, l.link_sistema_origem, l.link_pncp
from public.crm_cards c
join public.empresas e       on e.id = c.empresa_id
join public.kanban_etapas k  on k.id = c.etapa_id
join public.licitacoes l     on l.id = c.licitacao_id;

create or replace view public.vw_consentimentos_atuais with (security_invoker = true) as
select distinct on (c.user_id, c.tipo)
  c.user_id, c.tipo, c.versao, c.aceito, c.criado_em
from public.consentimentos c
order by c.user_id, c.tipo, c.criado_em desc;

revoke all on public.vw_crm_cards, public.vw_consentimentos_atuais from anon;
grant select on public.vw_crm_cards, public.vw_consentimentos_atuais to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. Storage (PDFs de editais enviados pelos usuários) e tempo real
-- -----------------------------------------------------------------------------
-- Caminho dos arquivos: editais/<id-da-organizacao>/<nome>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('editais', 'editais', false, 20971520, array['application/pdf'])   -- 20 MB
on conflict (id) do nothing;

drop policy if exists "editais: membros leem" on storage.objects;
create policy "editais: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'editais'
         and public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1])));

drop policy if exists "editais: membros enviam" on storage.objects;
create policy "editais: membros enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'editais'
              and public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1])));

drop policy if exists "editais: membros apagam" on storage.objects;
create policy "editais: membros apagam" on storage.objects for delete to authenticated
  using (bucket_id = 'editais'
         and public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1])));

-- Documentos da empresa (certidões, balanço, atestados):
-- documentos/<id-da-organizacao>/<id-da-empresa>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760,                      -- 10 MB
        array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "documentos: membros leem" on storage.objects;
create policy "documentos: membros leem" on storage.objects for select to authenticated
  using (bucket_id = 'documentos'
         and public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1])));

drop policy if exists "documentos: membros enviam" on storage.objects;
create policy "documentos: membros enviam" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos'
              and public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1])));

drop policy if exists "documentos: membros apagam" on storage.objects;
create policy "documentos: membros apagam" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos'
         and public.eh_membro(public.uuid_ou_nulo((storage.foldername(name))[1])));

-- Tempo real: o front-end é avisado quando uma análise de edital termina.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime'
                       and schemaname = 'public' and tablename = 'analises_edital') then
    alter publication supabase_realtime add table public.analises_edital;
  end if;
end $$;

-- =============================================================================
-- Robô Turbo 2.0: MODO REAL (cofre de credenciais, sessões do worker, eventos ao vivo)
-- =============================================================================
-- Cofre de credenciais ---------------------------------------------------------
-- O segredo (senha ou certificado A1 + senha) chega aqui JÁ CIFRADO pelo servidor
-- (AES-256-GCM, chave CREDENCIAIS_CHAVE que existe só no servidor). O banco nunca
-- vê o segredo aberto. Sem políticas de RLS: só o servidor (service role) acessa;
-- a tela lista apenas os metadados pela API.
create table if not exists public.portal_credentials (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  portal            text not null,
  tipo              text not null check (tipo in ('senha', 'certificado')),
  login_mascarado   text check (login_mascarado is null or char_length(login_mascarado) <= 80),
  certificado_nome  text check (certificado_nome is null or char_length(certificado_nome) <= 200),
  segredo_cifrado   text not null check (char_length(segredo_cifrado) <= 200000),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  ultimo_uso_em     timestamptz,
  unique (user_id, portal)
);
-- Situação da credencial (atualizar-credencial-situacao.sql): gravada só pelo servidor.
alter table public.portal_credentials add column if not exists situacao text not null default 'nao_testada';
alter table public.portal_credentials add column if not exists situacao_detalhe text;
alter table public.portal_credentials add column if not exists situacao_em timestamptz;
alter table public.portal_credentials add column if not exists testado_em timestamptz;
alter table public.portal_credentials drop constraint if exists portal_credentials_situacao;
alter table public.portal_credentials add constraint portal_credentials_situacao
  check (situacao in ('nao_testada', 'aguardando_validacao', 'credencial_ok', 'bloqueada'));
alter table public.portal_credentials drop constraint if exists portal_credentials_portal;
alter table public.portal_credentials add constraint portal_credentials_portal check (portal in (
  'comprasnet', 'licitacoes-e', 'bbmnet', 'bnc', 'pcp', 'bll', 'licitanet', 'licitar', 'licitamais',
  'comprasbr', 'petronect', 'outros'));
alter table public.portal_credentials enable row level security;
revoke all on public.portal_credentials from anon, authenticated;
drop trigger if exists tocar_atualizado_em on public.portal_credentials;
create trigger tocar_atualizado_em before update on public.portal_credentials
  for each row execute function public.tocar_atualizado_em();

-- Item do robô ligado a um pregão real -----------------------------------------
alter table public.robo_itens add column if not exists pregao_ref text;
alter table public.robo_itens add column if not exists lote_ref text;
alter table public.robo_itens drop constraint if exists robo_itens_pregao_ref;
alter table public.robo_itens add constraint robo_itens_pregao_ref check (pregao_ref is null or char_length(pregao_ref) between 1 and 120);
alter table public.robo_itens drop constraint if exists robo_itens_lote_ref;
alter table public.robo_itens add constraint robo_itens_lote_ref check (lote_ref is null or char_length(lote_ref) between 1 and 40);

-- Sessões do worker -------------------------------------------------------------
create table if not exists public.robo_sessoes (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  robo_item_id    uuid not null references public.robo_itens (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  portal          text not null,
  pregao_ref      text not null check (char_length(pregao_ref) between 1 and 120),
  lote_ref        text check (lote_ref is null or char_length(lote_ref) between 1 and 40),
  -- "monitorar": só lê a sala. "lances": o robô envia lances de verdade.
  modo            text not null default 'monitorar' check (modo in ('monitorar', 'lances')),
  status          text not null default 'iniciando'
                  check (status in ('iniciando', 'conectado', 'pausado', 'erro', 'encerrada')),
  erro            text check (erro is null or char_length(erro) <= 1000),
  iniciado_em     timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  encerrado_em    timestamptz
);
create index if not exists robo_sessoes_item_idx on public.robo_sessoes (robo_item_id, iniciado_em desc);
alter table public.robo_sessoes enable row level security;
drop policy if exists robo_sessoes_membros_leem on public.robo_sessoes;
create policy robo_sessoes_membros_leem on public.robo_sessoes for select to authenticated
  using (public.eh_membro(organizacao_id));
-- Escrita só pelo servidor (service role).
revoke insert, update, delete on public.robo_sessoes from anon, authenticated;
drop trigger if exists tocar_atualizado_em on public.robo_sessoes;
create trigger tocar_atualizado_em before update on public.robo_sessoes
  for each row execute function public.tocar_atualizado_em();

-- Eventos ao vivo da sala ---------------------------------------------------------
create table if not exists public.auction_live_bids (
  id              bigint generated always as identity primary key,
  sessao_id       uuid not null references public.robo_sessoes (id) on delete cascade,
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  robo_item_id    uuid not null references public.robo_itens (id) on delete cascade,
  tipo            text not null check (tipo in ('lance', 'fase', 'mensagem', 'status', 'alerta')),
  autor           text check (autor is null or char_length(autor) <= 200),
  porte           text check (porte is null or porte in ('me', 'epp', 'demais', 'nos')),
  valor           numeric(18, 2) check (valor is null or valor > 0),
  fase            text check (fase is null or fase in ('aberta', 'prorrogacao', 'desempate', 'negociacao', 'habilitacao', 'encerrada')),
  texto           text check (texto is null or char_length(texto) <= 2000),
  criado_em       timestamptz not null default now()
);
create index if not exists auction_live_bids_item_idx on public.auction_live_bids (robo_item_id, id);
create index if not exists auction_live_bids_sessao_idx on public.auction_live_bids (sessao_id, id);
alter table public.auction_live_bids enable row level security;
drop policy if exists auction_live_bids_membros_leem on public.auction_live_bids;
create policy auction_live_bids_membros_leem on public.auction_live_bids for select to authenticated
  using (public.eh_membro(organizacao_id));
revoke insert, update, delete on public.auction_live_bids from anon, authenticated;

-- Tempo real: a tela recebe cada evento da sala e cada mudança da sessão.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'auction_live_bids') then
      alter publication supabase_realtime add table public.auction_live_bids;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'robo_sessoes') then
      alter publication supabase_realtime add table public.robo_sessoes;
    end if;
  end if;
end $$;


-- =============================================================================
-- Robô Turbo 2.0: camada preditiva (histórico, perfil de concorrentes, alertas)
-- =============================================================================
-- Fechamentos: uma linha por item disputado (real) ou homologação importada.
create table if not exists public.robo_historico (
  id               bigint generated always as identity primary key,
  organizacao_id   uuid not null references public.organizacoes (id) on delete cascade,
  robo_item_id     uuid references public.robo_itens (id) on delete set null,
  origem           text not null default 'disputa' check (origem in ('disputa', 'homologacao')),
  portal           text check (portal is null or char_length(portal) <= 40),
  descricao        text not null check (char_length(btrim(descricao)) between 1 and 300),
  teto             numeric(18, 2) not null check (teto > 0),
  preco_fechamento numeric(18, 2) not null check (preco_fechamento > 0),
  desagio_pct      numeric(7, 3) generated always as (round((1 - preco_fechamento / teto) * 100, 3)) stored,
  vencemos         boolean,
  lances           int check (lances is null or lances >= 0),
  encerrado_em     timestamptz not null default now()
);
create index if not exists robo_historico_org_idx on public.robo_historico (organizacao_id, encerrado_em desc);
alter table public.robo_historico enable row level security;
drop policy if exists robo_historico_membros_leem on public.robo_historico;
create policy robo_historico_membros_leem on public.robo_historico for select to authenticated
  using (public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.robo_historico from anon, authenticated;

-- Perfil acumulado por concorrente (o identificador é o CNPJ quando o portal mostra;
-- senão o apelido da sala, que só vale dentro daquele pregão).
create table if not exists public.robo_concorrentes (
  id                   bigint generated always as identity primary key,
  organizacao_id       uuid not null references public.organizacoes (id) on delete cascade,
  portal               text not null check (char_length(portal) <= 40),
  identificador        text not null check (char_length(identificador) between 1 and 200),
  cnpj                 text check (cnpj is null or cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  disputas             int not null default 0 check (disputas >= 0),
  lances               int not null default 0 check (lances >= 0),
  resposta_mediana_ms  int check (resposta_mediana_ms is null or resposta_mediana_ms >= 0),
  agressividade_pct    numeric(7, 3),
  perfil               text check (perfil is null or perfil in ('agressivo', 'moderado', 'passivo')),
  atualizado_em        timestamptz not null default now(),
  unique (organizacao_id, portal, identificador)
);
alter table public.robo_concorrentes enable row level security;
drop policy if exists robo_concorrentes_membros_leem on public.robo_concorrentes;
create policy robo_concorrentes_membros_leem on public.robo_concorrentes for select to authenticated
  using (public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.robo_concorrentes from anon, authenticated;

-- Alertas do robô por e-mail (o da conta). Cada pessoa escolhe se quer receber
-- (desligado até ela pedir).
alter table public.perfis add column if not exists alerta_email boolean not null default false;
alter table public.perfis drop column if exists alerta_whatsapp;
drop table if exists public.robo_alertas;
grant update (alerta_email) on public.perfis to authenticated;


-- Fim do esquema.


-- =============================================================================
-- 9. Inteligência de mercado e leitura automática (mesmo conteúdo de atualizar-inteligencia.sql)
-- Uso LicitaHub · Fase 1 da automação: base de INTELIGÊNCIA DE MERCADO e
-- leitura AUTOMÁTICA de editais por IA.
-- Pode rodar mais de uma vez (idempotente). Não apaga nem altera dados existentes.
--
-- Fonte dos dados de mercado: resultados HOMOLOGADOS publicados no PNCP
--   /api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{seq}/itens/{n}/resultados
-- O PNCP publica o VENCEDOR de cada item (CNPJ, porte, valor unitário homologado,
-- desconto). Perdedores e lances NÃO são públicos: esses só existem para as
-- disputas acompanhadas pelo Robô Turbo 2.0 (robo_historico / auction_live_bids).
-- =============================================================================

-- 1. Resultados homologados por item (dado público, igual para todos os clientes).
create table if not exists public.mercado_resultados (
  id                     bigint generated always as identity primary key,
  numero_controle_pncp   text not null,
  licitacao_id           bigint references public.licitacoes (id) on delete set null,
  orgao_cnpj             text,
  orgao_nome             text,
  uf                     text,
  municipio              text,
  modalidade_id          smallint,
  modalidade_nome        text,
  portal                 text,              -- sistema de origem (Compras.gov.br, BLL, BNC...)
  objeto                 text,
  item_numero            int not null,
  item_descricao         text,
  material_servico       text check (material_servico is null or material_servico in ('M', 'S')),
  unidade                text,
  quantidade             numeric(18, 4),
  valor_unit_estimado    numeric(18, 4),
  sequencial_resultado   int not null default 1,
  fornecedor_ni          text,              -- CNPJ (14, pode ter letras) ou CPF (11), sem pontuação
  fornecedor_nome        text,
  fornecedor_porte       text,              -- ME, EPP, Demais...
  quantidade_homologada  numeric(18, 4),
  valor_unit_homologado  numeric(18, 4),
  valor_total_homologado numeric(18, 2),
  desconto_pct           numeric(9, 3) generated always as (
    case when valor_unit_estimado > 0 and valor_unit_homologado > 0
         then round((1 - valor_unit_homologado / valor_unit_estimado) * 100, 3) end
  ) stored,
  data_resultado         date,
  coletado_em            timestamptz not null default now(),
  unique (numero_controle_pncp, item_numero, sequencial_resultado)
);
create index if not exists mercado_resultados_fornecedor_idx on public.mercado_resultados (fornecedor_ni);
create index if not exists mercado_resultados_uf_idx         on public.mercado_resultados (uf, data_resultado desc);
create index if not exists mercado_resultados_orgao_idx      on public.mercado_resultados (orgao_cnpj);
create index if not exists mercado_resultados_data_idx       on public.mercado_resultados (data_resultado desc);

alter table public.mercado_resultados enable row level security;
drop policy if exists mercado_resultados_leitura on public.mercado_resultados;
create policy mercado_resultados_leitura on public.mercado_resultados for select to authenticated using (true);
revoke insert, update, delete, truncate on public.mercado_resultados from anon, authenticated;
grant select on public.mercado_resultados to authenticated;

-- 2. Controle da coleta: quais compras já foram consultadas e quando tentar de novo.
create table if not exists public.mercado_coleta (
  numero_controle_pncp  text primary key,
  licitacao_id          bigint references public.licitacoes (id) on delete set null,
  situacao              text not null default 'pendente'
                          check (situacao in ('pendente', 'ok', 'sem_resultado', 'erro', 'desistiu')),
  itens                 int,
  resultados            int,
  tentativas            int not null default 0,
  erro                  text,
  proxima_em            timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists mercado_coleta_proxima_idx on public.mercado_coleta (situacao, proxima_em);
alter table public.mercado_coleta enable row level security;  -- sem políticas: só o servidor (service role)
revoke all on public.mercado_coleta from anon, authenticated;

-- 3. Leitura automática de editais por IA (liga/desliga por organização).
alter table public.organizacoes add column if not exists ia_automatica boolean not null default false;
grant update (ia_automatica) on public.organizacoes to authenticated;
-- quem pode mudar: dono/admin (a política de update de organizacoes já restringe).

-- Análise feita pelo robô de leitura automática (sem pessoa que pediu).
alter table public.analises_edital add column if not exists automatica boolean not null default false;

-- 4. Consultas de inteligência (rodam com a permissão de quem consulta).

-- 4.1 Concorrentes: por CNPJ (parcial, numérico ou alfanumérico) ou parte da razão social.
create or replace function public.mercado_concorrentes(p_busca text, p_limite int default 20)
returns table (
  fornecedor_ni     text,
  fornecedor_nome   text,
  fornecedor_porte  text,
  compras_vencidas  bigint,
  itens_vencidos    bigint,
  valor_total       numeric,
  desconto_medio    numeric,
  desconto_mediano  numeric,
  ufs               text[],
  orgaos            bigint,
  primeira          date,
  ultima            date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select regexp_replace(coalesce(p_busca, ''), '[^0-9]', '', 'g') as digitos,
           upper(regexp_replace(coalesce(p_busca, ''), '[^0-9A-Za-z]', '', 'g')) as codigo,
           lower(extensions.unaccent(btrim(coalesce(p_busca, '')))) as texto
  )
  select r.fornecedor_ni, max(r.fornecedor_nome), max(r.fornecedor_porte),
         count(distinct r.numero_controle_pncp), count(*),
         round(sum(r.valor_total_homologado), 2),
         round(avg(r.desconto_pct) filter (where r.desconto_pct between -50 and 100), 2),
         round((percentile_cont(0.5) within group (order by r.desconto_pct)
                filter (where r.desconto_pct between -50 and 100))::numeric, 2),
         array_agg(distinct r.uf) filter (where r.uf is not null),
         count(distinct r.orgao_cnpj),
         min(r.data_resultado), max(r.data_resultado)
  from public.mercado_resultados r cross join b
  where r.fornecedor_ni is not null
    and ((length(b.digitos) >= 8 and r.fornecedor_ni like b.digitos || '%')
         or (length(b.codigo) between 8 and 14 and b.codigo ~ '[0-9]' and r.fornecedor_ni like b.codigo || '%')
         or (length(b.texto) >= 3 and lower(extensions.unaccent(coalesce(r.fornecedor_nome, ''))) like '%' || b.texto || '%'))
  group by r.fornecedor_ni
  order by count(*) desc
  limit least(greatest(coalesce(p_limite, 20), 1), 100);
$$;

drop function if exists public.mercado_concorrente_itens(text, int);
-- 4.2 Histórico de um concorrente (itens vencidos, mais recentes primeiro).
create or replace function public.mercado_concorrente_itens(p_ni text, p_limite int default 100)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.data_resultado desc nulls last, r.id desc), '[]'::jsonb)
  from (select * from public.mercado_resultados
        where fornecedor_ni = upper(regexp_replace(coalesce(p_ni, ''), '[^0-9A-Za-z]', '', 'g'))
        order by data_resultado desc nulls last, id desc
        limit least(greatest(coalesce(p_limite, 100), 1), 500)) r;
$$;

-- 4.3 Preços praticados para um item/segmento (mesmas regras de palavra da busca:
--     vírgula ou "or" = alternativas; cada palavra casa com o começo de uma palavra).
create or replace function public.mercado_precos(
  p_termo  text,
  p_ufs    text[] default null,
  p_unidade text  default null,
  p_desde  date   default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with grupos as (
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  base as (
    select r.*
    from public.mercado_resultados r
    where exists (select 1 from grupos)
      and r.valor_unit_homologado > 0
      and (p_ufs is null or cardinality(p_ufs) = 0 or r.uf = any (p_ufs))
      and (p_unidade is null or p_unidade = '' or lower(extensions.unaccent(coalesce(r.unidade, ''))) like lower(extensions.unaccent(p_unidade)) || '%')
      and (p_desde is null or r.data_resultado >= p_desde)
      and exists (select 1 from grupos g
                  where (select bool_and(lower(extensions.unaccent(coalesce(r.item_descricao, ''))) ~ p) from unnest(g.padroes) as p))
  ),
  fornecedores as (
    select fornecedor_ni, max(fornecedor_nome) as nome, count(*) as itens,
           round(avg(valor_unit_homologado), 2) as preco_medio
    from base where fornecedor_ni is not null
    group by fornecedor_ni order by count(*) desc limit 10
  )
  select jsonb_build_object(
    'amostras',          (select count(*) from base),
    'preco_min',         (select min(valor_unit_homologado) from base),
    'preco_p25',         (select percentile_cont(0.25) within group (order by valor_unit_homologado) from base),
    'preco_mediano',     (select percentile_cont(0.5)  within group (order by valor_unit_homologado) from base),
    'preco_p75',         (select percentile_cont(0.75) within group (order by valor_unit_homologado) from base),
    'preco_max',         (select max(valor_unit_homologado) from base),
    'desconto_medio',    (select round(avg(desconto_pct), 2) from base where desconto_pct between -50 and 100),
    'desconto_mediano',  (select round((percentile_cont(0.5) within group (order by desconto_pct))::numeric, 2) from base where desconto_pct between -50 and 100),
    'unidades',          (select jsonb_agg(u) from (select unidade as u from base where unidade is not null group by unidade order by count(*) desc limit 5) x),
    'fornecedores',      (select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) from fornecedores f),
    'recentes',          (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
                            select item_descricao, unidade, quantidade_homologada, valor_unit_estimado, valor_unit_homologado,
                                   desconto_pct, fornecedor_nome, fornecedor_ni, uf, municipio, orgao_nome, data_resultado, numero_controle_pncp
                            from base order by data_resultado desc nulls last limit 30) x)
  );
$$;

revoke execute on function public.mercado_concorrentes(text, int) from public, anon;
revoke execute on function public.mercado_concorrente_itens(text, int) from public, anon;
revoke execute on function public.mercado_precos(text, text[], text, date) from public, anon;
grant execute on function public.mercado_concorrentes(text, int) to authenticated, service_role;
grant execute on function public.mercado_concorrente_itens(text, int) to authenticated, service_role;
grant execute on function public.mercado_precos(text, text[], text, date) to authenticated, service_role;


-- =============================================================================
-- 10. Chat Unificado Multiportal (mesmo conteúdo de atualizar-chat.sql)
-- Uso LicitaHub · Chat Unificado Multiportal (Fase 1)
-- Caixa de entrada única das mensagens das salas de disputa, de qualquer portal
-- e de qualquer fonte (sessão do Robô Turbo 2.0 ou leitura pública do portal).
-- Idempotente; não apaga nem altera dados existentes.
-- =============================================================================

create table if not exists public.chat_mensagens (
  id              bigint generated always as identity primary key,
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  portal          text not null check (char_length(portal) between 1 and 40),     -- comprasnet, bll, bnc, pcp, bbmnet...
  compra_ref      text not null check (char_length(compra_ref) between 1 and 120), -- nº do pregão / chave da compra no portal
  licitacao_id    bigint references public.licitacoes (id) on delete set null,
  fonte           text not null default 'publica' check (fonte in ('publica', 'robo', 'manual')),
  autor           text check (autor is null or char_length(autor) <= 200),
  papel           text not null default 'outro' check (papel in ('pregoeiro', 'sistema', 'fornecedor', 'outro')),
  texto           text not null check (char_length(texto) between 1 and 4000),
  enviada_em      timestamptz not null default now(),
  hash            text not null,                    -- evita gravar a mesma mensagem duas vezes
  gatilhos        text[] not null default '{}',     -- mencao_cnpj, mencao_nome, convocacao, anexo, prazo, suspensao, resultado, palavra
  relevante       boolean not null default false,
  lida            boolean not null default false,
  alertada_em     timestamptz,
  criada_em       timestamptz not null default now(),
  unique (organizacao_id, portal, compra_ref, hash)
);
create index if not exists chat_mensagens_caixa_idx on public.chat_mensagens (organizacao_id, enviada_em desc);
create index if not exists chat_mensagens_relevantes_idx on public.chat_mensagens (organizacao_id, relevante, lida);

alter table public.chat_mensagens enable row level security;
drop policy if exists chat_mensagens_membros_leem on public.chat_mensagens;
create policy chat_mensagens_membros_leem on public.chat_mensagens for select to authenticated
  using (public.eh_membro(organizacao_id));
drop policy if exists chat_mensagens_membros_marcam on public.chat_mensagens;
create policy chat_mensagens_membros_marcam on public.chat_mensagens for update to authenticated
  using (public.eh_membro(organizacao_id)) with check (public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.chat_mensagens from anon, authenticated;
grant select on public.chat_mensagens to authenticated;
grant update (lida) on public.chat_mensagens to authenticated;   -- o navegador só marca como lida

-- Tempo real: a caixa de entrada recebe as mensagens novas sem recarregar.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_mensagens') then
    execute 'alter publication supabase_realtime add table public.chat_mensagens';
  end if;
end $$;

-- Configuração do monitoramento (tabela já existente): canais e nomes extras.
alter table public.monitoramentos add column if not exists webhook_url text
  check (webhook_url is null or (webhook_url ~ '^https://' and char_length(webhook_url) <= 500));
alter table public.monitoramentos add column if not exists nomes_alerta text[] not null default '{}';  -- outros nomes da empresa
alter table public.monitoramentos add column if not exists portais_publicos boolean not null default true; -- ler o chat público dos pregões cadastrados


-- =============================================================================
-- 11. Chat: alertas no celular (mesmo conteúdo de atualizar-chat-alertas.sql)
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

-- =============================================================================
-- Uso LicitaHub · Fase 3: inteligência de mercado ampliada.
-- Pode rodar mais de uma vez. Não apaga nem altera dados existentes.
--
--   1. Coleta RETROATIVA direcionada (12 meses): compras encerradas encontradas
--      pela busca do PNCP para as palavras dos radares dos clientes entram na fila
--      da coleta (mercado_coleta) mesmo sem estar no catálogo (que guarda 90 dias).
--   2. Pesquisa de Preço com a base real (mercado_pesquisa).
--   3. Painel do concorrente: evolução mês a mês e onde ele mais vence.
--   4. Trava de espaço: o servidor consulta o tamanho do banco antes de crescer.
--
-- Atas e contratos do PNCP foram avaliados e NÃO são gravados em massa:
-- ~9 mil contratos/dia (3,3 milhões/ano) não cabem no plano gratuito, e o preço por
-- item de uma ata é o próprio resultado homologado da compra, que já é coletado.
-- =============================================================================

-- 1. Fila da coleta guarda os dados mínimos da compra (para as retroativas, que não
--    estão em public.licitacoes).
alter table public.mercado_coleta add column if not exists origem            text not null default 'catalogo';
alter table public.mercado_coleta add column if not exists orgao_cnpj        text;
alter table public.mercado_coleta add column if not exists ano_compra        int;
alter table public.mercado_coleta add column if not exists sequencial_compra int;
alter table public.mercado_coleta add column if not exists orgao_nome        text;
alter table public.mercado_coleta add column if not exists uf                text;
alter table public.mercado_coleta add column if not exists municipio         text;
alter table public.mercado_coleta add column if not exists modalidade_nome   text;
alter table public.mercado_coleta add column if not exists portal            text;
alter table public.mercado_coleta add column if not exists objeto            text;
alter table public.mercado_coleta add column if not exists encerrada_em      timestamptz;
alter table public.mercado_coleta drop constraint if exists mercado_coleta_origem_ck;
alter table public.mercado_coleta add constraint mercado_coleta_origem_ck check (origem in ('catalogo', 'retro'));
create index if not exists mercado_coleta_retro_idx on public.mercado_coleta (origem, situacao, proxima_em);

-- Termos da coleta retroativa e até onde cada um já foi lido.
create table if not exists public.mercado_retro_termos (
  termo          text primary key,
  pagina         int not null default 0,          -- última página da busca já lida
  compras        int not null default 0,          -- compras enfileiradas por este termo
  concluido_em   timestamptz,                     -- leu tudo da janela; recomeça depois de 30 dias
  atualizado_em  timestamptz not null default now()
);
alter table public.mercado_retro_termos enable row level security;  -- só o servidor
revoke all on public.mercado_retro_termos from anon, authenticated;

create index if not exists mercado_resultados_fornecedor_data_idx on public.mercado_resultados (fornecedor_ni, data_resultado);

-- 2. Pesquisa de Preço: registros de um item (mesmas regras de palavra da busca).
create or replace function public.mercado_pesquisa(
  p_termo     text,
  p_ufs       text[] default null,
  p_municipio text   default null,
  p_meses     int    default 12,
  p_limite    int    default 300
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with grupos as (
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.data desc), '[]'::jsonb)
  from (
    select r.data_resultado as data, r.orgao_nome as orgao, r.uf, r.municipio,
           r.quantidade_homologada as quantidade, r.valor_unit_homologado as unitario,
           r.valor_unit_estimado as estimado, r.unidade, r.item_descricao as item,
           r.fornecedor_nome as fornecedor, r.fornecedor_ni, r.portal, r.numero_controle_pncp
    from public.mercado_resultados r
    where exists (select 1 from grupos)
      and r.valor_unit_homologado > 0
      and r.data_resultado >= (current_date - make_interval(months => least(greatest(coalesce(p_meses, 12), 1), 36)))
      and (p_ufs is null or cardinality(p_ufs) = 0 or r.uf = any (p_ufs))
      and (p_municipio is null or p_municipio = ''
           or lower(extensions.unaccent(coalesce(r.municipio, ''))) = lower(extensions.unaccent(p_municipio)))
      and exists (select 1 from grupos g
                  where (select bool_and(lower(extensions.unaccent(coalesce(r.item_descricao, ''))) ~ p) from unnest(g.padroes) as p))
    order by r.data_resultado desc nulls last
    limit least(greatest(coalesce(p_limite, 300), 1), 1000)
  ) x;
$$;

-- 3. Painel do concorrente: evolução mensal, órgãos e estados onde mais vence.
create or replace function public.mercado_concorrente_painel(p_ni text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select * from public.mercado_resultados
    where fornecedor_ni = upper(regexp_replace(coalesce(p_ni, ''), '[^0-9A-Za-z]', '', 'g'))
      and data_resultado >= current_date - interval '24 months'
  )
  select jsonb_build_object(
    'mensal', (select coalesce(jsonb_agg(to_jsonb(m) order by m.mes), '[]'::jsonb) from (
        select to_char(date_trunc('month', data_resultado), 'YYYY-MM') as mes,
               count(*) as itens, count(distinct numero_controle_pncp) as compras,
               round(sum(valor_total_homologado), 2) as valor,
               round((percentile_cont(0.5) within group (order by desconto_pct)
                      filter (where desconto_pct between -50 and 100))::numeric, 2) as desconto_mediano
        from r where data_resultado is not null group by 1) m),
    'orgaos', (select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from (
        select orgao_cnpj, max(orgao_nome) as orgao, max(uf) as uf, count(*) as itens,
               count(distinct numero_controle_pncp) as compras, round(sum(valor_total_homologado), 2) as valor
        from r group by orgao_cnpj order by count(distinct numero_controle_pncp) desc, sum(valor_total_homologado) desc nulls last limit 10) o),
    'ufs', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) from (
        select uf, count(*) as itens, round(sum(valor_total_homologado), 2) as valor
        from r where uf is not null group by uf order by count(*) desc limit 27) u),
    'portais', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (
        select coalesce(portal, 'Não informado') as portal, count(*) as itens
        from r group by 1 order by count(*) desc limit 8) p)
  );
$$;

revoke execute on function public.mercado_pesquisa(text, text[], text, int, int) from public, anon;
revoke execute on function public.mercado_concorrente_painel(text) from public, anon;
grant execute on function public.mercado_pesquisa(text, text[], text, int, int) to authenticated, service_role;
grant execute on function public.mercado_concorrente_painel(text) to authenticated, service_role;

-- 4. Tamanho do banco em MB (trava de espaço da coleta retroativa). Só o servidor.
create or replace function public.banco_tamanho_mb()
returns int
language sql
stable
security definer
set search_path = ''
as $$ select (pg_database_size(current_database()) / 1048576)::int; $$;
revoke execute on function public.banco_tamanho_mb() from public, anon, authenticated;
grant execute on function public.banco_tamanho_mb() to service_role;

-- =============================================================================
-- Uso LicitaHub · Aviso por e-mail de NOVOS editais dos radares.
-- Pode rodar mais de uma vez. Não apaga dados.
--
-- Uma vez por dia (RADAR_AVISO_CRON, padrão 7h de Brasília), o servidor procura as
-- licitações que ENTRARAM no catálogo desde o último aviso de cada radar ativo com
-- e-mail ligado e manda um resumo para quem criou o radar.
-- =============================================================================

-- Até quando cada radar já foi avisado (null = nunca; começa pela criação do radar).
alter table public.radares add column if not exists ultimo_aviso_em timestamptz;

-- Correção: a chave de origem só aceitava 'pncp' e 'manual'. Fontes novas dos coletores
-- (Diários Oficiais etc.) seguem a regra do PNCP: catálogo público, sem organização.
alter table public.licitacoes drop constraint if exists licitacoes_origem_ck;
alter table public.licitacoes add constraint licitacoes_origem_ck check (
     (fonte = 'pncp'   and organizacao_id is null and numero_controle_pncp is not null)
  or (fonte = 'manual' and organizacao_id is not null and numero_controle_pncp is null)
  or (fonte not in ('pncp', 'manual') and organizacao_id is null and external_id is not null)
);

-- Licitações novas de um radar: mesmas regras de palavra e local do mapa do Radar
-- (radar_contagem), só as que entraram no catálogo depois de p_desde e ainda abertas.
create or replace function public.radar_novidades(
  p_termo       text,
  p_ufs         text[],
  p_municipios  text[],
  p_modalidades int[],
  p_desde       timestamptz,
  p_limite      int default 10
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with grupos as (
    select g.n, array_agg('\m' || w) as padroes
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(g.txt, '[^a-z0-9]+') as w
    where w <> ''
    group by g.n
  ),
  base as (
    select l.id, l.objeto, l.orgao_razao_social, l.uf, l.municipio, l.modalidade_nome, l.valor_estimado,
           l.data_encerramento_proposta, l.link_pncp, l.criado_em,
           lower(extensions.unaccent(
             coalesce(l.objeto, '') || ' ' ||
             coalesce((select string_agg(i.descricao, ' ') from public.licitacao_itens i where i.licitacao_id = l.id), '')
           )) as texto
    from public.licitacoes l
    where l.criado_em > p_desde
      and l.data_encerramento_proposta >= now()
      and (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or lower(extensions.unaccent(l.municipio)) = any (
                select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
  ),
  achadas as (
    select b.* from base b
    where not exists (select 1 from grupos)
       or exists (select 1 from grupos g where (select bool_and(b.texto ~ p) from unnest(g.padroes) as p))
  )
  select jsonb_build_object(
    'total', (select count(*) from achadas),
    'itens', (select coalesce(jsonb_agg(to_jsonb(x) order by x.encerra_em), '[]'::jsonb) from (
        select id, objeto, orgao_razao_social as orgao, uf, municipio, modalidade_nome as modalidade,
               valor_estimado as valor, data_encerramento_proposta as encerra_em, link_pncp
        from achadas order by data_encerramento_proposta limit least(greatest(coalesce(p_limite, 10), 1), 50)) x)
  );
$$;

-- Para quem vai o aviso: quem criou o radar; se não houver, os donos da organização.
-- Só o servidor (lê auth.users).
create or replace function public.radar_destinatarios(p_radares uuid[])
returns table (radar_id uuid, email text, nome text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, u.email, coalesce(nullif(p.nome, ''), split_part(u.email, '@', 1))
  from public.radares r
  join lateral (
    select r.criado_por as uid where r.criado_por is not null
      and exists (select 1 from public.membros m where m.organizacao_id = r.organizacao_id and m.user_id = r.criado_por)
    union
    select m.user_id from public.membros m
    where m.organizacao_id = r.organizacao_id and m.papel = 'dono'
      and (r.criado_por is null or not exists (select 1 from public.membros x where x.organizacao_id = r.organizacao_id and x.user_id = r.criado_por))
  ) d on true
  join auth.users u on u.id = d.uid and u.email is not null
  left join public.perfis p on p.id = d.uid
  where r.id = any (p_radares);
$$;

revoke execute on function public.radar_novidades(text, text[], text[], int[], timestamptz, int) from public, anon, authenticated;
revoke execute on function public.radar_destinatarios(uuid[]) from public, anon, authenticated;
grant execute on function public.radar_novidades(text, text[], text[], int[], timestamptz, int) to service_role;
grant execute on function public.radar_destinatarios(uuid[]) to service_role;

-- =============================================================================
-- Uso LicitaHub · Busca em CAMADAS (pirâmide de relevância) + desempenho.
-- Pode rodar mais de uma vez. Não apaga dados.
--
-- Com termo, a busca não esconde mais nada: ordena em 4 camadas.
--   1 Exata ........ a frase inteira OU todas as palavras no OBJETO
--   2 Principal .... o termo principal (1ª palavra) no objeto, ou todas as palavras só
--                    nos campos secundários (itens, órgão)
--   3 Relacionada .. só as palavras secundárias, ou um termo relacionado (busca_correlatos)
--   4 Restante ..... todas as outras, com os mesmos filtros
-- Dentro da camada: nota (peso do campo: objeto > itens > órgão) e depois a ordem escolhida.
-- Comparação sem acento/maiúscula, pelo começo da palavra, com radical leve
-- (plural/singular): "copos descartáveis" ~ "copo descartável"; "copo" NÃO casa "copa".
-- Sem termo: igual a antes (sem camadas).
--
-- Desempenho: a ordenação roda na tabela enxuta licitacoes_busca (texto já normalizado e tipo
-- material/serviço já calculado); só as linhas da página são lidas na licitacoes larga
-- (antes: 6 a 18 s por busca no plano gratuito, por ler 27 mil linhas largas do disco).
-- =============================================================================

-- 1. Tabela ENXUTA de busca (~300 bytes por linha, contra ~2,8 KB da licitacoes):
--    a ordenação em camadas lê só ela; a linha completa é lida só para a página pedida.
--    Mantida por gatilho; mesma regra de acesso (RLS) da licitacoes.
-- (uma versão anterior desta migração pôs colunas na própria licitacoes: são retiradas)
drop trigger if exists licitacoes_normalizar on public.licitacoes;
drop function if exists public.licitacoes_normalizar();
alter table public.licitacoes drop column if exists objeto_norm;
alter table public.licitacoes drop column if exists orgao_norm;
alter table public.licitacoes drop column if exists tipo_calc;

create table if not exists public.licitacoes_busca (
  id              bigint primary key references public.licitacoes (id) on delete cascade,
  organizacao_id  uuid,
  encerramento    timestamptz,
  publicacao      timestamptz,
  uf              text,
  municipio_norm  text,
  modalidade_id   smallint,
  valor           numeric(18, 2),
  sistema_origem  text,
  tipo_calc       text,
  objeto_norm     text,
  orgao_norm      text
);
create index if not exists licitacoes_busca_encerramento_idx on public.licitacoes_busca (encerramento);
alter table public.licitacoes_busca enable row level security;
drop policy if exists licitacoes_busca_ver on public.licitacoes_busca;
create policy licitacoes_busca_ver on public.licitacoes_busca for select to authenticated
  using (organizacao_id is null or public.eh_membro(organizacao_id));
revoke insert, update, delete, truncate on public.licitacoes_busca from anon, authenticated;
grant select on public.licitacoes_busca to authenticated, service_role;

create or replace function public.licitacoes_busca_sincronizar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.licitacoes_busca as b (id, organizacao_id, encerramento, publicacao, uf, municipio_norm, modalidade_id, valor,
                                            sistema_origem, tipo_calc, objeto_norm, orgao_norm)
  values (new.id, new.organizacao_id, new.data_encerramento_proposta, new.data_publicacao, new.uf,
          lower(extensions.unaccent(coalesce(new.municipio, ''))), new.modalidade_id, new.valor_estimado, new.sistema_origem,
          public.tipo_objeto(new.objeto), lower(extensions.unaccent(coalesce(new.objeto, ''))),
          lower(extensions.unaccent(coalesce(new.orgao_razao_social, '') || ' ' || coalesce(new.unidade_nome, ''))))
  on conflict (id) do update set
    organizacao_id = excluded.organizacao_id, encerramento = excluded.encerramento, publicacao = excluded.publicacao,
    uf = excluded.uf, municipio_norm = excluded.municipio_norm, modalidade_id = excluded.modalidade_id, valor = excluded.valor,
    sistema_origem = excluded.sistema_origem, tipo_calc = excluded.tipo_calc, objeto_norm = excluded.objeto_norm,
    orgao_norm = excluded.orgao_norm;
  return null;
end $$;
revoke execute on function public.licitacoes_busca_sincronizar() from public, anon, authenticated;
drop trigger if exists licitacoes_busca_sincronizar on public.licitacoes;
create trigger licitacoes_busca_sincronizar after insert or update on public.licitacoes
  for each row execute function public.licitacoes_busca_sincronizar();

-- preenche o que já existe
insert into public.licitacoes_busca (id, organizacao_id, encerramento, publicacao, uf, municipio_norm, modalidade_id, valor,
                                     sistema_origem, tipo_calc, objeto_norm, orgao_norm)
select l.id, l.organizacao_id, l.data_encerramento_proposta, l.data_publicacao, l.uf,
       lower(extensions.unaccent(coalesce(l.municipio, ''))), l.modalidade_id, l.valor_estimado, l.sistema_origem,
       public.tipo_objeto(l.objeto), lower(extensions.unaccent(coalesce(l.objeto, ''))),
       lower(extensions.unaccent(coalesce(l.orgao_razao_social, '') || ' ' || coalesce(l.unidade_nome, '')))
from public.licitacoes l
on conflict (id) do nothing;

-- 2. Radical leve (plural/singular), aplicado à palavra BUSCADA; o texto casa pelo começo.
create or replace function public.radical_busca(p text)
returns text language sql immutable set search_path = '' as $$
  select case when length(r) >= 3 then r else p end
  from (select case
    when p ~ 'veis$'                       then regexp_replace(p, 'veis$', 've')
    when p ~ 'vel$'                        then regexp_replace(p, 'vel$', 've')
    when length(p) > 4 and p ~ '(oes|aes|aos)$' then left(p, length(p) - 3)
    when length(p) > 4 and p ~ 'ao$'       then left(p, length(p) - 2)
    when length(p) > 4 and p ~ '[ae]is$'   then left(p, length(p) - 2)
    when length(p) > 4 and p ~ '[ae]l$'    then left(p, length(p) - 1)
    when length(p) > 4 and p ~ '(r|z)es$'  then left(p, length(p) - 2)
    when length(p) > 3 and p ~ 's$'        then left(p, length(p) - 1)
    else p end as r) x;
$$;

-- 3. Termos relacionados (camada 3). Editável: insira/atualize linhas aqui, sem mudar código.
--    termo e correlatos sem acento e em minúsculas.
create table if not exists public.busca_correlatos (
  termo       text primary key check (termo = lower(termo)),
  correlatos  text[] not null default '{}'
);
alter table public.busca_correlatos enable row level security;
drop policy if exists busca_correlatos_leitura on public.busca_correlatos;
create policy busca_correlatos_leitura on public.busca_correlatos for select to authenticated using (true);
revoke insert, update, delete, truncate on public.busca_correlatos from anon, authenticated;
grant select on public.busca_correlatos to authenticated;
insert into public.busca_correlatos (termo, correlatos) values
  ('copo',        array['caneca', 'taca', 'xicara']),
  ('papel',       array['sulfite', 'resma']),
  ('computador',  array['notebook', 'desktop', 'microcomputador', 'estacao de trabalho']),
  ('caneta',      array['esferografica', 'marca texto']),
  ('limpeza',     array['higienizacao', 'conservacao', 'zeladoria']),
  ('combustivel', array['gasolina', 'diesel', 'etanol']),
  ('medicamento', array['farmaco', 'remedio']),
  ('pneu',        array['camara de ar']),
  ('toner',       array['cartucho', 'tinta para impressora'])
on conflict (termo) do nothing;

-- 4. Busca com camadas (mesmas entradas de antes; devolve também camada, nota e total da camada).
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]);
drop function if exists public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]);
create or replace function public.buscar_licitacoes(
  p_termo                  text        default null,
  p_ufs                    text[]      default null,
  p_modalidades            int[]       default null,
  p_valor_min              numeric     default null,
  p_valor_max              numeric     default null,
  p_encerramento_ate       timestamptz default null,
  p_somente_abertas        boolean     default true,
  p_ordem                  text        default 'relevancia',  -- relevancia | prazo | valor | recentes
  p_limite                 int         default 20,
  p_offset                 int         default 0,
  p_municipios             text[]      default null,
  p_tipo                   text        default null,          -- null | material | servico
  p_encerramento_de        timestamptz default null,
  p_orgao                  text        default null,
  p_plataformas            text[]      default null,
  p_plataforma_outros      boolean     default false,
  p_plataformas_conhecidas text[]      default null
)
returns table (
  id                          bigint,
  fonte                       text,
  numero_controle_pncp        text,
  objeto                      text,
  orgao_razao_social          text,
  uf                          text,
  municipio                   text,
  modalidade_id               smallint,
  modalidade_nome             text,
  situacao_nome               text,
  valor_estimado              numeric,
  srp                         boolean,
  data_publicacao             timestamptz,
  data_abertura_proposta      timestamptz,
  data_encerramento_proposta  timestamptz,
  sistema_origem              text,
  link_sistema_origem         text,
  link_pncp                   text,
  relevancia                  real,
  tipo                        text,
  total                       bigint,
  camada                      smallint,
  total_camada                bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with palavras as (
    -- alternativa n (entre vírgulas / "or"), posição k da palavra, radical
    select g.n, w.k, public.radical_busca(w.p) as r
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_termo, ''))), '[[:space:]]+or[[:space:]]+|,') with ordinality as g(txt, n)
    cross join lateral regexp_split_to_table(btrim(g.txt), '[^a-z0-9]+') with ordinality as w(p, k)
    where w.p <> ''
      -- palavras vazias não ordenam nada (e "de" casaria com quase tudo)
      and w.p not in ('de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com',
                      'a', 'o', 'as', 'os', 'um', 'uma', 'ao', 'aos', 'sem', 'sob', 'tipo')
  ),
  grupos as (
    select p.n,
           array_agg('\m' || p.r order by p.k) as padroes,                                        -- todas as palavras
           '\m' || string_agg(p.r, '[a-z0-9]*[^a-z0-9]+' order by p.k) as frase,                 -- frase em sequência
           (array_agg('\m' || p.r order by p.k))[1] as nucleo,                                    -- termo principal
           coalesce((array_agg('\m' || p.r order by p.k))[2:], '{}') as secundarias,
           coalesce((select array_agg('\m' || public.radical_busca(c2))
                     from public.busca_correlatos bc, unnest(bc.correlatos) as c2
                     where bc.termo = any (array_agg(p.r)) or public.radical_busca(bc.termo) = any (array_agg(p.r))), '{}') as correlatos
    from palavras p group by p.n
  ),
  qualquer as (
    select coalesce('(' || string_agg(distinct x, '|') || ')', '$^') as re
    from (select unnest(g.padroes || g.correlatos) as x from grupos g) y
  ),
  consulta as (
    select (select count(*) from grupos) as n_grupos
  ),
  base as (
    select l.id, l.encerramento, l.publicacao, l.valor, l.objeto_norm as obj,
           l.orgao_norm || ' ' || coalesce(it.txt, '') as sec, l.tipo_calc as tipo_c
    from public.licitacoes_busca l
    left join lateral (select lower(extensions.unaccent(string_agg(i.descricao, ' '))) as txt
                       from public.licitacao_itens i where i.licitacao_id = l.id) it on true
    where (p_ufs is null or cardinality(p_ufs) = 0 or l.uf = any (p_ufs))
      and (p_municipios is null or cardinality(p_municipios) = 0
           or l.municipio_norm = any (select lower(extensions.unaccent(btrim(m))) from unnest(p_municipios) as m))
      and (p_modalidades is null or cardinality(p_modalidades) = 0 or l.modalidade_id = any (p_modalidades))
      and (p_valor_min is null or l.valor >= p_valor_min)
      and (p_valor_max is null or l.valor <= p_valor_max)
      and (not coalesce(p_somente_abertas, true) or l.encerramento >= now())
      and (p_encerramento_ate is null or l.encerramento <= p_encerramento_ate)
      and (p_encerramento_de is null or l.encerramento >= p_encerramento_de)
      and (nullif(btrim(coalesce(p_orgao, '')), '') is null
           or l.orgao_norm like '%' || lower(extensions.unaccent(btrim(p_orgao))) || '%')
      and (((p_plataformas is null or cardinality(p_plataformas) = 0) and not coalesce(p_plataforma_outros, false))
           or l.sistema_origem ilike any (coalesce(p_plataformas, '{}'))
           or (coalesce(p_plataforma_outros, false)
               and (l.sistema_origem is null or not (l.sistema_origem ilike any (coalesce(p_plataformas_conhecidas, '{}'))))))
      and (p_tipo is null or p_tipo = ''
           or (p_tipo = 'material' and l.tipo_calc <> 'servico')
           or (p_tipo = 'servico'  and l.tipo_calc <> 'material'))
  ),
  pontuada as (
    -- melhor (camada, nota) entre as alternativas; sem termo = camada 0 (ordem normal)
    select b.*, coalesce(m.camada, case when c.n_grupos = 0 then 0 else 4 end)::smallint as camada_c, coalesce(m.nota, 0) as nota_c
    from base b cross join consulta c
    left join lateral (
      select x.camada, x.nota from grupos g
      cross join lateral (
        select
          (b.obj ~ g.frase) as frase_obj,
          (select bool_and(b.obj ~ p) from unnest(g.padroes) p) as todas_obj,
          (select bool_and((b.obj || ' ' || b.sec) ~ p) from unnest(g.padroes) p) as todas_qualquer,
          (b.obj ~ g.nucleo) as nucleo_obj,
          (b.sec ~ g.nucleo) as nucleo_sec,
          (select count(*) from unnest(g.secundarias) p where b.obj ~ p) as sec_obj,
          (select count(*) from unnest(g.secundarias) p where b.sec ~ p) as sec_sec,
          (select count(*) from unnest(g.correlatos) p where (b.obj || ' ' || b.sec) ~ p) as correl
      ) t
      cross join lateral (
        select case
          when t.frase_obj or t.todas_obj                         then 1
          when t.nucleo_obj or t.todas_qualquer or t.nucleo_sec   then 2
          when t.sec_obj > 0 or t.sec_sec > 0 or t.correl > 0     then 3
          else 4 end as camada,
          -- peso do campo dentro da camada: objeto 3 > itens/órgão 1
          (case when t.frase_obj then 3 else 0 end + case when t.todas_obj then 2 else 0 end
           + case when t.nucleo_obj then 3 else 0 end + case when t.todas_qualquer then 2 else 0 end
           + case when t.nucleo_sec then 1 else 0 end
           + 2 * t.sec_obj + t.sec_sec + 0.5 * t.correl)::real as nota
      ) x
      -- pré-filtro: sem NENHUMA palavra buscada (nem correlata) = camada 4 direto (1 comparação só)
      where (b.obj || ' ' || b.sec) ~ (select q.re from qualquer q)
      order by x.camada, x.nota desc limit 1
    ) m on true
  ),
  ordenada as (
    select f.id, f.nota_c as relevancia, f.tipo_c as tipo, f.camada_c as camada,
           count(*) over () as total,
           count(*) over (partition by f.camada_c) as total_camada,
           row_number() over (order by
             f.camada_c,                                                               -- pirâmide (0 = sem termo)
             case when p_ordem = 'prazo'    then f.encerramento end asc  nulls last,
             case when p_ordem = 'valor'    then f.valor        end desc nulls last,
             case when p_ordem = 'recentes' then f.publicacao   end desc nulls last,
             f.nota_c desc,
             f.encerramento asc nulls last,
             f.id) as pos                                                             -- desempate total: páginas estáveis
    from pontuada f
  ),
  pagina as (
    select * from ordenada o
    order by o.pos
    limit least(greatest(coalesce(p_limite, 20), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select l.id, l.fonte, l.numero_controle_pncp, l.objeto, l.orgao_razao_social,
         l.uf, l.municipio, l.modalidade_id, l.modalidade_nome, l.situacao_nome,
         l.valor_estimado, l.srp, l.data_publicacao, l.data_abertura_proposta,
         l.data_encerramento_proposta, l.sistema_origem, l.link_sistema_origem, l.link_pncp,
         p.relevancia::real, p.tipo, p.total, p.camada, p.total_camada
  from pagina p join public.licitacoes l on l.id = p.id
  order by p.pos;
$$;

revoke execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) from public, anon;
grant execute on function public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[], text, timestamptz, text, text[], boolean, text[]) to authenticated, service_role;
grant execute on function public.radical_busca(text) to authenticated, service_role;

-- =============================================================================
-- Uso LicitaHub · Conteúdo editável do site pelo modo ADM (textos, vídeos, fotos).
-- Pode rodar mais de uma vez. Não apaga dados.
--
-- Leitura e gravação SÓ pelo servidor (chave secreta): o site pega o conteúdo em
-- GET /api/site/conteudo e o ADM grava pelas rotas /api/adm/* (sessão ADM no servidor).
-- O navegador não acessa estas tabelas diretamente.
-- =============================================================================

create table if not exists public.site_textos (
  chave          text primary key check (chave ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  texto          text not null check (char_length(texto) <= 2000),
  atualizado_em  timestamptz not null default now()
);
alter table public.site_textos enable row level security;  -- sem políticas: só o servidor
revoke all on public.site_textos from anon, authenticated;

create table if not exists public.site_midias (
  chave          text primary key check (chave ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  tipo           text not null check (tipo in ('video', 'imagem', 'youtube', 'vimeo')),
  url            text not null check (url ~ '^https://'),
  caminho        text,              -- arquivo no bucket site-midia (null para YouTube/Vimeo)
  legenda        text check (legenda is null or char_length(legenda) <= 300),
  atualizado_em  timestamptz not null default now()
);
alter table public.site_midias enable row level security;  -- sem políticas: só o servidor
revoke all on public.site_midias from anon, authenticated;

-- Arquivos públicos do site (vídeo curto, foto, banner). Envio só com autorização
-- temporária gerada pelo servidor para a sessão ADM; leitura pública (é o site).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-midia', 'site-midia', true, 52428800,                         -- 50 MB
        array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;
