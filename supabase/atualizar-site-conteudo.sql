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
