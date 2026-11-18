# Uso LicitaHub — Etapa 1: base do back-end

SaaS de gestão e inteligência em licitações públicas. Esta etapa entrega a fundação
que o site vai usar:

| Parte | Arquivo | O que faz |
| --- | --- | --- |
| Banco de dados | [supabase/schema.sql](supabase/schema.sql) | Tabelas, segurança por cliente (RLS), LGPD, busca em português |
| Sincronizador PNCP | [scripts/sync-pncp.js](scripts/sync-pncp.js) | Baixa licitações abertas do Brasil inteiro e grava no Supabase |
| Leitor de edital (IA) | [src/ia/analisar-edital.js](src/ia/analisar-edital.js) | A IA (Gemini, com plano grátis, ou Claude) lê o PDF e devolve habilitação, documentos, prazos e riscos |
| API do servidor | [src/servidor.js](src/servidor.js) | Rota que o site chama para analisar editais; sincroniza o PNCP sozinho |
| Assinaturas (Stripe) | [src/pagamentos/](src/pagamentos/) | Página de pagamento, portal do assinante e liberação automática do plano |
| Testes | [testes/](testes/) | 51 testes automáticos (`npm test`) |
| Site (front-end) | [site/](site/) | Painel completo em HTML, CSS e JavaScript puro, ligado ao banco, à IA e ao pagamento (Etapa 2) |

## Site (front-end, Etapa 2)

**Ligado ao sistema:** dê **dois cliques em `ABRIR-SITE.bat`** (ou rode `npm run servidor`) e
abra http://localhost:8787. O mesmo servidor entrega o site e a API, então não há configuração
de CORS. Quem não está logado vê as telas de **Entrar / Criar conta**. O cadastro já registra o
aceite dos termos e da privacidade, como a LGPD pede.

**Só a demonstração:** abra `site/index.html` direto do arquivo. Nesse caso o site usa dados de
exemplo e não precisa de servidor nem de internet.

O que já usa o back-end de verdade (testado em 15/11/2026 com um usuário temporário):

| Módulo | Ligado a |
| --- | --- |
| Entrar, Criar conta, Esqueci a senha, Sair | Supabase Auth |
| Home | Licitações abertas, novas em 24 h, CRM e calendário de prazos, tudo do banco |
| Buscar Licitações | Função `buscar_licitacoes`: relevância, filtros e "Carregar mais" |
| Favoritas | Tabela `favoritos` |
| CRM | `crm_cards` e as etapas da organização, separados por empresa |
| Cadastrar Empresa e Sua empresa | Tabela `empresas` (endereço, representante e banco ficam na coluna `dados`) |
| Radar | Tabela `radares`; contagens e alertas pela busca real |
| Calendário | Tabela `eventos`, mais os prazos do CRM, das favoritas e dos documentos |
| Gestor de documentos | Tabela `documentos` e pasta privada `documentos/<organização>/<empresa>/` (PDF, PNG ou JPG, até 10 MB), aberta por link temporário |
| Gerador de proposta | Tabela `propostas`, com itens, condições, situação e um resumo da licitação |
| Cadastro Comprasnet | Tabela `monitoramentos` (CNPJ, pregões e palavras de alerta, sem senha do gov.br) |
| Leitor de Edital IA | `POST /api/editais/analisar`: PDF enviado ao Storage ou edital baixado do PNCP, acompanhamento e histórico |
| Meu Perfil | Perfil, consentimento de marketing, exportar dados (LGPD), assinatura pela Stripe (checkout e portal) e excluir conta (`DELETE /api/conta`). A exclusão também apaga os arquivos das pastas `editais` e `documentos` da organização, porque o banco sozinho não apaga arquivos do Storage |

Ainda com dados de exemplo, porque dependem de uma fonte externa (próxima etapa), e com aviso na própria tela:
- mensagens do Monitoramento de Chat: precisam da leitura das sessões públicas do Compras.gov.br;
- Petronect: precisa do portal da Petrobras;
- Pesquisa de Preço: precisa dos preços praticados em compras públicas;
- Cotação Online: precisa de fornecedores.

