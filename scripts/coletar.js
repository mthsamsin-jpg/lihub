#!/usr/bin/env node
// Disparo manual dos coletores próprios de licitações (src/services/collectors).
//
// Exemplos:
//   npm run coletar                                       o que mudou desde ontem (padrão do .env)
//   npm run coletar -- --ufs=SP,MG --desde=2026-11-01     período e estados
//   npm run coletar -- --modo=publicacao --modalidades=6  só pregões eletrônicos publicados
//   npm run coletar -- --simular --ufs=SP --max-paginas=2 testa sem gravar
import { parseArgs } from 'node:util';
import { COLETORES, executarColeta } from '../src/services/collectors/index.js';
import { criarLogEstruturado } from '../src/services/collectors/log.js';
import { criarClienteAdmin } from '../src/supabase.js';

const AJUDA = `
Uso: node scripts/coletar.js [opções]

  --fontes=pncp              fontes (disponíveis: ${Object.keys(COLETORES).join(', ')}; padrão: SCRAPER_FONTES)
  --modo=atualizacao         publicacao | atualizacao | abertas (padrão: SCRAPER_MODO)
  --desde=AAAA-MM-DD         início do período (padrão: hoje - SCRAPER_DIAS_ATRAS)
  --ate=AAAA-MM-DD           fim do período (padrão: hoje)
  --ufs=SP,RJ                estados (padrão: SCRAPER_TARGET_UFS; vazio = todos)
  --modalidades=6,8          códigos do PNCP (padrão: PNCP_MODALIDADES)
  --max-paginas=400          limite de páginas (de 50) por modalidade/estado
  --lote=50                  linhas por upsert no Supabase
  --simular                  não grava; mostra o resumo e uma amostra
  --limpar                   no fim, apaga licitações encerradas há mais de LIMPAR_DIAS e o histórico antigo
  --permitir-nao-validado    roda coletores ainda não validados (só para teste)
  --ajuda
`;

const lista = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
const num = (v) => (v === undefined ? undefined : Number(v));

let a;
try {
  ({ values: a } = parseArgs({
    options: {
      fontes: { type: 'string' }, modo: { type: 'string' }, desde: { type: 'string' }, ate: { type: 'string' },
      ufs: { type: 'string' }, modalidades: { type: 'string' }, 'max-paginas': { type: 'string' }, lote: { type: 'string' },
      simular: { type: 'boolean', default: false }, limpar: { type: 'boolean', default: false }, 'permitir-nao-validado': { type: 'boolean', default: false },
      ajuda: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(`${e.message}\n${AJUDA}`);
  process.exit(2);
}
if (a.ajuda) { console.log(AJUDA); process.exit(0); }

const log = criarLogEstruturado('coleta', { formato: process.env.LOG_FORMATO || 'texto' });
const controle = new AbortController();
process.once('SIGINT', () => { log.aviso('cancelando', {}); controle.abort(new Error('Cancelada pelo usuário.')); });

try {
  const resumo = await executarColeta({
    fontes: lista(a.fontes), modo: a.modo, desde: a.desde, ate: a.ate, ufs: lista(a.ufs),
    modalidades: lista(a.modalidades)?.map(Number), maxPaginas: num(a['max-paginas']), lote: num(a.lote),
    simular: a.simular, limpar: a.limpar, permitirNaoValidado: a['permitir-nao-validado'],
  }, { supabase: a.simular ? null : criarClienteAdmin(), log, sinal: controle.signal });
  if (a.simular) for (const f of resumo.fontes) if (f.amostra?.length) console.log(`\nAmostra (${f.fonte}):\n${JSON.stringify(f.amostra, null, 2)}`);
  process.exit(resumo.falhas && !resumo.gravados ? 1 : 0);
} catch (e) {
  log.erro('coleta.falhou', { erro: e.message });
  process.exit(1);
}
