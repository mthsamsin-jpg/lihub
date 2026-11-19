// Popup: login, escolha da proposta e o fluxo seguro em 2 passos
//   1. Conferir: lê a página, casa os itens e MARCA os campos (sem escrever nada);
//   2. Preencher: só depois da conferência, com confirmação; o relatório volta item a item.
const $ = (s) => document.querySelector(s);
const ARQUIVOS_DA_PAGINA = [
  'src/compartilhado/conferencia.js',
  'src/content/adaptadores/base.js',
  'src/content/adaptadores/comprasnet.js',
  'src/content/adaptadores/bll.js',
  'src/content/principal.js',
];
const ROTULOS = { preenchido: 'Preenchido', conferir: 'Conferir', nao_encontrado: 'Não encontrado' };
const CAMPOS = { unitario: 'valor', marca: 'marca', modelo: 'modelo', descricao: 'descrição' };

let propostas = [];
let conferida = null; // { aba, proposta } da última conferência

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const moeda = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function mensagem(texto, erro = false) {
  const m = $('#mensagem');
  m.textContent = texto || '';
  m.classList.toggle('erro', erro);
}

async function pedir(tipo, dados) {
  const r = await chrome.runtime.sendMessage({ tipo, dados });
  if (!r?.ok) {
    if (r?.codigo === 'sem_login') mostrarLogin();
    throw new Error(r?.erro || 'Falha inesperada.');
  }
  return r;
}

async function abaAtual() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!aba?.id || !/^https?:/.test(aba.url || '')) throw new Error('Abra a página do portal (aba normal de site) e tente de novo.');
  return aba;
}

/** Injeta os scripts na aba (só quando a pessoa clica: permissão activeTab) e manda a ordem. */
async function naPagina(tipo, dados) {
  const aba = await abaAtual();
  await chrome.scripting.executeScript({ target: { tabId: aba.id }, files: ARQUIVOS_DA_PAGINA });
  const r = await chrome.tabs.sendMessage(aba.id, { tipo, dados });
  if (!r?.ok) throw new Error(r?.erro || 'A página não respondeu.');
  return { aba, r };
}

function mostrarLogin() {
  $('#tela-login').hidden = false;
  $('#tela-proposta').hidden = true;
  $('#quem').textContent = '';
}

function propostaEscolhida() {
  return propostas.find((p) => p.id === $('#proposta').value);
}

function resumo() {
  const p = propostaEscolhida();
  conferida = null;
  $('#preencher').disabled = true;
  $('#relatorio').innerHTML = '';
  if (!p) { $('#resumo').textContent = 'Nenhuma proposta. Monte uma no Gerador de Proposta do LicitaHub.'; return; }
  const lic = p.licitacao;
  const semValor = p.itens.filter((i) => !(i.unitario > 0)).length;
  $('#resumo').innerHTML = `${esc(lic?.objeto || lic?.numero || 'Licitação não informada')}<br>${p.itens.length} item(ns) · total ${moeda(p.total)} · ${esc(p.status)}${semValor ? ` · <strong>${semValor} sem valor</strong>` : ''}`;
}

async function carregarPropostas() {
  mensagem('Carregando propostas...');
  const r = await pedir('propostas');
  propostas = r.propostas;
  $('#proposta').innerHTML = propostas.map((p) => `<option value="${esc(p.id)}">${esc(p.numero)} · ${esc(p.licitacao?.numero || p.licitacao?.objeto?.slice(0, 40) || '')}</option>`).join('');
  resumo();
  mensagem(propostas.length ? '' : 'Você ainda não tem propostas salvas.');
}