**Dois ajustes no Supabase (painel do projeto Uso LicitaHub):**
1. Rode o `supabase/schema.sql` de novo. Ele cria a coluna `dados` da tabela `empresas`, e
   `npm run verificar` avisa se ela faltar.
   Desde a busca regional do Radar (nov/2026), ele também cria a coluna `municipios` dos radares
   e o filtro de municípios da função `buscar_licitacoes`.
2. Em **Authentication > URL Configuration**:
   - ponha `http://localhost:8787` em **Site URL**;
   - adicione `http://localhost:8787/**` em **Redirect URLs**.

   Sem isso, o link de confirmação do cadastro e o de recuperar a senha levam para um endereço
   errado. No ar (Render), use `https://usolicitahub.com.br` em **Site URL**, adicione
   `https://usolicitahub.com.br/**` em **Redirect URLs** e defina `SITE_URL=https://usolicitahub.com.br`
   nas variáveis do Render: o site monta os links de cadastro, senha e Stripe a partir dela. O e-mail embutido do Supabase envia poucas
   mensagens por hora; para clientes, configure um SMTP próprio em Authentication > Emails.

O site tem as 17 categorias do menu e as subcategorias:

| Categoria | O que faz |
| --- | --- |
| Home | Banner com o vidro do plano de R$ 97, 4 indicadores, calendário e vencimentos |
| Buscar Licitações | Filtros de busca |
| Radar de Licitações | Monitoramento com alertas |
| Petronect (Beta) | Oportunidades da Petrobras |
| Licitações favoritas | Editais salvos |
| Calendário | Eventos por dia |
| Gestor de documentos | Certidões e vencimentos |
| Gerador de proposta | Itens, total e valor por extenso; impressão em PDF |
| Gerador de declarações | Modelos da Lei 14.133 |
| Funções com IA | Leitor de Edital, Dossiê Jurídico e Cotação Online (Beta) |
| CRM - Licitante | Kanban com as 7 etapas do banco; cadastro de empresas |
| Pesquisa de Preço | Alternância Produto/Serviço, gráfico e regra da IN 65/2021 |
| Monitoramento de Chat | Mensagens do pregoeiro, com alerta no computador |
| Cadastro Comprasnet | Pregões a acompanhar |
| Sua empresa | Dados cadastrais e fiscais |
| Meu Perfil | Dados da conta, assinatura e LGPD |
| Ajuda | Suporte e tutoriais |

**Organização do código.** Os estilos ficam em `site/css/` (base, layout, componentes e
módulos). Os scripts ficam em `site/js/`:
- `icones.js`: ícones;
- `dados.js`: dados de exemplo e armazenamento do navegador;
- `nucleo.js`: formatação, avisos, efeitos, CNPJ e valor por extenso;
- `componentes.js`: calendário, card de licitação e documentos;
- `nuvem.js`: ligação com o Supabase Auth, contexto do usuário e chamadas à API;
- `repo.js`: um só jeito de pedir dados, no modo real ou de demonstração;
- `acesso.js`: telas de Entrar e Criar conta;
- `modulos/*.js`: uma tela por módulo;
- `app.js`: menu, rotas e inicialização.

**Servidor.** Ele entrega o site por [src/api/site.js](src/api/site.js):
- a pasta `site/`;
- `/config.js`, só com a URL e a chave **pública** do Supabase (ele recusa a chave secreta);
- `/vendor/supabase.js`;
- as voltas da Stripe (`/assinatura/sucesso`, `/precos`, `/painel`).

`SITE_URL` agora é `http://localhost:8787`.

**Antes de publicar:**
- troque os dados de exemplo do rodapé (CNPJ) e do suporte (`SUPORTE` em
  `site/js/modulos/conta.js`);
- revise com um advogado os textos legais e os modelos de declaração e de peças jurídicas.

