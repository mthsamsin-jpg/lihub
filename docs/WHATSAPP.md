# WhatsApp do Uso LicitaHub

Número do suporte: **+55 (48) 99145-4256**.

## O que já funciona sem configurar nada
- **Botão verde do WhatsApp** no site e no painel, com 11 assuntos. Cada assunto abre o WhatsApp com a mensagem já organizada:
  - **Linhas do assunto:** assunto e campos para o cliente completar (nº da proposta, portal, horário etc.).
  - **Dados da conta:** e-mail, plano e tela. Só entram se o cliente estiver logado, e ele vê tudo antes de enviar.
- **Ajuda:** botão "Escolher o assunto e chamar" na tela Ajuda.

## Resposta automática: escolha um dos dois caminhos

### Caminho A: aplicativo WhatsApp Business (simples, sem programação)
No celular do suporte: **Ferramentas comerciais > Mensagem de saudação** (e também **Mensagem de ausência**, fora do horário). Use o texto abaixo:

> Olá! 👋 Aqui é o suporte do *Uso LicitaHub*. Para agilizar, mande em uma mensagem:
> • o e-mail da sua conta
> • o assunto (proposta, busca, edital com IA, robô, pagamento, cancelamento, erro, login ou outro)
> • o que você tentou fazer e o que apareceu (print ajuda muito)
> • o nº da proposta ou do pregão, se tiver
>
> Atendimento: seg. a sex., 9h às 18h. 🔒 Nunca pedimos senha nem código por WhatsApp.

Também vale criar **Respostas rápidas** (atalho "/"), uma por assunto, com a lista do que pedir. Os textos estão em `src/whatsapp.js` (ASSUNTOS).

**Limitação:** a saudação do aplicativo é sempre a mesma. Ela não reconhece o assunto escolhido no site.

### Caminho B: API oficial da Meta (menu inteligente; também é exigido para os alertas)
O servidor responde na hora:
- **Assunto vindo do site:** reconhece o assunto e pede os detalhes certos.
- **Mensagem solta:** mostra um menu de 0 a 10.
- **Número escolhido:** pede o que falta para aquele assunto.
- **"0":** chama uma pessoa da equipe.

Nenhuma mensagem de cliente é gravada.

Passos:
1. **Conta e número:** crie o app em developers.facebook.com (produto WhatsApp) e uma conta Meta Business verificada. Adicione o número. Se ele já estiver no aplicativo WhatsApp Business, use a opção de **coexistência**, que mantém o app no celular. Senão, o número precisa sair do app.
2. **Variáveis no Render**: preencha você mesmo e nunca cole os valores no chat.
   - `WHATSAPP_TOKEN`: token permanente de um usuário do sistema.
   - `WHATSAPP_TELEFONE_ID`: o "Phone number ID".
   - `WHATSAPP_SEGREDO_APP`: a "App secret". Sem ela, as mensagens recebidas são recusadas.
   - `WHATSAPP_VERIFICACAO`: uma palavra qualquer, usada só no passo 3.
3. **Webhook:** no app da Meta, configure a URL `https://usolicitahub.com.br/whatsapp/webhook` com a mesma palavra de `WHATSAPP_VERIFICACAO`. Assine o campo **messages**.

## Alertas do Robô Turbo 2.0 no WhatsApp do usuário
- **Como o usuário liga:** em Robô Turbo 2.0 > Alertas > "Por WhatsApp". O número usado é o do cadastro, em Meu Perfil.
- **O que é enviado:** só as mudanças urgentes, no máximo uma a cada 5 minutos por disputa. Se o e-mail falhar, o WhatsApp sai mesmo assim.
- **Requisitos:**
  - o Caminho B configurado;
  - o banco atualizado com `supabase/atualizar-alerta-whatsapp.sql`;
  - um **modelo aprovado** na Meta. O nome padrão é `alerta_robo`; se for outro, informe em `WHATSAPP_MODELO_ALERTA`.

Crie o modelo com estes dados:
- **Categoria:** Utilidade. **Idioma:** Português (BR). **Nome:** `alerta_robo`.
- **Texto:**

  > Uso LicitaHub · Robô Turbo 2.0
  > Pregão {{1}}: {{2}}
  > Acompanhe ao vivo: {{3}}
  > Estimativa estatística, não é garantia de resultado.

**Custo:** a Meta cobra cada mensagem de utilidade enviada. As respostas ao cliente dentro de 24 horas da mensagem dele são gratuitas.
