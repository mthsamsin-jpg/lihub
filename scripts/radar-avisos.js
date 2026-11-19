#!/usr/bin/env node
// Roda uma rodada dos avisos do Radar por e-mail (a mesma do agendamento diário).
//   npm run radar:avisos -- --simular   mostra quem receberia o quê, sem enviar nem marcar nada
//   npm run radar:avisos                envia de verdade (precisa de RESEND_API_KEY)
import { avisarRadares, enviadorDoAmbiente } from '../src/radar/avisos.js';
import { canaisDoAmbiente } from '../worker/notificacoes.js';
import { criarClienteAdmin } from '../src/supabase.js';
import { criarLog } from '../src/util.js';

const simular = process.argv.includes('--simular');
const canais = canaisDoAmbiente();
try {
  const r = await avisarRadares({ supabase: criarClienteAdmin(), enviar: enviadorDoAmbiente(canais), site: canais.site, log: criarLog('radar'), simular });
  const { previa, ...resto } = r;
  console.log(resto);
  for (const p of previa) console.log(`- ${p.para.replace(/(.{2}).*@/, '$1***@')}: "${p.assunto}" (${p.radares.join('; ')})`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
