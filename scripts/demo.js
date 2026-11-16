#!/usr/bin/env node
// Demonstração local da Etapa 1 (não precisa de Supabase nem de chave da IA).
// Abre uma página no navegador com:
//   - licitações abertas REAIS, buscadas no PNCP pelo código do sincronizador;
//   - um exemplo do formato da leitura de edital feita pela IA.
// Nada é gravado. Rode com: npm run demo   (ou dois cliques em VER-DEMO.bat)
import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { config } from '../src/config.js';
import { AVISO_LEGAL, provedorDaIa } from '../src/ia/analisar-edital.js';
import { obterJson, urlPropostasAbertas } from '../src/pncp/cliente.js';
import { MODALIDADES, UFS } from '../src/pncp/dominio.js';
import { normalizarPagina } from '../src/pncp/normalizar.js';
import { diaPncp, hojeBrasilia, somarDias } from '../src/util.js';
import { ANALISE_EXEMPLO } from '../testes/fixtures/analise-exemplo.js';

const PORTA_INICIAL = 8790;
const abrirNavegador = !process.argv.includes('--sem-navegador');
const pagina = new URL('../demo/index.html', import.meta.url);
const cache = new Map(); // consulta -> { quando, dados }
const CACHE_MS = 10 * 60_000;

function responderJson(res, status, dados) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(dados));
}

async function buscarLicitacoes(parametros) {
  const uf = String(parametros.get('uf') ?? 'SP').toUpperCase();
  const modalidade = Number(parametros.get('modalidade') ?? 6);
  const numeroPagina = Number(parametros.get('pagina') ?? 1);
  if (!UFS.includes(uf)) throw Object.assign(new Error('Estado inválido.'), { status: 400 });
  if (!MODALIDADES[modalidade]) throw Object.assign(new Error('Modalidade inválida.'), { status: 400 });
  if (!Number.isInteger(numeroPagina) || numeroPagina < 1 || numeroPagina > 2000) {
    throw Object.assign(new Error('Página inválida.'), { status: 400 });
  }

  const chave = `${uf}|${modalidade}|${numeroPagina}`;
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.quando < CACHE_MS) return guardado.dados;

  const resposta = await obterJson(
    urlPropostasAbertas({
      dataFinal: diaPncp(somarDias(hojeBrasilia(), config.pncp.diasAFrente)),
      modalidade, uf, pagina: numeroPagina, tamanhoPagina: 50,
    }),
    { tentativas: 2, maxRecusas: 2, timeoutMs: 75_000 },
  );

  const itens = normalizarPagina(Array.isArray(resposta?.data) ? resposta.data : []).map((l) => ({
    numero_controle_pncp: l.numero_controle_pncp,
    objeto: l.objeto,
    orgao: l.orgao_razao_social,
    uf: l.uf,
    municipio: l.municipio,
    modalidade: l.modalidade_nome,
    valor_estimado: l.valor_estimado,
    orcamento_sigiloso: l.orcamento_sigiloso,
    srp: l.srp,
    abertura: l.data_abertura_proposta,
    encerramento: l.data_encerramento_proposta,
    situacao: l.situacao_nome,
    sistema_origem: l.sistema_origem,
    link_sistema_origem: l.link_sistema_origem,
    // mesmo endereço que o banco gera na coluna link_pncp
    link_pncp: l.orgao_cnpj && l.ano_compra && l.sequencial_compra
      ? `https://pncp.gov.br/app/editais/${l.orgao_cnpj}/${l.ano_compra}/${l.sequencial_compra}`
      : null,
  }));

  const dados = {
    total: Number(resposta?.totalRegistros ?? itens.length),
    totalPaginas: Number(resposta?.totalPaginas ?? 1),
    pagina: numeroPagina,
    itens,
  };
  cache.set(chave, { quando: Date.now(), dados });
  return dados;
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method !== 'GET') return responderJson(res, 405, { erro: 'Método não permitido.' });

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await readFile(pagina));
    }
    if (url.pathname === '/api/status') {
      let ia;
      try {
        ia = provedorDaIa();
      } catch (e) {
        ia = { id: config.ia.provedor, nome: 'IA', modelo: '?', chaveConfigurada: false, erro: e.message };
      }
      return responderJson(res, 200, {
        supabase: Boolean(config.supabase.url && config.supabase.chaveSecreta),
        ia,
        diasAFrente: config.pncp.diasAFrente,
      });
    }
    if (url.pathname === '/api/analise-exemplo') {
      return responderJson(res, 200, { ...ANALISE_EXEMPLO, aviso_legal: AVISO_LEGAL });
    }
    if (url.pathname === '/api/licitacoes') {
      return responderJson(res, 200, await buscarLicitacoes(url.searchParams));
    }
    return responderJson(res, 404, { erro: 'Não encontrado.' });
  } catch (e) {
    const status = e.status ?? 502;
    const mensagem = status === 502
      ? `O PNCP não respondeu agora (${e.message}). A API do governo às vezes fica lenta; tente de novo em instantes.`
      : e.message;
    return responderJson(res, status, { erro: mensagem });
  }
});

function iniciar(porta, tentativasRestantes = 10) {
  servidor.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tentativasRestantes > 0) return iniciar(porta + 1, tentativasRestantes - 1);
    console.error(`Não foi possível iniciar a demonstração: ${e.message}`);
    process.exit(1);
  });
  servidor.listen(porta, '127.0.0.1', () => {
    const endereco = `http://localhost:${porta}`;
    console.log(`\nDemonstração do LicitaHub aberta em ${endereco}`);
    console.log('Para encerrar, feche esta janela (ou aperte Ctrl+C).\n');
    if (abrirNavegador) {
      const comando = process.platform === 'win32' ? `start "" "${endereco}"`
        : process.platform === 'darwin' ? `open "${endereco}"` : `xdg-open "${endereco}"`;
      exec(comando, () => {});
    }
  });
}

iniciar(PORTA_INICIAL);
