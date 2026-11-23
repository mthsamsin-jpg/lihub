# Portais do Robô Turbo 2.0 e proposta comercial

## Portais: o que funciona em cada um

A **Sala Simulada** funciona com todos os portais. O **modo real** (o robô do servidor entrando no portal com a credencial do cofre) é liberado portal a portal:

1. **Mapear o login** (endereço, campos, teclado virtual).
2. **Mapear a sala** numa disputa real, **só monitorando** (`npm run mapear`).
3. **Liberar** os lances: `validado: true` em `worker/adaptadores/seletores.js`.

| Etapa (tela) | Significado | Portais hoje |
|---|---|---|
| Em mapeamento | login mapeado, sala pendente | BLL Compras |
| Em adaptação | endereço de login conferido; login e sala pendentes | Compras.gov.br, Portal de Compras Públicas, Licitanet, BNC, BBMNET, Licitações-e, ComprasBR, Licitar Digital |
| Na fila | ainda não começou | Licita Mais Brasil, Petronect |
| Sem disputa | só publica as compras | PNCP |
| Simulação | portal não listado | Outro portal |
| Pronto | modo real liberado | nenhum ainda |

- O roadmap (etapa e prioridade) fica em `site/js/robo-portais.js` (`ROADMAP`).
- Quando o servidor informa `validado: true` para um portal (`GET /api/robo/real/estado`), a tela mostra **Pronto** sozinha.
- As travas continuam no servidor e no worker: nenhum lance real é enviado em portal não validado.

## Proposta comercial

- **Cadastro da empresa:** logo (reduzido no navegador, máx. 480x160) e RG do representante, guardados em `empresas.dados`.
- **Cada proposta** guarda em `propostas.extras`:
  - `declaracoes`: texto completo e editável, e se entra ou não;
  - `banco`: `origem: 'cadastro'` ou os dados informados só nesta proposta;
  - `fechamento`: cidade, data, responsável, RG, CPF e cargo.
- **Horários:** data e horário de abertura da sessão, e prazo final de envio das propostas (data e hora). Ficam no resumo da licitação da proposta.
- **Impressão e PDF:** a tabela de itens tem largura fixa por coluna, e os textos e valores quebram dentro da célula, então nenhuma coluna é cortada. O cabeçalho da tabela se repete em cada página e o rodapé traz a empresa e o aviso do sistema.
- **Word:** o logo pode não aparecer no arquivo .doc, porque o Word não abre imagens embutidas desse jeito. No PDF ele aparece.

Migração: `supabase/atualizar-proposta-completa.sql` (já aplicada).
