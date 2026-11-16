// Clientes do Supabase usados no servidor (Node.js).
import { createClient } from '@supabase/supabase-js';
import { config, exigir } from './config.js';

const semSessao = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/**
 * Cliente administrativo (chave secreta / service_role): ignora o RLS.
 * Use só no servidor, para tarefas do sistema (sincronizar PNCP, gravar
 * resultados da IA). Nunca envie essa chave ao navegador.
 */
export function criarClienteAdmin() {
  return createClient(
    exigir(config.supabase.url, 'SUPABASE_URL'),
    exigir(config.supabase.chaveSecreta, 'SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY)'),
    semSessao,
  );
}

/**
 * Cliente "como o usuário": usa o token de login dele, então o RLS vale.
 * Assim o servidor só lê o que aquele usuário poderia ler.
 */
export function criarClienteDoUsuario(token) {
  return createClient(
    exigir(config.supabase.url, 'SUPABASE_URL'),
    exigir(config.supabase.chavePublica, 'SUPABASE_PUBLISHABLE_KEY (ou SUPABASE_ANON_KEY)'),
    { ...semSessao, global: { headers: { Authorization: `Bearer ${token}` } } },
  );
}
