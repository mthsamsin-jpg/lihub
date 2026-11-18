#!/usr/bin/env node
// Assistente de mapeamento dos portais do Robô Turbo 2.0 (modo real).
//
//   npm run mapear            menu com os 9 portais de disputa
//   npm run mapear -- bll     vai direto para um portal (chave ou número)
//
// Mostra o que falta preencher em worker/adaptadores/seletores.js para o portal
// poder ser marcado como validado: true, e abre o gravador do Playwright
// ("playwright codegen") na página oficial de login. Tudo o que você clicar e
// digitar vira código num arquivo em worker/mapeamentos/ (fora do Git: pode
// conter a sua senha digitada). Dali se copiam os seletores para o mapa.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, platform } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SELETORES, camposPendentes } from './adaptadores/seletores.js';

const PRIORIDADE = [
  ['comprasnet', 'Compras.gov.br'],
  ['bll', 'BLL Compras'],
  ['licitanet', 'Licitanet'],
  ['pcp', 'Portal de Compras Públicas'],
  ['bnc', 'BNC'],
  ['licitar', 'Licitar Digital'],
  ['bbmnet', 'BBMNET'],
  ['licitacoes-e', 'Licitações-e'],
  ['comprasbr', 'ComprasBR'],
];

// O que cada campo do mapa significa (mostrado ao lado do que falta).
const AJUDA = {
  urlBase: 'origem do portal, ex.: https://bllcompras.com (também usada no certificado A1)',
  'login.url': 'página de login com usuário e senha',
  'login.usuario': 'campo do login (CPF/CNPJ/usuário)',
  'login.senha': 'campo da senha',
  'login.entrar': 'botão "Entrar"',
  'login.logado': 'algo que SÓ aparece depois de entrar (ex.: menu do fornecedor)',
  'sala.pronta': 'algo que aparece quando a sala de disputa terminou de carregar',
  'sala.linhaLance': 'CADA linha da lista de lances da sala',
  'sala.lanceValor': 'dentro da linha: o valor do lance',
  'sala.lanceAutor': 'dentro da linha: quem deu o lance',
  'sala.lanceNosso': 'seletor que casa SÓ com as linhas dos NOSSOS lances',
  'sala.fase': 'texto da fase/situação (aberta, prorrogação, negociação...)',
  'sala.url (ou busca/buscar/resultado)': 'URL direta da sala OU o caminho pela busca do portal',
  'lance.campo': 'campo onde se digita o valor do lance',
  'lance.enviar': 'botão que envia o lance',
};
const OPCIONAIS = [
  ['login.erro', 'mensagem de erro de login'],
  ['login.urlCertificado / login.botaoCertificado', 'login com certificado digital A1'],
  ['sala.lancePorte', 'onde aparece ME/EPP na linha'],
  ['sala.lanceHora', 'hora do lance na linha'],
  ['sala.tempo', 'cronômetro da disputa'],
  ['sala.linhaMensagem / mensagemAutor / mensagemTexto', 'chat do pregoeiro'],
  ['lance.confirmar', 'botão "confirmar" depois de enviar, se houver'],
  ['lance.sucesso / lance.erro', 'retorno do portal depois do lance'],
];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_GRAVACOES = path.join(RAIZ, 'worker', 'mapeamentos');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((c) => existsSync(c));

const negrito = (t) => (stdout.isTTY ? `\x1b[1m${t}\x1b[0m` : t);
const amarelo = (t) => (stdout.isTTY ? `\x1b[33m${t}\x1b[0m` : t);
const verde = (t) => (stdout.isTTY ? `\x1b[32m${t}\x1b[0m` : t);

function escolherPortal(entrada) {
  const t = String(entrada || '').trim().toLowerCase();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= PRIORIDADE.length) return PRIORIDADE[n - 1];
  return PRIORIDADE.find(([k, nome]) => k === t || nome.toLowerCase() === t) || null;
}

