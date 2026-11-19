// Log estruturado dos coletores: uma linha JSON por evento (fácil de filtrar no
// painel do Render ou com `grep`/`jq` na VPS).
//   {"ts":"...","nivel":"info","modulo":"coleta","evento":"pagina.gravada","fonte":"pncp",...}
// LOG_FORMATO=texto troca para linhas legíveis (útil no terminal do computador).

export function criarLogEstruturado(modulo = 'coleta', { saida = console, formato = process.env.LOG_FORMATO || 'json' } = {}) {
  const escrever = (nivel, evento, dados = {}) => {
    const fn = nivel === 'erro' ? saida.error : nivel === 'aviso' ? saida.warn : saida.log;
    if (formato === 'texto') {
      const extra = Object.entries(dados).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
      fn.call(saida, `[${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}] [${modulo}] ${nivel.toUpperCase()} ${evento} ${extra}`.trimEnd());
    } else {
      fn.call(saida, JSON.stringify({ ts: new Date().toISOString(), nivel, modulo, evento, ...dados }));
    }
  };
  return {
    info: (evento, dados) => escrever('info', evento, dados),
    aviso: (evento, dados) => escrever('aviso', evento, dados),
    erro: (evento, dados) => escrever('erro', evento, dados),
    filho: (extra) => {
      const pai = criarLogEstruturado(modulo, { saida, formato });
      return {
        info: (e, d) => pai.info(e, { ...extra, ...d }),
        aviso: (e, d) => pai.aviso(e, { ...extra, ...d }),
        erro: (e, d) => pai.erro(e, { ...extra, ...d }),
        filho: (mais) => pai.filho({ ...extra, ...mais }),
      };
    },
  };
}
