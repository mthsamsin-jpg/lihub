# Extensão do Chrome: preenchimento de propostas

A pasta `extensao-chrome/` guarda uma extensão Manifest V3. Ela leva para o formulário do portal (Compras.gov.br e BLL, por enquanto) os itens da proposta montada no **Gerador de Proposta**: valor unitário, marca e modelo. A extensão **confere item a item** antes de escrever e **nunca salva nem envia nada no portal**: quem salva é a pessoa.

## Arquitetura

```
popup (src/popup)  ──mensagem──▶  background (src/background.js)  ──HTTPS──▶  Supabase do LicitaHub
   │                                login + propostas                          (Auth + tabela propostas, com RLS)
   │ chrome.scripting (só ao clicar)
   ▼
página do portal: conferencia.js + adaptadores/*.js + principal.js
   lê as linhas de item → casa com a proposta → marca os campos → preenche → confere lendo de volta
```

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3 com permissões mínimas: `storage`, `activeTab` e `scripting`. Acesso só ao site do LicitaHub e ao Supabase. Sem `content_scripts` fixos. |
| `src/background.js` | Service worker: faz o login com a conta do LicitaHub (Supabase Auth), renova o token sozinho e lê as propostas. A chave **pública** vem do `/config.js` do site. Só atende pedidos do próprio popup. |
| `src/popup/*` | Login, escolha da proposta, "1. Conferir", "2. Preencher" (com confirmação) e o relatório. Também tem "Mapear campos" e "Limpar marcas". |
| `src/compartilhado/conferencia.js` | Regras puras, testadas no Node: números em formato brasileiro, semelhança de descrições e o **plano** de cada item (`preenchido`, `conferir`, `nao_encontrado`). |
| `src/content/adaptadores/base.js` | Leitura genérica da tabela de itens: linhas, número, descrição, quantidade, unidade e campos identificados por nome, id, placeholder, rótulo ou cabeçalho. Também a escrita segura: setter nativo + `input`, `change` e `blur`. |
| `src/content/adaptadores/comprasnet.js`, `bll.js` | Um arquivo por portal. Cada um define o endereço que reconhece, os seletores, as pistas e as casas decimais. |
| `src/content/principal.js` | Recebe as ordens do popup na página, marca os campos (azul = previsto, verde = ok, laranja = conferir) e escreve o relatório no console. |

**Nada muda no backend do LicitaHub.** A extensão usa as mesmas regras de acesso (RLS) do site: cada pessoa só enxerga as propostas da própria organização.

### Regras de segurança do preenchimento
- O preenchimento é em **dois passos**: primeiro conferir (só marca, não escreve), depois preencher, com confirmação. Mudar de aba, de proposta ou a opção "sobrescrever" obriga a conferir de novo.
- Valor zero ou vazio na proposta nunca é escrito.
- Um campo que já tem valor diferente não é sobrescrito, a menos que a opção esteja marcada.
- Depois de escrever, a extensão **lê o campo de volta**. Se a máscara do portal mudou o valor (vírgula, casas decimais), o item vira "Conferir".
- Quantidade ou unidade diferentes, descrição muito diferente e item achado pela descrição em vez do número também viram "Conferir".
- A extensão nunca clica em salvar, enviar ou confirmar no portal.

## Como testar no Chrome (sem publicar)
1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor**, no canto de cima à direita.
3. Clique em **Carregar sem compactação** e escolha a pasta `licitahub/extensao-chrome`.
4. Fixe o ícone da extensão na barra (peça de quebra-cabeça → alfinete).
5. Abra o popup e entre com o seu e-mail e senha do LicitaHub. Para testar com o servidor local, mude o endereço em "Endereço do LicitaHub" para `http://localhost:8787`.
6. Escolha uma proposta salva no Gerador de Proposta.
7. Abra no portal a tela de itens da proposta e clique em **1. Conferir nesta página**.
8. Revise o relatório e os campos marcados em azul. Depois clique em **2. Preencher**.
9. Confira na tela e **salve você mesmo** no portal.

Depois de mudar o código, clique em ↻ no cartão da extensão em `chrome://extensions` e recarregue a aba do portal.

## Como validar um portal (o próximo passo)
Os seletores do Compras.gov.br e da BLL **ainda não foram conferidos numa sessão real**. O popup avisa isso. Para validar um portal:
1. Abra a tela de itens da proposta, logado no portal.
2. Clique em **Mapear campos** e abra o console da página (F12). A tabela mostra cada campo, a "pista" que a extensão leu e o número do item da linha.
3. Ajuste `seletorLinha`, `pistas` e `casas` no adaptador do portal (ou sobrescreva `lerLinhas` e `escrever`, se a tela for muito diferente).
4. Repita a conferência até os itens saírem "Preenchido". Faça um preenchimento real conferido à mão e só então troque `validado = false` por `true`.

Para um portal novo: copie `bll.js`, troque `id`, `nome` e `reconhece()`, e inclua o arquivo em `ARQUIVOS_DA_PAGINA` (no `popup.js`), antes do `principal.js`.

## Limitações conhecidas
- O Gerador de Proposta tem uma coluna "Marca/modelo". O campo `modelo` é preenchido só se a proposta tiver esse dado.
- Telas com campos dentro de iframes de outro domínio, ou com máscaras que ignoram eventos sintéticos, podem precisar de um `escrever` próprio no adaptador (por exemplo, digitar caractere por caractere).
- Um endereço do LicitaHub fora de `usolicitahub.com.br` e `localhost` precisa ser incluído em `host_permissions` no `manifest.json`.
