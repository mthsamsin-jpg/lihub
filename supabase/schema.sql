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
  fonte                       text not null default 'pncp' check (fonte in ('pncp', 'manual')),
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
  finalizado_em  timestamptz
);

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
  cnpj                 text check (cnpj is null or cnpj ~ '^\d{14}$'),
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
