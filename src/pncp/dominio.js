// Tabelas de domínio do PNCP (Manual de Integração / API de Consulta).

export const MODALIDADES = Object.freeze({
  1: 'Leilão - Eletrônico',
  2: 'Diálogo Competitivo',
  3: 'Concurso',
  4: 'Concorrência - Eletrônica',
  5: 'Concorrência - Presencial',
  6: 'Pregão - Eletrônico',
  7: 'Pregão - Presencial',
  8: 'Dispensa de Licitação',
  9: 'Inexigibilidade',
  10: 'Manifestação de Interesse',
  11: 'Pré-qualificação',
  12: 'Credenciamento',
  13: 'Leilão - Presencial',
});

export const UFS = Object.freeze([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

/**
 * Número de controle PNCP -> partes da compra.
 * Ex.: "19738706000183-1-000026/2023" -> { cnpj, ano: 2023, sequencial: 26 }
 */
export function interpretarNumeroControle(numero) {
  const m = /^([0-9A-Z]{12}\d{2})-\d+-(\d+)\/(\d{4})$/.exec(String(numero ?? '').trim().toUpperCase());
  if (!m) return null;
  return { cnpj: m[1], sequencial: Number(m[2]), ano: Number(m[3]) };
}
