# Coletores próprios de licitações

O módulo fica em `src/services/collectors/`. Ele é gratuito: usa só APIs públicas e roda no próprio servidor (Render ou VPS). Não depende de nenhuma plataforma paga de raspagem.

| Arquivo | Papel |
|---|---|
| `baseCollector.js` | Contrato de todo coletor: um gerador assíncrono `paginas()` que entrega uma página por vez. |
| `pncpCollector.js` | Coletor do PNCP. Modos `publicacao`, `atualizacao` (pega retificações) e `abertas`. Filtra por período, UF e modalidade, com paginação completa. Divide a busca por estado quando a consulta nacional falha. |
| `diarioOficialTemplate.js` | Modelo para Diários Oficiais e portais de prefeituras (não registrado). |
| `esquema.js` | Objeto padronizado (validado com zod) e conversão para a tabela `licitacoes`. |
| `http.js` | HTTP para fontes novas: intervalo mínimo, tempo limite, novas tentativas com espera exponencial e Retry-After. |
| `index.js` | Orquestrador: grava página a página em lotes, com uma execução por vez, e registra cada uma em `sync_execucoes`. |
| `cron.js` | Agendador cron de 5 campos, no horário de Brasília, sem dependência externa. |
| `log.js` | Logs em JSON, uma linha por evento: início, progresso, falhas por página e resumo. |

## Banco de dados
A migração é `supabase/atualizar-coletores.sql`. Ela já foi aplicada; as 58.594 linhas que existiam receberam `external_id`.

O catálogo continua sendo `public.licitacoes`, porque busca, radar e propostas já leem dela. A migração mudou isto:
- a coluna `fonte` aceita qualquer fonte, não só `pncp` e `manual`;
- colunas novas `external_id` e `url_edital`;
- chave única `(fonte, external_id)`.

O upsert usa essa chave, então uma retificação atualiza a mesma linha em vez de duplicar.

O JSON bruto **não** é gravado por padrão. Com `SCRAPER_GUARDAR_BRUTO=1`, ele só é gravado se tiver até 8 KB.

## Memória
O coletor guarda no máximo uma página do PNCP por vez (50 registros), e o upsert vai em lotes de `SCRAPER_LOTE`. Numa coleta real de SP, o processo inteiro ficou em cerca de 80 MB de RAM.

## Variáveis
| Variável | Padrão | O que faz |
|---|---|---|
| `ENABLE_SCRAPER_CRON` | `false` | Liga o agendamento. Ligado, ele substitui o `SYNC_INTERVALO_MIN`, para não coletar em dobro. |
| `SCRAPER_CRON_SCHEDULE` | `10 * * * *` | Expressão cron, no horário de Brasília. |
| `SCRAPER_TARGET_UFS` | vazio (todos) | Exemplo: `SP,MG,PR`. |
| `SCRAPER_FONTES` | `pncp` | Fontes ativas. |
| `SCRAPER_MODO` | `atualizacao` | `publicacao`, `atualizacao` ou `abertas`. |
| `SCRAPER_DIAS_ATRAS` | `1` | Tamanho da janela: de hoje − N dias até hoje. |
| `SCRAPER_MAX_PAGINAS` | `400` | Limite de páginas por modalidade e estado. |
| `SCRAPER_LOTE` | `50` | Linhas por upsert. |
| `SCRAPER_GUARDAR_BRUTO` | `0` | `1` grava o JSON bruto (só se for pequeno). |
| `SCRAPER_ADMIN_TOKEN` | vazio | Libera a rota de disparo manual. |
| `LOG_FORMATO` | `json` | `texto` para ler no terminal. |

O ritmo das consultas ao PNCP segue as variáveis que já existiam: `PNCP_INTERVALO_MS`, `PNCP_TIMEOUT_MS` e `PNCP_TENTATIVAS`.

## Disparo manual
- No terminal:
  - `npm run coletar -- --ufs=SP --desde=2026-11-01`
  - `npm run coletar:simular` (não grava)
- Pela API, com o token no cabeçalho `Authorization: Bearer <SCRAPER_ADMIN_TOKEN>`:
  - `POST /api/admin/coleta` com corpo opcional, por exemplo `{"ufs":["SP"],"desde":"2026-11-01","modo":"publicacao"}`. Responde 202 e roda em segundo plano; responde 409 se já houver uma coleta em andamento.
  - `GET /api/admin/coleta` mostra a coleta em andamento e o resumo da última.

## Plugar uma fonte nova
1. Copie `diarioOficialTemplate.js` e implemente `paginas()` e `normalizar()`. O `external_id` precisa ser estável.
2. Registre a classe em `COLETORES` (`index.js`).
3. Teste com `npm run coletar -- --fontes=<fonte> --simular --permitir-nao-validado`.
4. Só depois disso marque `static validado = true`.

Regras para qualquer fonte nova:
- respeitar o `robots.txt` e os termos de uso;
- nunca burlar captcha ou login;
- preferir API ou dados abertos (por exemplo, a API do Querido Diário) a raspar HTML.
