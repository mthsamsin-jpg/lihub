// Testa a conversão dos dados do PNCP (sem acessar a internet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dataPncp, normalizarContratacao, normalizarPagina, urlSegura } from '../src/pncp/normalizar.js';
import { interpretarNumeroControle } from '../src/pncp/dominio.js';
import { ajustarRitmo, escolherEdital, obterJson } from '../src/pncp/cliente.js';
import { sincronizarPncp } from '../src/pncp/sincronizar.js';
import { somarDias, hojeBrasilia } from '../src/util.js';

const registro = JSON.parse(await readFile(new URL('./fixtures/contratacao-pncp.json', import.meta.url), 'utf8'));

test('datas do PNCP são interpretadas no horário de Brasília', () => {
  assert.equal(dataPncp('2026-12-08T23:59:59'), '2026-12-09T02:59:59.000Z');
  assert.equal(dataPncp('2026-12-08T09:00:00.123'), '2026-12-08T12:00:00.123Z');
  assert.equal(dataPncp('2026-12-08'), '2026-12-08T03:00:00.000Z');
  assert.equal(dataPncp('2026-12-08T09:00:00Z'), '2026-12-08T09:00:00.000Z');
  assert.equal(dataPncp(''), null);
  assert.equal(dataPncp('não é data'), null);
});

test('registro real do PNCP vira linha da tabela licitacoes', () => {
  const l = normalizarContratacao(registro, { agora: '2026-11-15T12:00:00.000Z' });
  assert.equal(l.fonte, 'pncp');
  assert.equal(l.numero_controle_pncp, '19738706000183-1-000026/2023');
  assert.equal(l.orgao_cnpj, '19738706000183');
  assert.equal(l.uf, 'MG');
  assert.equal(l.municipio, 'Ponte Nova');
  assert.equal(l.modalidade_id, 12);
  assert.equal(l.valor_estimado, 10361.99);
  assert.equal(l.srp, false);
  assert.equal(l.amparo_legal, 'Lei 14.133/2021, Art. 79, I');
  assert.equal(l.sistema_origem, 'Licitar Digital - Plataforma de Licitações Online');
  assert.equal(l.link_sistema_origem, 'https://app2.licitardigital.com.br/pesquisa/19329');
  assert.equal(l.data_encerramento_proposta, '2026-12-09T02:59:59.000Z');
  assert.equal(l.informacao_complementar, null, 'texto vazio vira null');
  assert.equal(l.dados_brutos, null);
  assert.equal(l.sincronizado_em, '2026-11-15T12:00:00.000Z');
  assert.ok(!('link_pncp' in l) && !('busca' in l), 'colunas geradas pelo banco não são enviadas');
});

test('limpeza de dados: caractere nulo, links perigosos e repetidos', () => {
  const sujo = {
    ...registro,
    objetoCompra: 'Aquisição\u0000 de papel ',
    linkSistemaOrigem: 'javascript:alert(1)',
    orcamentoSigilosoCodigo: 3,
  };
  const l = normalizarContratacao(sujo, { guardarBruto: true });
  assert.equal(l.objeto, 'Aquisição de papel');
  assert.equal(l.link_sistema_origem, null);
  assert.equal(l.orcamento_sigiloso, true);
  assert.ok(!JSON.stringify(l.dados_brutos).includes('\\u0000'));
  assert.equal(urlSegura('https://pncp.gov.br/app'), 'https://pncp.gov.br/app');

  assert.equal(normalizarContratacao({ objetoCompra: 'sem chave' }), null);
  const pagina = normalizarPagina([registro, { ...registro, objetoCompra: 'versão mais nova' }, { objetoCompra: 'sem chave' }]);
  assert.equal(pagina.length, 1, 'repetidos no mesmo lote quebrariam o upsert');
  assert.equal(pagina[0].objeto, 'versão mais nova');
});

test('número de controle, escolha do edital e datas auxiliares', () => {
  assert.deepEqual(interpretarNumeroControle('19738706000183-1-000026/2023'), { cnpj: '19738706000183', sequencial: 26, ano: 2023 });
  assert.equal(interpretarNumeroControle('qualquer coisa'), null);

  const compra = { cnpj: '19738706000183', ano: 2023, sequencial: 26 };
  const arquivos = [
    { sequencialDocumento: 1, titulo: 'Aviso de edital', tipoDocumentoNome: 'Aviso de Contratação Direta', statusAtivo: true },
    { sequencialDocumento: 2, titulo: 'Edital PE 45-2026', tipoDocumentoNome: 'Edital', statusAtivo: true, url: 'https://pncp.gov.br/pncp-api/v1/orgaos/19738706000183/compras/2023/26/arquivos/2' },
    { sequencialDocumento: 3, titulo: 'Edital antigo', tipoDocumentoNome: 'Edital', statusAtivo: false },
  ];
  assert.deepEqual(escolherEdital(arquivos, compra), {
    url: 'https://pncp.gov.br/pncp-api/v1/orgaos/19738706000183/compras/2023/26/arquivos/2',
    titulo: 'Edital PE 45-2026',
  });
  const semUrl = escolherEdital([{ sequencialDocumento: 7, tipoDocumentoNome: 'Termo de Referência' }], compra);
  assert.match(semUrl.url, /\/v1\/orgaos\/19738706000183\/compras\/2023\/26\/arquivos\/7$/);
  assert.equal(escolherEdital([], compra), null);

  assert.equal(somarDias('2026-12-30', 3), '2027-01-02');
  assert.match(hojeBrasilia(), /^\d{4}-\d{2}-\d{2}$/);
});

test('PNCP: um 429 pausa todas as consultas e depois tenta de novo', async () => {
  ajustarRitmo({ intervaloMs: 0, pausaInicialMs: 80, pausaMaximaMs: 1000, recusasMaximas: 3 });
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url) => {
    chamadas.push({ url: String(url), quando: Date.now() });
    return chamadas.length === 1
      ? new Response('Too Many Requests', { status: 429 })
      : new Response('{"data":[]}', { status: 200 });
  };
  try {
    let outra;
    const avisos = [];
    const resposta = await obterJson('https://pncp.gov.br/api/consulta/a', {
      aoFalhar: (info) => {
        avisos.push(info);
        outra = obterJson('https://pncp.gov.br/api/consulta/b'); // começa durante a pausa
      },
    });
    assert.deepEqual(resposta, { data: [] });
    assert.deepEqual(await outra, { data: [] });
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].esperaMs, 80);
    assert.match(avisos[0].erro.message, /429/);
    assert.equal(chamadas.length, 3);
    for (const c of chamadas.slice(1)) {
      assert.ok(c.quando - chamadas[0].quando >= 75, `consulta antes do fim da pausa (${c.quando - chamadas[0].quando} ms)`);
    }
  } finally {
    globalThis.fetch = original;
    ajustarRitmo();
  }
});

test('sincronização para sem insistir quando o PNCP recusa sempre (429)', async () => {
  ajustarRitmo({ intervaloMs: 0, pausaInicialMs: 5, pausaMaximaMs: 20, recusasMaximas: 3 });
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    return new Response('', { status: 429 });
  };
  const silencioso = { info() {}, aviso() {}, erro() {} };
  try {
    const resumo = await sincronizarPncp(
      { simular: true, ufs: ['AC', 'AL', 'AM'], modalidades: [6] },
      { log: silencioso },
    );
    assert.match(resumo.interrompido, /429/);
    assert.equal(resumo.status, 'erro');
    assert.equal(chamadas, 3); // só a primeira consulta insistiu; os outros estados nem começaram
  } finally {
    globalThis.fetch = original;
    ajustarRitmo();
  }
});
