// Baixa as notas CAPAG do Tesouro Transparente e grava em public.capag.
// Uso: npm run capag
import { atualizarCapag } from '../src/capag/atualizar.js';
import { criarClienteAdmin } from '../src/supabase.js';
import { criarLog } from '../src/util.js';

const n = await atualizarCapag({ supabase: criarClienteAdmin(), log: criarLog('capag'), forcar: true });
console.log(`Pronto: ${n} notas CAPAG gravadas.`);