function desenharRelatorio(res) {
  const cont = { preenchido: 0, conferir: 0, nao_encontrado: 0 };
  for (const i of res.itens) cont[i.status]++;
  $('#aviso-portal').hidden = res.portal.validado;
  $('#aviso-portal').innerHTML = res.portal.validado ? '' : `Portal: <strong>${esc(res.portal.nome)}</strong>. Os campos deste portal ainda não foram conferidos numa sessão real: confira cada valor na tela antes de salvar.`;
  $('#relatorio').innerHTML = `
    <p><span class="st st-preenchido">${cont.preenchido} ok</span> · <span class="st st-conferir">${cont.conferir} conferir</span> · <span class="st st-nao_encontrado">${cont.nao_encontrado} não encontrado(s)</span>${res.linhas != null ? ` · ${res.linhas} linha(s) lidas na página` : ''}</p>
    <table><thead><tr><th>Item</th><th>Situação</th><th>O que faz</th></tr></thead><tbody>
    ${res.itens.map((i) => `<tr><td>${esc(i.numero)}${i.numeroNaTela && String(i.numeroNaTela) !== String(i.numero) ? ` <span class="fraco">(tela ${esc(i.numeroNaTela)})</span>` : ''}<br><span class="fraco">${esc(String(i.descricao).slice(0, 60))}</span></td>
      <td class="st st-${i.status}">${ROTULOS[i.status]}</td>
      <td>${i.acoes.map((a) => `${CAMPOS[a.campo] || a.campo}: <strong>${esc(a.valor)}</strong>`).join('<br>') || '—'}
        ${i.avisos.length ? `<ul class="avisos">${i.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
  return cont;
}

const opcoes = () => ({ sobrescrever: $('#sobrescrever').checked });

$('#analisar').addEventListener('click', async () => {
  const p = propostaEscolhida();
  if (!p) return;
  try {
    mensagem('Lendo a página...');
    const { aba, r } = await naPagina('lhx:analisar', { itens: p.itens, opcoes: opcoes() });
    const cont = desenharRelatorio(r);
    const acoes = r.itens.reduce((s, i) => s + i.acoes.length, 0);
    conferida = acoes ? { aba: aba.id, proposta: p.id, acoes } : null;
    $('#preencher').disabled = !acoes;
    mensagem(acoes ? `Campos marcados em azul na página (${acoes} a preencher). Confira e clique em "2. Preencher".` : (cont.nao_encontrado === p.itens.length ? 'Nenhum item encontrado nesta página. Abra a tela de itens da proposta no portal.' : 'Nada a preencher: os campos já estão com os valores da proposta.'));
  } catch (e) { mensagem(e.message, true); }
});

$('#preencher').addEventListener('click', async () => {
  const p = propostaEscolhida();
  try {
    const aba = await abaAtual();
    if (!conferida || conferida.aba !== aba.id || conferida.proposta !== p?.id) {
      $('#preencher').disabled = true;
      return mensagem('Faça a conferência (passo 1) nesta aba e com esta proposta antes de preencher.', true);
    }
    if (!confirm(`Preencher ${conferida.acoes} campo(s) na página com a proposta ${p.numero}?\n\nA extensão NÃO salva nem envia nada no portal: depois de preencher, confira e salve você mesmo.`)) return;
    mensagem('Preenchendo...');
    const { r } = await naPagina('lhx:preencher', { itens: p.itens, opcoes: opcoes() });
    const cont = desenharRelatorio(r);
    conferida = null;
    $('#preencher').disabled = true;
    mensagem(`Pronto: ${cont.preenchido} ok, ${cont.conferir} para conferir. Revise na tela (verde = ok, laranja = conferir) e salve no portal.`, cont.conferir > 0);
  } catch (e) { mensagem(e.message, true); }
});

$('#mapear').addEventListener('click', async () => {
  try {
    const { r } = await naPagina('lhx:mapear');
    mensagem(`${r.portal.nome}: ${r.campos} campo(s), ${r.linhas} linha(s) de item reconhecidas. Detalhes no console da página (F12).`);
  } catch (e) { mensagem(e.message, true); }
});
$('#limpar').addEventListener('click', async () => { try { await naPagina('lhx:limpar'); mensagem('Marcas removidas.'); } catch (e) { mensagem(e.message, true); } });
$('#recarregar').addEventListener('click', () => carregarPropostas().catch((e) => mensagem(e.message, true)));
$('#proposta').addEventListener('change', resumo);
$('#sobrescrever').addEventListener('change', () => { conferida = null; $('#preencher').disabled = true; });
$('#sair').addEventListener('click', async () => { await pedir('sair'); mostrarLogin(); mensagem('Você saiu.'); });

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    mensagem('Entrando...');
    const r = await pedir('entrar', { email: f.email.value, senha: f.senha.value });
    f.senha.value = '';
    await iniciar(r.email);
  } catch (erro) { mensagem(erro.message, true); }
});
$('#form-site').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await pedir('definirSite', { site: e.currentTarget.site.value }); mensagem(`Endereço salvo: ${r.site}`); } catch (erro) { mensagem(erro.message, true); }
});

async function iniciar(email) {
  $('#tela-login').hidden = true;
  $('#tela-proposta').hidden = false;
  $('#quem').textContent = email || '';
  await carregarPropostas();
}

(async () => {
  try {
    const s = await pedir('situacao');
    $('#form-site').site.value = s.site;
    if (s.logado) await iniciar(s.email);
    else mostrarLogin();
  } catch (e) { mostrarLogin(); mensagem(e.message, true); }
})();
