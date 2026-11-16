#!/usr/bin/env node
// Sincroniza licitações do PNCP com o Supabase.
//
// Exemplos:
//   npm run sync                                   carga completa (propostas abertas, todo o Brasil)
//   npm run sync -- --modo=atualizacao             só o que mudou desde ontem (rápido)
//   npm run sync -- --ufs=SP,MG --modalidades=6    só pregões eletrônicos de SP e MG
//   npm run sync:simular                           testa a conexão com o PNCP sem gravar nada
import { parseArgs } from 'node:util';
import { sincronizarPncp } from '../src/pncp/sincronizar.js';
import { MODALIDADES } from '../src/pncp/dominio.js';
import { criarClienteAdmin } from '../src/supabase.js';
import { criarLog } from '../src/util.js';

const AJUDA = `
Uso: node scripts/sync-pncp.js [opções]

  --modo=abertas|atualizacao   abertas (padrão): propostas abertas; atualizacao: o que mudou no período
  --dias=60                    abertas: inclui o que encerra até hoje + N dias
  --desde=AAAA-MM-DD           atualizacao: início (padrão: ontem)
  --ate=AAAA-MM-DD             atualizacao: fim (padrão: hoje)
  --modalidades=6,8,4          códigos (padrão: PNCP_MODALIDADES do .env ou 6,8,4)
  --ufs=SP,RJ                  estados (padrão: todos)
  --max-paginas=400            limite de páginas (de 50) por modalidade/estado
  --concorrencia=1             consultas simultâneas ao PNCP (com mais de 1 ele costuma recusar: HTTP 429)
  --limpar-dias=90             apaga do catálogo o que encerrou há mais de N dias (0 = não apaga)
  --simular                    não grava no Supabase; só mostra o que seria gravado
  --ajuda

Modalidades: ${Object.entries(MODALIDADES).map(([k, v]) => `${k}=${v}`).join(', ')}
`;

const numeroOuNada = (v) => (v === undefined ? undefined : Number(v));
const listaOuNada = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      modo: { type: 'string' },
      dias: { type: 'string' },
      desde: { type: 'string' },
      ate: { type: 'string' },
      modalidades: { type: 'string' },
      ufs: { type: 'string' },
      'max-paginas': { type: 'string' },
      concorrencia: { type: 'string' },
      'limpar-dias': { type: 'string' },
      simular: { type: 'boolean', default: false },
      ajuda: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n${AJUDA}`);
  process.exit(2);
}

if (args.ajuda) {
  console.log(AJUDA);
  process.exit(0);
}

const log = criarLog('pncp');
const controle = new AbortController();
process.once('SIGINT', () => {
  log.aviso('Interrompendo... (aperte Ctrl+C de novo para forçar)');
  controle.abort(new Error('Sincronização interrompida pelo usuário.'));
  process.once('SIGINT', () => process.exit(130));
});

const inicio = Date.now();
try {
  const resumo = await sincronizarPncp(
    {
      modo: args.modo,
      dias: numeroOuNada(args.dias),
      desde: args.desde,
      ate: args.ate,
      modalidades: listaOuNada(args.modalidades)?.map(Number),
      ufs: listaOuNada(args.ufs),
      maxPaginas: numeroOuNada(args['max-paginas']),
      concorrencia: numeroOuNada(args.concorrencia),
      limparDias: numeroOuNada(args['limpar-dias']),
      simular: args.simular,
    },
    { supabase: args.simular ? null : criarClienteAdmin(), log, sinal: controle.signal },
  );

  const minutos = ((Date.now() - inicio) / 60000).toFixed(1);
  console.log(`
Resumo (${resumo.simulado ? 'SIMULAÇÃO - nada foi gravado' : 'gravado no Supabase'})
  modo .............. ${resumo.modo}
  janela ............ ${JSON.stringify(resumo.janela)}
  consultas ......... ${resumo.tarefas} (${resumo.paginas} páginas)
  registros lidos ... ${resumo.recebidos}
  ${resumo.simulado ? 'seriam gravados ...' : 'gravados ..........'} ${resumo.gravados}
  ignorados (velhos)  ${resumo.ignorados}
  removidos (antigos) ${resumo.removidas}
  falhas ............ ${resumo.falhas.length}
  situação .......... ${resumo.status}${resumo.interrompido ? ' (interrompida: o PNCP recusou as consultas)' : ''}
  tempo ............. ${minutos} min`);

  if (resumo.simulado && resumo.amostra.length) {
    console.log('\nAmostra do que seria gravado:');
    for (const l of resumo.amostra) {
      console.log(`  - [${l.uf}] ${l.modalidade_nome} | ${l.orgao_razao_social}\n    ${l.objeto.slice(0, 110)}\n    valor: ${l.valor_estimado ?? 'não informado'} | encerra: ${l.data_encerramento_proposta} | portal: ${l.sistema_origem}`);
    }
  }
  process.exit(resumo.status === 'erro' || resumo.interrompido ? 1 : 0);
} catch (e) {
  log.erro(e.message);
  process.exit(1);
}
