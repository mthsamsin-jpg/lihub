# Assinatura no cartão e janela do Robô Turbo 2.0

## Regra

- **Assinatura só no cartão de crédito**, com cobrança automática pelo Mercado Pago (preapproval). O Pix e o pagamento avulso não são mais vendidos. Pagamentos avulsos antigos que ainda chegarem continuam sendo honrados.
- **Ciclo de 30 dias.** Cada cobrança aprovada abre um ciclo novo:
  - **dias 1 a 7:** plataforma + Robô Turbo 2.0 (plano Max);
  - **dias 8 a 30:** só a plataforma. O robô fecha sozinho e volta na próxima cobrança aprovada.
- **Preços por ciclo:** Pro R$ 97, Max R$ 197 (em `src/pagamentos/planos.js`).
- **Contas isentas:** acesso total, sem janela e sem cobrança.
- **Contas pagas antes desta regra** (sem `robo_ate`): robô até o fim do prazo já pago.

## Como mudar os dias

Variáveis de ambiente no Render:

| Variável | Padrão | O que faz |
|---|---|---|
| `ASSINATURA_CICLO_DIAS` | `30` | duração do ciclo e intervalo da cobrança (30 = 1 mês no Mercado Pago) |
| `ASSINATURA_ROBO_DIAS` | `7` | dias de robô no começo de cada ciclo (nunca passa do ciclo) |

Os textos do app usam esses valores. A página inicial (`site/index.html`) e os Termos (`site/js/legal.js`) têm "30 dias" e "7 dias" escritos: atualize-os junto. Mudar o ciclo vale para **assinaturas novas**; quem já assina continua com a frequência combinada no Mercado Pago.

## Onde a regra é conferida

1. **Banco:** a função `public.robo_liberado(org)` e as políticas de `robo_itens`. Fora da janela, não dá para criar item do robô nem ligá-lo (`running`). Ler, pausar e apagar continuam liberados. O cliente não consegue alterar as datas.
2. **API:** as rotas `/api/robo/*` e `/api/portais/*` respondem `402 robo_janela_encerrada` fora da janela.
3. **Servidor:** a cada minuto, as sessões reais do robô de quem saiu da janela são encerradas.
4. **Tela:** o menu mostra um relógio no robô e a tela explica quando ele volta. A tela "Meu Perfil" mostra o ciclo, o robô e a situação do cartão.

## Banco de dados

Migração: `supabase/atualizar-assinatura-ciclo.sql` (já aplicada).

- `organizacoes`: `ciclo_inicio`, `robo_de`, `robo_ate` (e `plano_ate` = fim do ciclo)
- `assinaturas`: `ciclo_inicio`, `robo_de`, `robo_ate`, `status_pagamento`, `ultimo_pagamento_em`, `falhas_pagamento`, `proxima_cobranca` (além de `status`, `forma`, `cancelar_no_fim`, `periodo_fim`)

## Avisos do Mercado Pago (webhook `POST /mercadopago/webhook`)

| Aviso | O que acontece |
|---|---|
| `payment` aprovado | abre o ciclo (uma vez por pagamento) |
| `payment` recusado (assinatura) | registra `status_pagamento` e soma `falhas_pagamento`; o acesso segue até o fim do ciclo pago |
| `subscription_authorized_payment` | cobrança da assinatura: segue para o pagamento dela |
| `subscription_preapproval` | grava o estado da assinatura (`authorized`, `paused`, `cancelled`) e a próxima cobrança |

No painel do Mercado Pago (Suas integrações → Webhooks), deixe marcados os eventos **Pagamentos** e **Planos e assinaturas** (`subscription_preapproval` e `subscription_authorized_payment`).

## ADM

O painel `/adm-painel.html` mostra assinantes ativos, quem está com o robô liberado agora, cobranças recusadas e cancelamentos no fim do ciclo, com filtros para cada um. Cada usuário mostra a situação do cartão, a última cobrança e até quando vai a janela do robô (ou quando ela volta).
