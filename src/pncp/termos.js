// Palavras-chave da busca: as mesmas regras da função buscar_licitacoes do banco
// (supabase/atualizar-busca.sql) e do site (LH.termos em componentes.js).
//   "copo, papel A4" = copo OU (papel E A4)
//   cada palavra casa com o COMEÇO de uma palavra do texto, sem acento nem maiúscula
//   ("copo" acha "copos", não "copa"; "a4" acha "A4").

export const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Texto digitado -> [[palavras da alternativa 1], [alternativa 2], ...]. */
export function gruposDeTermos(q) {
  return String(q ?? '')
    .split(/,|\s+or\s+/i)
    .map((g) => semAcento(g).split(/[^a-z0-9]+/).filter(Boolean))
    .filter((g) => g.length);
}

/** O texto tem todas as palavras de pelo menos uma alternativa? (sem palavras = sim) */
export function casaTermos(texto, grupos) {
  if (!grupos?.length) return true;
  const t = semAcento(texto);
  return grupos.some((g) => g.every((w) => new RegExp(`(^|[^a-z0-9])${w}`).test(t)));
}

// Natureza da compra pelo texto do objeto (mesmas regras de public.tipo_objeto).
const SERVICO = /(^|[^a-z0-9])(prestacao de servico|servicos? (de|continuad|comum|tecnic|especializad|terceirizad|grafic|medic|odontolog|laborator)|contratacao de (empresa )?(especializada )?(para )?(a )?(prestacao|execucao|realizacao|manutencao|locacao|organizacao)|manutencao|locacao|obras?([^a-z0-9]|$)|reforma|construcao|pavimentacao|consultoria|assessoria|vigilancia|limpeza e conservacao|transporte escolar|coleta de residuos|recapeamento|engenharia)/;
const COMPRA_FORTE = /(^|[^a-z0-9])(aquisic|fornecimento de (materia|produto|equipament|genero|insumo|medicament)|compra de)/;
const MATERIAL = /(^|[^a-z0-9])(aquisic|fornecimento|compra de|materia(l|is)|produtos?|equipamentos?|generos? alimenticios|medicamentos?|insumos?|mobiliario|veiculos?)/;
const SERVICO_FORTE = /(^|[^a-z0-9])(prestacao de servico|contratacao de (empresa )?(especializada )?(para )?(a )?(prestacao|execucao))/;

/** 'material' | 'servico' | 'misto'. */
export function tipoObjeto(objeto) {
  const x = semAcento(objeto);
  if (SERVICO.test(x) && !COMPRA_FORTE.test(x)) return 'servico';
  if (MATERIAL.test(x) && !SERVICO_FORTE.test(x)) return 'material';
  return 'misto';
}

/** Natureza pelos itens (M/S do PNCP), quando todos concordam; senão null. */
export function tipoDosItens(itens) {
  const tipos = new Set((itens || []).map((i) => semAcento(i.tipo)).filter(Boolean).map((t) => (t.startsWith('serv') ? 'servico' : 'material')));
  return tipos.size === 1 ? [...tipos][0] : null;
}

/** O tipo pedido (material | servico) aceita esta natureza? 'misto' passa nos dois. */
export const aceitaTipo = (pedido, natureza) => !pedido || natureza === 'misto' || natureza === pedido;
