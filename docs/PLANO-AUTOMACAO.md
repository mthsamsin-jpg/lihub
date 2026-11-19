# Plano: automação de ponta a ponta + inteligência de mercado

Atualizado em 19/11/2026. Base: Node.js 22 (Hono) no Render, Supabase (Postgres + Auth + Storage), Playwright para os portais.

## 1. O que já existe (mapa do repositório)

| Pilar | Já pronto | Onde |
|---|---|---|
| Captação | Sincronização incremental do PNCP (catálogo `licitacoes`), busca rigorosa, Radar, PNCP ao vivo, itens e documentos do PNCP | `src/pncp/*`, `supabase/atualizar-busca.sql` |
| Leitura por IA | Análise estruturada do edital (resumo, habilitação, prazos, critério, riscos, documentos, pontos de esclarecimento) com Gemini ou Claude, cota mensal por plano, reaproveitamento por hash | `src/ia/*`, tabela `analises_edital`, tela Leitor de Edital IA |
| Mercado/concorrentes | Histórico só das disputas do robô (`robo_historico`, `robo_concorrentes`, `auction_live_bids`); Pesquisa de Preço com dados **simulados** | `supabase/schema.sql`, `site/js/modulos/mercado.js` |
| Propostas | Gerador com cabeçalho editável, empresa, itens (Item/Qtd/Unid/Descrição/Marca/Valor), importação dos itens do PNCP, PDF e Word | `site/js/modulos/propostas.js`, tabela `propostas` |
| Robô de lances | Motor único navegador/servidor com travas (piso, margem mínima, decremento, intervalo, não cobrir o próprio lance, LC 123), cofre de credenciais cifrado, sessões Playwright, eventos e lances auditáveis | `site/js/robo-motor.js`, `worker/*`, `src/cofre.js`, tabelas `robo_*`, `portal_credentials` |
| Chat | Sessão real já recebe evento `mensagem` do pregoeiro; alertas por e-mail (Resend) | `worker/sessao.js`, `worker/notificacoes.js` |

**Lacunas principais:** nenhum seletor de portal validado numa sessão real; sem fila persistente (tudo roda no processo da API); dados de mercado reais inexistentes; sem envio automático de proposta; alertas só por e-mail.

## 2. Portal piloto

- **Dados (inteligência e captação): PNCP.** É oficial, gratuito, cobre todos os portais (a Lei 14.133 obriga a publicação) e traz o vencedor homologado de cada item.
- **Ação (proposta, lances, chat): BLL Compras.** Já tem adaptador próprio (login com teclado virtual mapeado) e é muito usada por municípios. Compras.gov.br fica em segundo: é o maior volume, mas tem anti-robô (403) e login gov.br com 2 fatores, mais caro de manter.

## 3. Fases

### MVP1: base de inteligência + leitura automática (ENTREGUE nesta etapa)
- Tabelas `mercado_resultados` (vencedor por item: CNPJ, porte, valor unitário estimado e homologado, desconto, órgão, UF, portal) e `mercado_coleta` (controle de reconsulta).
- Coletor `src/mercado/coletar.js`: a cada 30 min lê as compras encerradas do catálogo e grava os resultados que o PNCP já publicou; reconsulta com espera crescente (2, 4, 8... até 15 dias) e para depois de 8 tentativas.
- Consultas `mercado_concorrentes`, `mercado_concorrente_itens`, `mercado_precos` (faixa P25–P75, mediana, desconto mediano, quem mais vence), com as mesmas regras de palavra da busca.
- Tela **Inteligência de Mercado** (Preços de item / Concorrentes) e botão **Preço de referência** em cada item do Gerador de proposta, com "usar a mediana".
- **Leitura automática de editais**: opção por organização (`organizacoes.ia_automatica`); a IA lê sozinha os editais das licitações favoritas e do CRM ainda abertas, dentro da cota do plano.
- Variáveis: `MERCADO_INTERVALO_MIN` (padrão 30, 0 desliga), `MERCADO_LOTE` (25), `LEITURA_AUTOMATICA_MIN` (20, 0 desliga).

### MVP2: proposta assistida + robô piloto validado (3 a 5 semanas)
1. **Itens do edital pela IA**: acrescentar `itens` ao esquema da análise para editais cujo PNCP não publica itens; o Gerador importa da análise quando o PNCP não tiver.
2. **Sugestão de preço por item** no Gerador: faixa competitiva automática ao importar (mediana e P25 lado a lado com o custo e a margem mínima da empresa), sem preencher o preço sozinho.
3. **Fila persistente** (`tarefas` no Postgres com `for update skip locked`) e **worker separado** (serviço Docker próprio no Render) para sessões do robô, coleta e leituras: a API deixa de carregar Playwright.
4. **BLL validada**: sessão real em modo "só monitorar" para conferir os seletores da sala (lance, ranking, fase, chat) e marcar `validado: true`.
5. **Chat**: gravar mensagens em tabela própria, detectar CNPJ/razão social/"convoco"/"anexo" e alertar no painel + webhook (Discord/Slack/genérico). WhatsApp só pela API oficial da Meta (número empresarial).

### MVP3: execução automatizada (6 a 10 semanas)
1. **Cadastro de proposta no portal piloto** (BLL) com a sessão do usuário: preenchimento item a item, upload de anexos e **confirmação humana obrigatória** antes do envio final.
2. **Robô em produção** para lances na BLL com as travas já existentes no motor (piso intransponível, margem mínima, decremento mínimo em R$ ou %, intervalo, não cobrir o próprio lance) + limite de sessões por plano e registro auditável de cada decisão.
3. **Sugestão de resposta ao pregoeiro por IA** (rascunho; o envio é sempre do usuário).
4. Segundo portal (Compras.gov.br) usando o mesmo contrato de adaptador.

## 4. Limites que valem para todas as fases
- O PNCP publica só o **vencedor** de cada item. Taxa de vitória e comportamento de lance de concorrentes só existem para as disputas acompanhadas pelo robô.
- Credenciais ficam no cofre cifrado e nunca vão ao navegador; toda ação no portal é feita com a conta do próprio cliente, que liga e desliga.
- Envio de proposta e respostas no chat exigem confirmação humana. Lances automáticos só dentro dos limites que o cliente definiu.
- Nenhum seletor é usado em sessão real sem estar marcado como validado.