**Sem senha do gov.br.** O "Cadastro Comprasnet" não pede a senha do gov.br. O monitoramento usa
só informações públicas da sessão (CNPJ, UASG e número do pregão).

## Ver funcionando agora (sem criar conta em nada)

Dê **dois cliques em `VER-DEMO.bat`** (ou rode `npm run demo`). O navegador abre uma página
que busca licitações abertas **reais** no PNCP com o código desta etapa e mostra o formato da
leitura de edital pela IA, com um exemplo fictício. Nada é gravado. Para encerrar, feche a
janela preta.

Prévias prontas, sem precisar rodar nada:
- [demo/previa-computador.png](demo/previa-computador.png);
- [demo/previa-ia.png](demo/previa-ia.png);
- [demo/previa-celular.png](demo/previa-celular.png).

## Passo a passo para colocar no ar

1. **Supabase** — crie um projeto em https://supabase.com **só para o Uso LicitaHub** (não
   reaproveite o projeto de outro sistema: os dois dividiriam usuários e limites).
   Escolha a região **South America (São Paulo)**, para manter os dados no Brasil.
2. No painel do projeto, abra **SQL Editor**, cole todo o conteúdo de
   `supabase/schema.sql` e clique em **Run**. Se aparecer um aviso de "destructive operation",
   confirme em **Run this query**: são comandos `drop ... if exists` que só recriam as regras do
   próprio Uso LicitaHub. Pode rodar de novo depois: o script não apaga dados.
3. Em **Project Settings > API Keys**, copie a URL, a chave *publishable* e a chave *secret*.
4. **Gemini** — em https://aistudio.google.com clique em **Get API key** e crie a chave (grátis).
5. Preencha as chaves no arquivo `.env`. Ele já existe; o modelo é o `.env.exemplo`.
6. Instale e teste:
   ```bash
   npm install
   npm test                       # 51 testes, não usa internet nem gasta créditos
   npm run verificar -- --completo # confere chaves, tabelas, segurança e cadastro no Supabase
   npm run sync:simular           # confere a conexão com o PNCP sem gravar nada
   ```
7. **Carga inicial** do catálogo (cerca de 27 mil licitações abertas no Brasil; pode levar
   de 30 a 60 minutos, porque a API do governo é lenta e só aceita uma consulta por vez):
   ```bash
   npm run sync
   ```
8. **Servidor** (API + atualização automática do PNCP a cada 60 minutos):
   ```bash
   npm run servidor         # teste: http://localhost:8787/saude
   ```
9. **Testar a IA** com um edital seu, direto no terminal:
   ```bash
   npm run analisar -- --pdf "C:\caminho\do\edital.pdf"
   ```

## Sincronizador do PNCP

```bash
npm run sync                                   # carga completa: propostas abertas, todos os estados
npm run sync -- --modo=atualizacao             # só o que mudou desde ontem (rápido)
npm run sync -- --ufs=SP,MG --modalidades=6    # recorte: pregões eletrônicos de SP e MG
npm run sync -- --ajuda                        # todas as opções
```

Observações (testadas em 15/11/2026):

- O PNCP reúne as licitações de milhares de portais: Compras.gov.br, BLL, Licitar Digital,
  Portal de Compras Públicas etc. O portal de cada uma fica em `sistema_origem`.
- A consulta nacional de pregões costuma falhar (HTTP 500 depois de ~50 s). Por isso a carga
  completa consulta **estado por estado**, com novas tentativas automáticas.
- O modo `atualizacao` é rápido (1.688 pregões atualizados no último dia, em ~1 s).
- Datas do PNCP vêm no horário de Brasília e são gravadas corretamente com fuso.
- Licitações encerradas há mais de 90 dias que ninguém acompanha são apagadas, para o banco
  caber no plano gratuito do Supabase (500 MB).

## Leitor de edital (IA)

O provedor é escolhido no `.env` por `IA_PROVEDOR`. Os dois devolvem exatamente o mesmo formato.

