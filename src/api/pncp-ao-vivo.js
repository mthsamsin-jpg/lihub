// Busca AO VIVO no PNCP (exige login, pelo middleware /api/* do app.js):
//   GET /api/pncp/busca?q=copo, papel A4&pagina=1&uf=SP&tipo=material
//       contratações com propostas abertas, CONFERIDAS: a palavra precisa estar no
//       objeto ou na descrição de algum item (o PNCP também devolve editais em que
//       a palavra só aparece em anexos ou de forma parecida; esses saem).
//   GET /api/pncp/compras/:cnpj/:ano/:sequencial/itens   itens (quantidade e valor unitário estimado)
import { listarItens } from '../pncp/cliente.js';
import { normalizarItens } from '../pncp/detalhes.js';
import { buscarNoPncp, ErroBuscaPncp } from '../pncp/busca.js';
import { UFS } from '../pncp/dominio.js';
import { aceitaTipo, casaTermos, gruposDeTermos, tipoDosItens, tipoObjeto } from '../pncp/termos.js';

const MAX_ALTERNATIVAS = 5;
const ITENS_EM_PARALELO = 5;

/** Roda fn em cada elemento, no máximo n de cada vez. */
async function emLotes(lista, n, fn) {
  const saida = new Array(lista.length);
  let proximo = 0;
  const trabalhar = async () => {
    while (proximo < lista.length) {
      const k = proximo++;
      saida[k] = await fn(lista[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, trabalhar));
  return saida;
}

/**
 * Confere cada resultado: palavra no objeto, senão nos itens (lidos no PNCP).
 * Devolve só os que passam, com achadoEm ('objeto' | 'itens' | 'nao_conferido'),
 * itensComTermo (quantos itens têm a palavra, quando os itens foram lidos) e tipo.
 */
export async function conferirResultados(resultados, { grupos, tipo = null, itens = listarItens }) {
  const conferidos = await emLotes(resultados, ITENS_EM_PARALELO, async (r) => {
    const noObjeto = casaTermos(`${r.objeto || ''} ${r.titulo || ''}`, grupos);
    // Itens só quando precisa: palavra fora do objeto, ou tipo pedido e objeto ambíguo.
    const precisaItens = grupos.length && (!noObjeto || (tipo && tipoObjeto(r.objeto) === 'misto'));
    let lista = null;
    if (precisaItens && r.cnpj && r.ano && r.sequencial) {
      try {
        lista = normalizarItens(await itens({ cnpj: r.cnpj, ano: r.ano, sequencial: r.sequencial }, { tentativas: 1, maxPaginas: 2 }));
      } catch { lista = null; }
    }
    const itensComTermo = lista ? lista.filter((i) => casaTermos(i.descricao, grupos)).length : null;
    let achadoEm = 'objeto';
    if (!noObjeto) {
      if (lista == null) achadoEm = 'nao_conferido';
      else if (itensComTermo > 0) achadoEm = 'itens';
      else return null; // nem no objeto nem nos itens: fora
    }
    const natureza = tipoDosItens(lista) || tipoObjeto(r.objeto);
    if (!aceitaTipo(tipo, natureza)) return null;
    return { ...r, achadoEm, itensComTermo, tipo: natureza };
  });
  return conferidos.filter(Boolean);
}

export function ligarPncpAoVivo(app, { buscar = buscarNoPncp, itens = listarItens } = {}) {
  app.get('/api/pncp/busca', async (c) => {
    const q = (c.req.query('q') || '').trim();
    if (q.length < 3) return c.json({ erro: 'Digite pelo menos 3 letras para buscar no PNCP.' }, 400);
    if (q.length > 200) return c.json({ erro: 'Busca longa demais.' }, 400);
    const pagina = Math.min(50, Math.max(1, Number.parseInt(c.req.query('pagina') || '1', 10) || 1));
    const uf = (c.req.query('uf') || '').toUpperCase();
    const tipo = ['material', 'servico'].includes(c.req.query('tipo')) ? c.req.query('tipo') : null;
    const grupos = gruposDeTermos(q).slice(0, MAX_ALTERNATIVAS);
    if (!grupos.length) return c.json({ erro: 'Digite pelo menos uma palavra para buscar no PNCP.' }, 400);
    try {
      // Uma consulta ao PNCP por alternativa ("copo, papel A4" = 2 consultas), juntando sem repetir.
      const respostas = await Promise.all(grupos.map((g) => buscar({ q: g.join(' '), pagina, tamanho: 20, uf: UFS.includes(uf) ? uf : null })));
      const vistos = new Set();
      const juntos = [];
      for (const r of respostas.flatMap((x) => x.resultados)) {
        const chave = r.numeroControle || `${r.cnpj}/${r.ano}/${r.sequencial}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        juntos.push(r);
      }
      const resultados = await conferirResultados(juntos, { grupos, tipo, itens });
      return c.json({
        total: respostas.reduce((s, x) => s + (x.total || 0), 0),
        pagina,
        temMais: respostas.some((x) => x.resultados.length >= 20),
        recebidos: juntos.length,
        resultados,
      });
    } catch (e) {
      if (e instanceof ErroBuscaPncp) return c.json({ erro: e.message }, e.status);
      throw e;
    }
  });

  app.get('/api/pncp/compras/:cnpj/:ano/:sequencial/itens', async (c) => {
    const { cnpj, ano, sequencial } = c.req.param();
    if (!/^\d{14}$/.test(cnpj) || !/^\d{4}$/.test(ano) || !/^\d{1,9}$/.test(sequencial)) return c.json({ erro: 'Identificação da compra inválida.' }, 400);
    try {
      return c.json({ itens: normalizarItens(await itens({ cnpj, ano, sequencial }, { tentativas: 2 })) });
    } catch (e) {
      return c.json({ erro: [502, 503, 504].includes(e?.status) ? 'O PNCP está fora do ar e não entregou os itens. Tente de novo em alguns minutos.' : 'Não consegui ler os itens no PNCP.' }, 502);
    }
  });
}