function mostrarPendencias(chave, nome) {
  const sel = SELETORES[chave];
  const faltam = camposPendentes(sel);
  console.log(`\n${negrito(`${nome}`)}  (${chave})  validado: ${sel.validado ? verde('true') : amarelo('false')}`);
  console.log(`  Login: ${sel.login?.url || amarelo('(sem URL)')}`);
  console.log(`  Arquivo: worker/adaptadores/seletores.js -> SELETORES[${JSON.stringify(chave)}]\n`);
  if (!faltam.length) console.log(verde('  Todos os campos obrigatórios estão preenchidos.'));
  else {
    console.log(negrito(`  Obrigatórios que faltam (${faltam.length}) para validado: true:`));
    for (const f of faltam) console.log(`   ${amarelo('•')} ${f.padEnd(38)} ${AJUDA[f] || ''}`);
  }
  console.log(negrito('\n  Opcionais (melhoram o painel):'));
  for (const [f, d] of OPCIONAIS) console.log(`   · ${f.padEnd(52)} ${d}`);
  console.log(`\n  Depois de preencher: conecte um item em ${negrito('"Só monitorar"')} numa sala real e confira`);
  console.log('  os lances, as fases e o chat na tela. Só então mude validado para true.\n');
}

function abrirGravador(chave, url) {
  mkdirSync(PASTA_GRAVACOES, { recursive: true });
  const arquivo = path.join(PASTA_GRAVACOES, `${chave}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.js`);
  const args = ['playwright', 'codegen', '--target', 'javascript', '-o', arquivo, '--lang', 'pt-BR', '--timezone', 'America/Sao_Paulo'];
  if (CHROME) args.push('--channel', 'chrome'); // usa o Chrome instalado (não precisa baixar o Chromium)
  args.push(url);
  console.log(`Abrindo o gravador em ${url}`);
  console.log(`As ações gravadas vão para ${path.relative(RAIZ, arquivo)} ${amarelo('(fora do Git: pode conter a senha que você digitar)')}`);
  console.log('Dica: no gravador, use o botão "Pick locator" para copiar o seletor de cada campo da lista acima.\n');
  return new Promise((ok) => {
    const p = spawn(platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit', cwd: RAIZ, shell: platform === 'win32' });
    p.on('exit', (codigo) => {
      if (codigo) console.log(amarelo(`\nO gravador saiu com código ${codigo}. Se faltar o navegador: npx playwright install chromium`));
      else console.log(verde(`\nGravação salva em ${path.relative(RAIZ, arquivo)}.`));
      ok();
    });
  });
}

async function principal() {
  let escolha = escolherPortal(argv[2]);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!escolha) {
      console.log(negrito('\nMapeamento dos portais do Robô Turbo 2.0 (modo real)\n'));
      PRIORIDADE.forEach(([k, nome], i) => {
        const sel = SELETORES[k];
        const faltam = camposPendentes(sel).length;
        const situacao = sel.validado ? verde('validado') : amarelo(`${faltam} campo(s) a mapear`);
        console.log(`  ${String(i + 1).padStart(2)}. ${nome.padEnd(28)} ${situacao}`);
      });
      const r = await rl.question('\nEscolha o número do portal (Enter para sair): ');
      escolha = escolherPortal(r);
      if (!escolha) { console.log('Nada escolhido.'); return; }
    }
    const [chave, nome] = escolha;
    mostrarPendencias(chave, nome);
    const padrao = SELETORES[chave].login?.url || SELETORES[chave].urlBase;
    const r = await rl.question(`Abrir o gravador em ${padrao}? [Enter = sim / outra URL / n = não] `);
    if (/^n(ao|ão)?$/i.test(r.trim())) return;
    await abrirGravador(chave, /^https?:\/\//i.test(r.trim()) ? r.trim() : padrao);
  } finally {
    rl.close();
  }
}

principal().catch((e) => { console.error(e.message); process.exit(1); });