| | Gemini (padrão) | Claude (opcional) |
| --- | --- | --- |
| Arquivo | [src/ia/provedores/gemini.js](src/ia/provedores/gemini.js) | [src/ia/provedores/claude.js](src/ia/provedores/claude.js) |
| Chave | `GEMINI_API_KEY` (aistudio.google.com) | `ANTHROPIC_API_KEY` (console.anthropic.com) |
| Modelo padrão | `gemini-4-hydrogen` (estável, lê PDF de até 1.000 páginas) | `claude-sonnet-5-5` |
| Custo | grátis no plano gratuito; no pago, US$ 1,50 por milhão de tokens de entrada e US$ 7,50 de saída | pago por uso |

**Atenção ao plano gratuito do Gemini.** Pelos termos do Google (versão de 23/03/2026),
no plano gratuito o conteúdo enviado pode ser usado para melhorar os produtos do Google,
inclusive com leitura por revisores humanos. O próprio Google pede para não enviar
informação pessoal ou confidencial. Editais são documentos públicos, então o plano gratuito
serve para testes. Antes de atender clientes:
- ative o plano pago (`GEMINI_PLANO=pago`), em que o Google não usa os dados;
- cite o Google como operador na Política de Privacidade.

Para todos os provedores:
- **Formato garantido:** a IA usa *saída estruturada*, então a resposta sempre segue o
  formato de [src/ia/esquema-analise.js](src/ia/esquema-analise.js):
  - identificação;
  - prazos;
  - habilitação jurídica, fiscal, econômico-financeira e técnica;
  - checklist de documentos;
  - requisitos da proposta;
  - penalidades;
  - riscos com severidade e recomendação;
  - pontos para esclarecimento;
  - informações não encontradas.
- **Referências:** cada item traz a referência no edital (item e página) para conferência.
- **Aviso legal:** toda análise sai com aviso de que não substitui a leitura do edital e que
  a responsabilidade pela proposta é do licitante.
- **Uso e custo:** cada análise grava tokens e custo estimado em `analises_edital`. Se o
  mesmo arquivo for enviado de novo pela mesma organização, o resultado é reaproveitado sem
  nova chamada à IA. O plano limita a quantidade de análises por mês
  (`limite_analises_ia_mes`, padrão 10).
- **Limites:** PDF de até 20 MB. Arquivo `.zip` é recusado com orientação para extrair o PDF.
- **Só no Claude:** se o modelo recusar um documento por engano, a própria API da Anthropic
  tenta outro modelo (`fallbacks: "default"`).

### API para o site

Todas as rotas `/api` exigem o login do Supabase: `Authorization: Bearer <access_token>`.

| Método | Rota | Corpo / resposta |
| --- | --- | --- |
| GET | `/saude` | `{ ok: true }` |
| POST | `/api/editais/analisar` | `{ organizacao_id, licitacao_id }`, `{ organizacao_id, arquivo_path }` ou `{ organizacao_id, texto }`. Responde **202** `{ id }` e a análise roda em segundo plano |
| GET | `/api/editais/analises/:id` | Linha de `analises_edital`, com `status`: pendente, processando, concluida ou erro |

## Como o site (Etapa 2) vai usar o back-end

```js
// Cadastro, registrando o consentimento (LGPD)
await supabase.auth.signUp({
  email, password,
  options: { data: { nome, empresa, versao_termos: '2026-11', versao_privacidade: '2026-11', aceita_marketing: false } },
});

// Busca de oportunidades (palavras sem acento também encontram "manutenção")
const { data } = await supabase.rpc('buscar_licitacoes', {
  p_termo: 'manutencao ar condicionado', p_ufs: ['SP'], p_modalidades: [6],
  p_ordem: 'prazo', p_limite: 20, p_offset: 0,
}); // cada linha traz "total" para a paginação

// Enviar um PDF e pedir a análise
const caminho = `${organizacaoId}/${crypto.randomUUID()}.pdf`;
await supabase.storage.from('editais').upload(caminho, arquivo, { contentType: 'application/pdf' });
const { data: { session } } = await supabase.auth.getSession();
const resposta = await fetch(`${API}/api/editais/analisar`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
  body: JSON.stringify({ organizacao_id: organizacaoId, arquivo_path: caminho, nome_arquivo: arquivo.name }),
});
const { id } = await resposta.json();

// Ser avisado quando a análise terminar (tempo real)
supabase.channel(`analise-${id}`)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'analises_edital', filter: `id=eq.${id}` },
      ({ new: a }) => { if (a.status === 'concluida') mostrar(a.resultado); if (a.status === 'erro') avisar(a.erro); })
  .subscribe();

// Quadro Kanban de uma empresa
const { data: cards } = await supabase.from('vw_crm_cards').select('*').eq('empresa_id', empresaId).order('posicao');
```

