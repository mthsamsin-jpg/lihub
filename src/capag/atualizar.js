// Grava as notas CAPAG do Tesouro na tabela public.capag (upsert em lotes).
import { buscarCapag } from './fonte.js';

export const CAPAG_VALIDADE_DIAS = 7;

/** Atualiza se o cache estiver vazio ou com mais de `validadeDias`. Devolve o nº gravado (0 = não precisou). */
export async function atualizarCapag({ supabase, log, forcar = false, validadeDias = CAPAG_VALIDADE_DIAS }) {
  if (!forcar) {
    const { data } = await supabase.from('capag').select('atualizado_em').order('atualizado_em', { ascending: false }).limit(1);
    const ultima = data?.[0]?.atualizado_em ? new Date(data[0].atualizado_em) : null;
    if (ultima && Date.now() - ultima < validadeDias * 86_400_000) return 0;
  }
  const linhas = await buscarCapag();
  if (linhas.length < 100) throw new Error(`CAPAG: só ${linhas.length} notas na planilha, nada gravado`);
  const agora = new Date().toISOString();
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error } = await supabase.from('capag').upsert(linhas.slice(i, i + 1000).map((l) => ({ ...l, atualizado_em: agora })));
    if (error) throw new Error(`CAPAG: ${error.message}`);
  }
  log?.info?.(`CAPAG: ${linhas.length} nota(s) atualizada(s) (${linhas[0].fonte}).`);
  return linhas.length;
}
