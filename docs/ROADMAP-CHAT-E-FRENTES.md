# Roadmap por fases: Chat Unificado, Inteligência de Mercado, Propostas e Robô

Atualizado em 19/11/2026. Complementa `docs/PLANO-AUTOMACAO.md`. Regra de todas as fases: nada novo liga sozinho em produção sem estar validado; tudo novo pode ser desligado por variável de ambiente; nenhuma tabela existente perde coluna ou dado.

## 1. Mapa do que existe (chat, portais, alertas e banco)

| Peça | Situação antes desta entrega | Reaproveitável |
|---|---|---|
| Tela "Monitoramento de Chat" | Mensagens **simuladas**; palavras de alerta salvas no banco | Layout, palavras, notificação do navegador |
| Cadastro Comprasnet | Salva CNPJ, nome e pregões (UASG/número/ano) em `monitoramentos` | É a lista de salas a ler |
| Robô modo real (`worker/`) | Sessão Playwright com a conta do cliente; o adaptador já emite `{ tipo: 'mensagem', autor, texto }` do chat da sala e grava em `auction_live_bids` | **Fonte real de chat** de BLL, BNC, BBMNET e Compras.gov.br logados |
| Adaptadores | BLL com classe própria (login com teclado virtual); demais por mapa de seletores; **nenhum validado** em sessão real | Contrato `watchBids` + seletores `sala.linhaMensagem/...` |
| Alertas | E-mail (Resend) para eventos do robô; notificação do navegador na tela | Notificador e preferência `alerta_email` |
| Leitura pública Compras.gov.br | Não existia | Endpoint `comprasnet-mensagem/v2/chat/{compra}` encontrado em 19/11 (responde 204 vazio nas compras testadas; 429 após poucos pedidos) |

## 2. Fases

### Fase 1: caixa de entrada unificada + base dos conectores (ENTREGUE)
**Entregas**
- Tabela `chat_mensagens` (uma caixa por organização, todos os portais), com identidade da mensagem para não repetir, gatilhos, relevância, lida/não lida e tempo real (`supabase/atualizar-chat.sql`, aplicado).
- Detecção (`src/chat/detectar.js`): menção ao CNPJ (com ou sem pontuação) e ao nome (sem LTDA/ME/EPP, inclui nome fantasia e nomes extras), convocação, anexo, prazo, suspensão/reabertura, resultado e palavras da empresa; papel do autor (pregoeiro, sistema, fornecedor).
- Caixa (`src/chat/caixa.js`): grava, detecta e alerta as relevantes por **webhook** (Discord, Slack ou JSON genérico).
- Ponte do robô: toda mensagem lida por uma sessão real do Robô Turbo 2.0 entra na caixa (`fonte = robo`), em qualquer portal.
- Contrato de conector público + conector **Compras.gov.br** (não validado, desligado por padrão) com ritmo próprio (1 pedido a cada 4 s, pausa de 2 min em 429) e monitor a cada 2 min (`src/chat/conectores.js`, `src/chat/monitorar.js`).
- Tela: no modo real, "Monitoramento de Chat" vira a caixa de entrada (agrupada por sala, filtro por portal, "só o que importa", marcar como lida, notificação do computador, webhook, situação de cada portal). A demonstração continua igual.

**Validação (critérios de aceite)**
- [x] Testes automáticos de detecção, caixa, webhook, conector e monitor (`testes/chat.test.js`).
- [ ] Sessão real do robô em modo "só monitorar" numa sala da BLL: mensagens do pregoeiro aparecem na caixa em até 10 s e a menção ao CNPJ gera alerta no webhook.
- [ ] Compras.gov.br: um pregão **em andamento** cadastrado devolve mensagens no endpoint público; então `validado: true` no conector.

**Variáveis**: `CHAT_INTERVALO_MIN` (2; 0 desliga), `CHAT_CONECTORES_NAO_VALIDADOS=permitir` (só para o teste de validação).

### Fase 2: alertas no celular e cobertura dos portais (EM ANDAMENTO)
**Descoberta de 19/11/2026:** o chat público do Compras.gov.br só aparece depois de um **captcha** (a página pública manda o token no pedido a ). Ler isso automaticamente exigiria burlar a proteção do governo, e o Uso LicitaHub não faz isso. O conector público foi retirado; o Compras.gov.br entra na caixa pela sala do robô, como os demais portais.

**Entregue**
- Alertas por **Telegram** (Bot API oficial): a tela gera um link  que vale 30 min; o servidor confirma o código (getUpdates, sem endereço público) e guarda até 5 chats por organização.
- Alertas por **WhatsApp** (Cloud API oficial da Meta) com modelo aprovado de 3 variáveis (motivo, pregão, trecho); até 5 números por organização.
- Alertador único (webhook + Telegram + WhatsApp): falha de um canal não impede os outros; mensagem marcada como alertada quando pelo menos um canal entregou.
- **Respostas rápidas** por gatilho (anexo, convocação, prazo, suspensão, resultado, menção) para copiar e colar no portal; o envio continua manual.
-  (aplicado).

**Falta (depende de ação externa)**
- Criar o robô no @BotFather e definir  e  no Render.
- WhatsApp: conta Meta Business verificada, número empresarial, modelo  aprovado (categoria Utility, texto sugerido: "Uso LicitaHub: {{1}} no pregão {{2}}. {{3}}"); então  e .
- Validar a sala de cada portal (BLL primeiro, depois BNC, BBMNET, Compras.gov.br) com o robô em modo monitorar numa sessão real.
- Portal de Compras Públicas: verificar se o acompanhamento público da sessão é aberto (sem captcha nem login). Se for protegido, segue o mesmo caminho do Compras.gov.br.

Validação: alerta chega no Telegram/WhatsApp em menos de 30 s depois da mensagem gravada; cada portal com 1 sessão real conferida.

### Fase 3: inteligência de mercado ampliada (2 a 4 semanas)
Dependências: base `mercado_resultados` (já em coleta).
- Atas de registro de preço do PNCP (`/v1/atas`) e contratos, para preço praticado fora do pregão.
- Coleta retroativa (12 meses) em lotes noturnos; índices e materialização dos agregados por fornecedor.
- Pesquisa de Preço usa a base real no modo logado (hoje é simulada).
- Painel do concorrente com evolução de preço no tempo e órgãos onde mais vence.

Validação: preço mediano de 10 itens comuns conferido à mão com o PNCP; consultas abaixo de 1 s.

### Fase 4: propostas e robô (4 a 8 semanas)
Dependências: Fases 1 e 2 (salas validadas por portal).
- Gerador: sugestão de preço por item na importação (faixa P25–P75 ao lado do custo e da margem mínima).
- Robô: validar seletores de lance portal a portal (BLL primeiro), estratégias por perfil do concorrente, limite de sessões por plano, painel de auditoria (cada decisão com motivo, valor e trava aplicada).
- Cadastro de proposta no portal com confirmação humana obrigatória antes do envio.

Validação: 3 disputas reais em modo monitorar sem divergência entre o que o robô "decidiria" e as travas; só então lances reais com valor mínimo intransponível.
