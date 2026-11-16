// Utilitários pequenos usados em vários módulos.

export const esperar = (ms, sinal) =>
  new Promise((resolve, reject) => {
    if (sinal?.aborted) return reject(sinal.reason);
    const t = setTimeout(resolve, ms);
    sinal?.addEventListener('abort', () => { clearTimeout(t); reject(sinal.reason); }, { once: true });
  });

// Executa no máximo `max` tarefas assíncronas ao mesmo tempo.
export function criarLimitador(max) {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    if (ativos >= max || fila.length === 0) return;
    ativos++;
    const { tarefa, resolve, reject } = fila.shift();
    Promise.resolve().then(tarefa).then(resolve, reject).finally(() => { ativos--; proximo(); });
  };
  const limitar = (tarefa) => new Promise((resolve, reject) => { fila.push({ tarefa, resolve, reject }); proximo(); });
  limitar.pendentes = () => fila.length + ativos;
  return limitar;
}

// Datas no fuso de Brasília (o PNCP trabalha nesse horário).
const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Dia de hoje em Brasília, no formato AAAA-MM-DD. */
export function hojeBrasilia(agora = new Date()) {
  return formatoDia.format(agora);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** AAAA-MM-DD -> AAAAMMDD (formato exigido pelo PNCP). */
export const diaPncp = (dia) => dia.replaceAll('-', '');

export function validarDia(dia, nome = 'data') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) {
    throw new Error(`${nome} inválida: use o formato AAAA-MM-DD (recebido "${dia}").`);
  }
  return dia;
}

export function criarLog(prefixo = '') {
  const linha = (nivel, msg) => {
    const hora = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `[${hora}]${prefixo ? ` [${prefixo}]` : ''}${nivel ? ` ${nivel}` : ''} ${msg}`;
  };
  return {
    info: (msg) => console.log(linha('', msg)),
    aviso: (msg) => console.warn(linha('AVISO:', msg)),
    erro: (msg) => console.error(linha('ERRO:', msg)),
  };
}