## Banco de dados (resumo)

| Tabela | Conteúdo | Quem pode ver/alterar |
| --- | --- | --- |
| `organizacoes` | A conta assinante: plano e limites | Membros veem; dono e admin editam nome e CNPJ (plano e limites, não) |
| `perfis` | Nome e telefone do usuário. O e-mail fica só no Auth | O próprio usuário e colegas de organização |
| `membros` | Quem participa de cada organização: dono, admin ou membro | Membros veem; só o dono muda papéis |
| `empresas` | Empresas clientes. Valida CNPJ, inclusive o novo alfanumérico | Membros da organização |
| `licitacoes` | Catálogo do PNCP (público) e licitações manuais (privadas) | Catálogo: todos leem, só o sincronizador grava |
| `licitacao_itens` | Itens de cada licitação (tabela pronta para a próxima etapa) | Segue a licitação |
| `favoritos` | Favoritas de cada usuário | Só o próprio usuário |
| `kanban_etapas` | Colunas do CRM. São criadas 7 etapas padrão | Membros veem; dono e admin editam |
| `crm_cards` | Licitação acompanhada por uma empresa | Membros da organização |
| `analises_edital` | Resultados da IA, custo e status | Membros veem; só o servidor grava |
| `consentimentos` | Histórico de aceites (LGPD). Não pode ser editado | Só o próprio usuário |
| `sync_execucoes` | Histórico das sincronizações | Só o servidor |

Funções que o site pode chamar:
- `buscar_licitacoes(...)`;
- `criar_organizacao(nome, cnpj)`;
- `exportar_meus_dados()`, que é o direito de acesso da LGPD.

Proteções testadas:
- Uma organização nunca enxerga dados de outra.
- O cliente não consegue aumentar o próprio limite do plano.
- PDFs só entram na pasta da própria organização no Storage.
- Excluir a conta apaga a organização em que a pessoa estava sozinha.

## Segurança, ética e LGPD

Já está no código:
- Regras de acesso no banco (RLS) em todas as tabelas.
- A chave secreta fica só no servidor.
- Registro de consentimentos, exportação de dados e exclusão de conta.
- Aviso legal em toda análise.
- A IA é instruída a não inventar exigências, não prometer resultado e não dar parecer
  jurídico conclusivo.
- O texto do edital é tratado como dado, não como instrução, o que protege contra PDFs
  maliciosos.

Antes de lançar, confirme com um advogado:
- **Termos de Uso e Política de Privacidade.** Devem citar:
  - os operadores de dados (Supabase e Google, ou Anthropic se usar o Claude);
  - a transferência internacional de dados, porque a IA processa fora do Brasil (art. 33 da LGPD);
  - no plano gratuito do Gemini, o uso dos documentos pelo Google (melhor ativar o plano pago);
  - o prazo de guarda das análises;
  - o encarregado (DPO).
- **Dados da empresa no rodapé do site:** razão social, CNPJ e contato de suporte.
- **Textos de venda:** sem promessa de vitória em licitações.

## Limitações conhecidas

