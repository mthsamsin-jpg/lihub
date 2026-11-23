// Horário de pico (mais gente usando o app): à noite nos dias úteis e no fim de semana.
// Nessa janela, as coletas pesadas em segundo plano (inteligência de mercado) esperam,
// para o banco ficar livre para as buscas de quem está usando.
//
// Variáveis (horário de Brasília, horas inteiras "início-fim", fim incluído):
//   PICO=0                      desliga (coleta a qualquer hora)
//   PICO_HORAS_UTEIS=18-23      segunda a sexta
//   PICO_HORAS_FIM_SEMANA=9-23  sábado e domingo

function faixa(texto) {
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(String(texto ?? ''));
  if (!m) return null;
  const [ini, fim] = [Number(m[1]), Number(m[2])];
  return ini <= 23 && fim <= 23 ? [ini, fim] : null;
}

const dentro = (hora, f) => !!f && (f[0] <= f[1] ? hora >= f[0] && hora <= f[1] : hora >= f[0] || hora <= f[1]);

/** Hora (0-23) e dia da semana (0 = domingo) em Brasília. */
export function agoraBrasilia(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(data);
  const hora = Number(partes.find((p) => p.type === 'hour').value) % 24;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.find((p) => p.type === 'weekday').value);
  return { hora, dia };
}

export function emHorarioDePico(data = new Date(), env = process.env) {
  if (env.PICO === '0') return false;
  const { hora, dia } = agoraBrasilia(data);
  const fimDeSemana = dia === 0 || dia === 6;
  return dentro(hora, faixa(fimDeSemana ? (env.PICO_HORAS_FIM_SEMANA ?? '9-23') : (env.PICO_HORAS_UTEIS ?? '18-23')));
}
