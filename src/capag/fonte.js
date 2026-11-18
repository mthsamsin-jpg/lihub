// =============================================================================
// Uso LicitaHub · CAPAG (Capacidade de Pagamento) do Tesouro Nacional
// Baixa as planilhas abertas do Tesouro Transparente (CKAN) e devolve as notas:
//   - Municípios: XLSX "capag-municipios" (chave = código IBGE de 7 dígitos)
//   - Estados/DF: CSV  "capag-estados"   (chave = "UF-SP")
// Sem dependências: o XLSX é lido com um leitor de ZIP mínimo (zlib do Node).
// =============================================================================
import { inflateRawSync } from 'node:zlib';

const CKAN = 'https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show?id=';

/** Nota oficial normalizada ("A", "B+", "C", "D"...) ou null quando não há nota. */
export function normalizarNota(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[ABCD]\+?$/.test(s) ? s : null;
}

/** Recurso mais recente do pacote (o CKAN lista em ordem de inclusão). */
export async function recursoMaisRecente(pacote, formato) {
  const r = await fetch(CKAN + pacote, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`CKAN ${pacote}: HTTP ${r.status}`);
  const lista = (await r.json()).result.resources.filter((x) => String(x.format).toUpperCase() === formato);
  if (!lista.length) throw new Error(`CKAN ${pacote}: nenhum ${formato}`);
  const ultimo = lista[lista.length - 1];
  return { url: ultimo.url, nome: ultimo.name.trim() };
}

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`download ${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// --- ZIP mínimo: lê o diretório central e descompacta só os arquivos pedidos.
export function lerZip(buf, nomes) {
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error('XLSX inválido');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = {};
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nl);
    if (nomes.includes(nome)) {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(ini, ini + tamanho);
      saida[nome] = (metodo === 0 ? dados : inflateRawSync(dados)).toString('utf8');
    }
    p += 46 + nl + el + cl;
  }
  return saida;
}

const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colunaIdx = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Linhas (arrays de texto) da primeira planilha de um XLSX. */
export function linhasXlsx(buf) {
  const f = lerZip(buf, ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  const comp = [...(f['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const linhas = [];
  for (const m of (f['xl/worksheets/sheet1.xml'] || '').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha = [];
    for (const c of m[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tipo = /t="(\w+)"/.exec(c[2])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] || '')?.[1];
      const inl = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] || '')?.[1];
      linha[colunaIdx(c[1])] = tipo === 's' ? comp[Number(v)] : desescapar(v ?? inl ?? '');
    }
    linhas.push(linha);
  }
  return linhas;
}

const sem = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Acha a linha de cabeçalho e as colunas de código IBGE e nota final. */
export function notasMunicipios(linhas) {
  // Cabeçalho da aba "Prévia da CAPAG": "Código Município Completo" ... "CAPAG" (nota final).
  const ehIbge = (c) => /ibge|codigo municipio/.test(sem(c));
  const ehNota = (c) => /^(capag|classificacao da capag)$/.test(sem(c));
  const h = linhas.findIndex((l) => l?.some(ehIbge) && l.some(ehNota));
  if (h < 0) throw new Error('CAPAG municípios: cabeçalho não encontrado');
  const iIbge = linhas[h].findIndex(ehIbge);
  const iNota = linhas[h].findIndex(ehNota);
  const notas = new Map();
  for (const l of linhas.slice(h + 1)) {
    const ibge = String(l?.[iIbge] ?? '').replace(/\D/g, '');
    const nota = normalizarNota(l?.[iNota]);
    if (/^\d{7}$/.test(ibge) && nota) notas.set(ibge, nota);
  }
  return notas;
}

/** CSV dos estados (separado por ";"): UF + "Classificação da CAPAG". */
export function notasEstados(csv) {
  const linhas = csv.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(';'));
  const cab = linhas[0].map(sem);
  const iUf = cab.findIndex((c) => c === 'uf');
  const iNota = cab.findIndex((c) => /classificacao.*capag|^capag$/.test(c));
  if (iUf < 0 || iNota < 0) throw new Error('CAPAG estados: colunas não encontradas');
  const notas = new Map();
  for (const l of linhas.slice(1)) {
    const uf = String(l[iUf] ?? '').trim().toUpperCase();
    const nota = normalizarNota(l[iNota]);
    if (/^[A-Z]{2}$/.test(uf) && nota) notas.set(`UF-${uf}`, nota);
  }
  return notas;
}

/** Baixa as duas bases e devolve linhas prontas para a tabela public.capag. */
export async function buscarCapag() {
  const [mun, est] = await Promise.all([recursoMaisRecente('capag-municipios', 'XLSX'), recursoMaisRecente('capag-estados', 'CSV')]);
  const [bm, be] = await Promise.all([baixar(mun.url), baixar(est.url)]);
  const linhas = [];
  for (const [chave, nota] of notasMunicipios(linhasXlsx(bm))) linhas.push({ chave, nota, fonte: mun.nome });
  for (const [chave, nota] of notasEstados(be.toString('utf8'))) linhas.push({ chave, nota, fonte: est.nome });
  return linhas;
}
