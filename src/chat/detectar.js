// Detecção de gatilhos nas mensagens do chat do pregão (igual para todos os portais).
//
// Gatilhos:
//   mencao_cnpj  o CNPJ da empresa aparece (com ou sem pontuação)
//   mencao_nome  a razão social / nome fantasia aparece (sem LTDA, ME, EPP...)
//   convocacao   o pregoeiro convoca/solicita algo a um fornecedor
//   anexo        pedido de anexo, documento, proposta ajustada, catálogo, planilha
//   prazo        prazo, horário ou minutos para cumprir algo
//   suspensao    sessão suspensa, adiada, remarcada, reaberta, retomada
//   resultado    aceite, recusa, habilitação, inabilitação, desclassificação, adjudicação
//   palavra      uma das palavras de alerta cadastradas pela empresa
import { createHash } from 'node:crypto';

const sem = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digitos = (t) => String(t ?? '').replace(/\D/g, '');

// Partes do nome que não identificam a empresa.
const SUFIXOS = /\b(ltda|eireli|epp|me|mei|s\.?\/?a|sa|cia|comercio|servicos|e|de|do|da|dos|das)\b/g;

/** Nome "limpo" para comparar: sem acento, sem sufixo societário, com pelo menos 2 palavras ou 6 letras. */
export function nucleoDoNome(nome) {
  const n = sem(nome).replace(/[^a-z0-9 ]+/g, ' ').replace(SUFIXOS, ' ').replace(/\s+/g, ' ').trim();
  return n.length >= 6 || n.includes(' ') ? n : '';
}

const RE = {
  convocacao: /\b(convoc\w*|solicit\w*|encaminh\w*|envi[ea]\w*|apresent\w*|anex[ea]\w*|reenvi\w*|favor (enviar|anexar|encaminhar))\b/,
  anexo: /\b(anexo\w*|anexa\w*|document\w*|proposta (ajustada|atualizada|readequada)|catalog\w*|folder|planilha\w*|amostra\w*|ficha tecnica|laudo\w*|certidao|certidoes)\b/,
  prazo: /\b(prazo|ate as|no prazo|minutos?|horas?|\d{1,2}\s?h(\s?\d{2})?|\d{1,2}:\d{2}|data limite|impreterivelmente)\b/,
  suspensao: /\b(suspens\w*|suspend\w*|adiad\w*|remarc\w*|reabert\w*|retomad\w*|retom\w*|reagend\w*)\b/,
  resultado: /\b(aceit\w*|recusad\w*|habilitad\w*|inabilitad\w*|desclassific\w*|classificad\w*|adjudic\w*|homolog\w*|arrematante|vencedor\w*)\b/,
};

/** Papel de quem escreveu, pelo nome do autor. */
export function papelDoAutor(autor) {
  const a = sem(autor);
  if (/pregoeir|agente de contrata|comissao|presidente|condutor|leiloeir/.test(a)) return 'pregoeiro';
  if (/sistema|plataforma|automatic/.test(a)) return 'sistema';
  if (/fornecedor|licitante|participante|\d{2}\.?\d{3}\.?\d{3}/.test(a)) return 'fornecedor';
  return 'outro';
}

/**
 * Gatilhos de uma mensagem.
 * @param {string} texto
 * @param {{ cnpjs?: string[], nomes?: string[], palavras?: string[] }} perfil  dados da empresa que acompanha
 * @returns {{ gatilhos: string[], relevante: boolean }}
 */
export function detectarGatilhos(texto, { cnpjs = [], nomes = [], palavras = [] } = {}, papel = 'outro') {
  const t = sem(texto);
  const so = digitos(texto);
  const g = new Set();
  for (const c of cnpjs.map(digitos).filter((c) => c.length === 14)) {
    // CNPJ inteiro, ou a raiz (8 dígitos) com a filial (o pregoeiro às vezes escreve só parte).
    if (so.includes(c) || new RegExp(`${c.slice(0, 2)}\\D?${c.slice(2, 5)}\\D?${c.slice(5, 8)}`).test(texto)) g.add('mencao_cnpj');
  }
  const limpo = ` ${t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const n of nomes.map(nucleoDoNome).filter(Boolean)) {
    if (limpo.includes(` ${n} `)) g.add('mencao_nome');
  }
  for (const [nome, re] of Object.entries(RE)) if (re.test(t)) g.add(nome);
  for (const p of palavras.map(sem).filter(Boolean)) if (t.includes(p)) { g.add('palavra'); break; }
  // Convocação só conta quando vem com pedido de algo (evita "convocação geral" solta).
  if (g.has('convocacao') && !g.has('anexo') && !g.has('prazo') && !g.has('mencao_cnpj') && !g.has('mencao_nome')) g.delete('convocacao');

  const comigo = g.has('mencao_cnpj') || g.has('mencao_nome');
  const doPregoeiro = papel === 'pregoeiro' || papel === 'sistema';
  const relevante = comigo || g.has('palavra') || g.has('suspensao')
    || (doPregoeiro && (g.has('convocacao') || g.has('anexo') || (g.has('prazo') && g.has('resultado'))));
  return { gatilhos: [...g], relevante };
}

/** Identidade da mensagem para não gravar repetida (mesmo autor, texto e minuto). */
export function hashMensagem({ autor, texto, enviadaEm, idExterno }) {
  const base = idExterno ? `id:${idExterno}` : `${sem(autor)}|${sem(texto).replace(/\s+/g, ' ').trim()}|${String(enviadaEm || '').slice(0, 16)}`;
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}
