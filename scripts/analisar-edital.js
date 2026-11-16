#!/usr/bin/env node
// Lê um edital com o Claude direto do terminal (não precisa do Supabase).
// Útil para testar a chave da Anthropic e a qualidade das análises.
//
//   npm run analisar -- --pdf "C:\caminho\edital.pdf"
//   npm run analisar -- --texto edital.txt
//   npm run analisar -- --pncp 19738706000183-1-000026/2023
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { analisarEdital, ErroAnalise, provedorDaIa } from '../src/ia/analisar-edital.js';
import { obterEditalDoPncp, verificarPdf } from '../src/ia/documento.js';
import { obterContratacao } from '../src/pncp/cliente.js';
import { interpretarNumeroControle } from '../src/pncp/dominio.js';
import { normalizarContratacao } from '../src/pncp/normalizar.js';

const AJUDA = `
Uso: npm run analisar -- (--pdf ARQUIVO | --texto ARQUIVO | --pncp NUMERO_CONTROLE) [opções]

  --pdf arquivo.pdf          edital em PDF
  --texto arquivo.txt        edital em texto
  --pncp 0000.../2026        número de controle PNCP (baixa o edital publicado)
  --saida resultado.json     onde salvar o JSON (padrão: analise-<arquivo>.json)
  --provedor gemini          gemini | claude (padrão: IA_PROVEDOR do .env = ${config.ia.provedor})
  --nivel high               profundidade: low | medium | high | xhigh
  --modelo NOME              troca o modelo do provedor escolhido
`;

const { values: args } = parseArgs({
  options: {
    pdf: { type: 'string' },
    texto: { type: 'string' },
    pncp: { type: 'string' },
    saida: { type: 'string' },
    provedor: { type: 'string' },
    nivel: { type: 'string' },
    esforco: { type: 'string' }, // nome antigo de --nivel
    modelo: { type: 'string' },
    ajuda: { type: 'boolean', default: false },
  },
});

if (args.ajuda || ![args.pdf, args.texto, args.pncp].some(Boolean)) {
  console.log(AJUDA);
  process.exit(args.ajuda ? 0 : 2);
}

let ia;
try {
  ia = provedorDaIa(args.provedor ?? config.ia.provedor);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (!ia.chaveConfigurada) {
  const onde = ia.id === 'gemini' ? 'https://aistudio.google.com (botão "Get API key")' : 'https://console.anthropic.com';
  console.error(`Defina ${ia.variavelChave} no arquivo .env. Crie a chave em ${onde}.`);
  process.exit(1);
}
const nivel = args.nivel ?? args.esforco;

const SEVERIDADE = { alta: 0, media: 1, baixa: 2 };

try {
  let entrada;
  if (args.pdf) {
    const dados = verificarPdf(await readFile(args.pdf));
    entrada = { pdf: dados, nomeArquivo: basename(args.pdf) };
  } else if (args.texto) {
    entrada = { texto: await readFile(args.texto, 'utf8'), nomeArquivo: basename(args.texto) };
  } else {
    const compra = interpretarNumeroControle(args.pncp);
    if (!compra) throw new Error('Número de controle PNCP inválido. Formato: 19738706000183-1-000026/2023');
    console.log('Buscando a licitação no PNCP...');
    const licitacao = normalizarContratacao(await obterContratacao(compra)) ?? { numero_controle_pncp: args.pncp };
    console.log('Baixando o edital publicado...');
    const edital = await obterEditalDoPncp({
      ...licitacao, orgao_cnpj: compra.cnpj, ano_compra: compra.ano, sequencial_compra: compra.sequencial,
    });
    entrada = {
      pdf: edital.pdf,
      nomeArquivo: edital.nomeArquivo,
      contexto: {
        objeto: licitacao.objeto, orgao: licitacao.orgao_razao_social, modalidade: licitacao.modalidade_nome,
        numeroControle: licitacao.numero_controle_pncp, sistemaOrigem: licitacao.sistema_origem,
      },
    };
  }

  const modelo = args.modelo ?? ia.modelo;
  console.log(`Analisando "${entrada.nomeArquivo}" com ${ia.nome} (${modelo}). Editais longos podem levar alguns minutos...`);
  const inicio = Date.now();
  const r = await analisarEdital(entrada, { provedor: ia.id, modelo, esforco: nivel, pensamento: nivel });
  const segundos = Math.round((Date.now() - inicio) / 1000);

  const saida = args.saida ?? `analise-${entrada.nomeArquivo.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')}.json`;
  await writeFile(saida, JSON.stringify({ ...r.analise, _meta: { modelo: r.modelo, uso: r.uso, custoEstimadoUsd: r.custoEstimadoUsd } }, null, 2));

  const a = r.analise;
  const id = a.identificacao;
  const linha = (rotulo, valor) => valor && console.log(`  ${rotulo.padEnd(14)} ${valor}`);
  console.log('\n=== ANÁLISE DO EDITAL ===');
  linha('Objeto:', id.objeto);
  linha('Órgão:', id.orgao);
  linha('Edital:', id.numero_edital);
  linha('Julgamento:', id.criterio_julgamento);
  linha('Plataforma:', id.plataforma_disputa);
  linha('Valor:', id.valor_estimado);
  console.log(`\nResumo: ${a.resumo}`);

  if (a.prazos.length) {
    console.log('\nPrazos:');
    for (const p of a.prazos) console.log(`  - ${p.evento}: ${p.data_hora_texto}`);
  }

  console.log(`\nDocumentos obrigatórios (${a.documentos_obrigatorios.length}):`);
  for (const d of a.documentos_obrigatorios.slice(0, 20)) {
    console.log(`  [ ] ${d.documento} (${d.fase})${d.referencia ? ` - ${d.referencia}` : ''}`);
  }
  if (a.documentos_obrigatorios.length > 20) console.log(`  ... e mais ${a.documentos_obrigatorios.length - 20} no arquivo JSON`);

  console.log(`\nRiscos (${a.riscos.length}):`);
  for (const risco of [...a.riscos].sort((x, y) => SEVERIDADE[x.severidade] - SEVERIDADE[y.severidade])) {
    console.log(`  [${risco.severidade.toUpperCase()}] ${risco.titulo}\n      -> ${risco.recomendacao}`);
  }

  const custo = r.custoEstimadoUsd === 0 ? 'grátis (plano gratuito)' : `US$ ${r.custoEstimadoUsd ?? '?'}`;
  console.log(`\nConfiança: ${a.confianca} | ${ia.nome}: ${r.modelo} | Tokens: ${r.uso.entrada} entrada, ${r.uso.saida} saída | Custo estimado: ${custo} | ${segundos}s`);
  console.log(`Resultado completo salvo em: ${saida}`);
  console.log(`\n${a.aviso_legal}`);
} catch (e) {
  console.error(`\nNão foi possível analisar: ${e instanceof ErroAnalise ? e.message : e?.message ?? e}`);
  if (e instanceof ErroAnalise && e.detalhes) console.error('Detalhes:', typeof e.detalhes === 'string' ? e.detalhes : JSON.stringify(e.detalhes));
  process.exit(1);
}