- **Download do edital pelo PNCP não testado ao vivo.** Em 15/11/2026, a API de documentos
  do PNCP (`/api/pncp/...`) respondia "503 — serviço indisponível". O código segue o manual
  oficial e mostra uma mensagem clara quando o serviço está fora. Enquanto isso, o usuário
  pode enviar o PDF. **Retestar quando o serviço voltar:**
  ```bash
  npm run analisar -- --pncp <número de controle>
  ```
- **Limite de consultas do PNCP.** O PNCP recusa consultas simultâneas (HTTP 429, medido em
  15/11/2026). Por isso o sincronizador faz uma consulta por vez (`PNCP_CONCORRENCIA=1`) e,
  quando recebe um 429, pausa tudo por 15 s, 30 s, 60 s, até 2 min. Se as recusas continuarem,
  ele para, guarda o que já leu e pede para tentar mais tarde.
- **Itens das licitações.** A tabela existe, mas o download dos itens fica para a próxima etapa.
- **Assinaturas testadas só com uma Stripe simulada.** Falta o teste com a chave de teste
  real. Antes de apagar uma conta ou organização pelo app (ainda não existe essa tela), é
  preciso cancelar a assinatura na Stripe, senão o cartão continua sendo cobrado.
- **IA testada ao vivo com o Gemini** (`gemini-4-hydrogen`, plano gratuito, 15/11/2026):
  - edital fictício de 2 páginas, em texto e PDF: cerca de 35 s;
  - edital real de 63 páginas (Dispensa Eletrônica 07/2022 da Receita Federal, com anexos
    escaneados): 2 min 13 s, 87 mil tokens de entrada e 17 mil de saída. Achou divergências
    reais do edital, como prazo de execução de 30 dias no aviso e de 7 dias no termo de
    referência. No plano pago, essa análise custaria cerca de US$ 0,26 (páginas escaneadas e
    tabelas gastam uns 1.400 tokens por página).
  - O relatório ainda não traz a pesquisa de preços dos anexos (cotações dos fornecedores).
  - O Claude foi testado só com uma API simulada.
- **Modelo do Gemini.** O padrão `gemini-4-hydrogen` foi escolhido pela documentação do Google
  de novembro/2026. Os modelos `gemini-3.8-flash` e `gemini-3.6-flash` também são grátis, mas
  só até 31/12/2026. Os limites por minuto e por dia do plano gratuito aparecem em
  aistudio.google.com.

## Assinaturas (Stripe)

O cliente paga numa página da própria Stripe: o número do cartão nunca passa pelo
Uso LicitaHub. O dinheiro cai na conta Stripe de quem a abriu (CPF ou CNPJ) e vai para a
conta bancária do mesmo CPF/CNPJ.

**Como funciona**
1. O dono ou um administrador da organização escolhe o plano. O site chama
   `POST /api/assinaturas/checkout` com `{ organizacao_id, plano, ciclo }`, recebe uma `url`
   e manda o cliente para lá.
2. O cliente paga (ou começa o teste grátis de `STRIPE_DIAS_TESTE` dias, uma vez por organização).
3. A Stripe avisa o servidor em `POST /stripe/webhook`. O servidor confere a assinatura
   digital do aviso, busca a situação atual da assinatura e atualiza a tabela `assinaturas`
   e o plano/limites da organização.
4. Todo mês a Stripe cobra sozinha (cartão). Se o pagamento falhar, ela tenta de novo e o
   plano continua liberado enquanto isso; se a assinatura for cancelada ou ficar sem
   pagamento, a organização volta ao plano gratuito.
5. `POST /api/assinaturas/portal` abre o portal da Stripe: trocar cartão, ver faturas,
   mudar de plano e cancelar (no fim do período já pago).

**Planos:** um plano pago, **Completo, de R$ 97 por mês** (decisão de 15/11/2026), além do plano gratuito.
Nomes, limites (ainda provisórios) e preços ficam em [src/pagamentos/planos.js](src/pagamentos/planos.js).
Depois de mudar, rode `npm run stripe:configurar`.

