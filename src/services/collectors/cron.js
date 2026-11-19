// Agendador cron mínimo (5 campos: minuto hora dia-do-mês mês dia-da-semana),
// avaliado no horário de Brasília. Sem dependência externa.
// Aceita: *  5  1,15  1-5  */10  8-18/2
const FUSO = 'America/Sao_Paulo';
const LIMITES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
const NOMES = ['minuto', 'hora', 'dia', 'mês', 'dia da semana'];

function campo(txt, [min, max], nome) {
  const valores = new Set();
  for (const parte of txt.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(parte.trim());
    if (!m) throw new Error(`Cron inválido no campo ${nome}: "${parte}".`);
    let de = m[1] === '*' ? min : Number(m[2]);
    let ate = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : de;
    const passo = m[4] ? Number(m[4]) : 1;
    if (nome === 'dia da semana') { if (de === 7) de = 0; if (ate === 7) ate = 6; }
    if (de < min || ate > max || de > ate || passo < 1) throw new Error(`Cron inválido no campo ${nome}: "${parte}" (de ${min} a ${max}).`);
    for (let v = de; v <= ate; v += passo) valores.add(v);
  }
  return valores;
}

/** "0 *\/2 * * *" -> função (Date) => boolean. */
export function interpretarCron(expr) {
  const partes = String(expr || '').trim().split(/\s+/);
  if (partes.length !== 5) throw new Error(`Cron precisa de 5 campos (minuto hora dia mês semana); recebido "${expr}".`);
  const [mi, ho, di, me, se] = partes.map((p, i) => campo(p, LIMITES[i], NOMES[i]));
  const diaLivre = partes[2] === '*';
  const semanaLivre = partes[4] === '*';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, hourCycle: 'h23', minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short' });
  const SEMANA = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return (data) => {
    const p = Object.fromEntries(fmt.formatToParts(data).map((x) => [x.type, x.value]));
    const okDia = di.has(Number(p.day));
    const okSemana = se.has(SEMANA[p.weekday]);
    // regra do cron clássico: se os dois campos de dia estão restritos, basta um bater
    const dia = diaLivre || semanaLivre ? okDia && okSemana : okDia || okSemana;
    return mi.has(Number(p.minute)) && ho.has(Number(p.hour)) && me.has(Number(p.month)) && dia;
  };
}

/**
 * Chama `tarefa` a cada minuto que bate com `expr`. Devolve { parar }.
 * @param {string} expr
 * @param {() => any} tarefa
 */
export function agendarCron(expr, tarefa, { log = null } = {}) {
  const bate = interpretarCron(expr);
  let timer = null;
  let parado = false;
  const proximo = () => {
    if (parado) return;
    const agora = Date.now();
    timer = setTimeout(() => {
      const momento = new Date(Math.round(Date.now() / 60_000) * 60_000);
      if (bate(momento)) Promise.resolve().then(tarefa).catch((e) => log?.erro?.('cron.falhou', { erro: e.message }));
      proximo();
    }, 60_000 - (agora % 60_000) + 50);
    timer.unref?.();
  };
  proximo();
  return { parar: () => { parado = true; clearTimeout(timer); } };
}