**Configurar**
1. Crie a conta em https://stripe.com e pegue a chave secreta de **teste** (`sk_test_...`) em
   Desenvolvedores > Chaves de API. Coloque em `STRIPE_SECRET_KEY` no `.env`.
2. `npm run stripe:configurar` cria na Stripe o produto, o preço e o portal do assinante.
3. Avisos (webhook):
   - no computador: instale a Stripe CLI (`npm install -g @stripe/cli`) e rode
     `stripe listen --forward-to localhost:8787/stripe/webhook`; ele mostra o segredo
     `whsec_...` para o `STRIPE_WEBHOOK_SECRET`;
   - com o servidor na internet: em Desenvolvedores > Webhooks, cadastre
     `https://SEU-SERVIDOR/stripe/webhook` com os eventos listados pelo `stripe:configurar`.
4. `npm run stripe:verificar` confere o caminho todo na Stripe de teste:
   - preço;
   - página de pagamento e portal, pedidos pela API com login;
   - assinatura paga com cartão de teste e aviso chegando ao servidor;
   - plano liberado e cancelamento.

   Só roda com a chave de teste e, no fim, apaga o que criou. Tem três modos:
   - sem opção: guarda a assinatura num "banco" na memória e não mexe no Supabase;
   - `-- --completo`: usa o Supabase de verdade, com um usuário e uma organização de teste;
   - `-- --manual`: como o `--completo`, mas mostra um link e espera você pagar na página da
     Stripe com o cartão de teste. Páginas provisórias no `SITE_URL` cuidam da volta depois do
     pagamento.

   Em 15/11/2026 os dois modos automáticos passaram inteiros. As chaves de teste podem ser de
   uma "Área restrita" (sandbox). Ela é separada da conta de verdade e, pela API, sempre aparece
   como não ativada.
5. Cartão de teste na página de pagamento: `4242 4242 4242 4242`, qualquer data futura, qualquer CVC.
6. Para cobrar de verdade: ative a conta na Stripe (documentos e conta bancária do mesmo
   CPF/CNPJ), troque para a chave `sk_live_...` e rode `npm run stripe:configurar -- --real`.

**Taxas e prazos da Stripe no Brasil** (páginas oficiais, novembro/2026)

| Forma | Taxa | Dinheiro disponível | Assinatura automática? |
| --- | --- | --- | --- |
| Cartão nacional | 3,99% + R$ 0,39 | 30 dias depois | Sim |
| Boleto | R$ 3,45 por boleto pago | 2 dias | Não: o cliente paga um boleto por mês |
| Pix | 1,19% (só com convite da Stripe) | 2 dias | Não: Pix Automático não existe para contas do Brasil |

Mais **0,7%** do Stripe Billing sobre cada cobrança de assinatura. Exemplo: mensalidade de
R$ 100 no cartão: R$ 3,99 + R$ 0,39 + R$ 0,70 = **R$ 5,08**. Sem mensalidade nem taxa de
adesão. A Stripe **não emite nota fiscal**: emita no site da prefeitura ou integre um
emissor de NFS-e depois (fale com um contador).

## Estrutura

```
supabase/schema.sql          banco completo (rodar no SQL Editor do Supabase)
src/config.js                configurações lidas do .env
src/pncp/                    cliente da API do PNCP, conversão e sincronização
src/ia/                      esquema da análise, instruções, PDFs e o seletor de provedor
src/ia/provedores/           gemini.js (padrão) e claude.js
src/api/                     rotas HTTP (Hono) e acesso ao banco
src/pagamentos/              planos (planos.js) e assinaturas pela Stripe (stripe.js)
src/servidor.js              liga a API, os pagamentos e a sincronização automática
scripts/sync-pncp.js         sincronização pela linha de comando
scripts/analisar-edital.js   análise de edital pela linha de comando
scripts/stripe-configurar.js cria produtos, preços e portal na Stripe
scripts/verificar-supabase.js confere o Supabase (npm run verificar)
testes/                      testes automáticos (banco simulado com PGlite, IA simulada)
```
