// Busca AO VIVO no PNCP (exige login, pelo middleware /api/* do app.js):
//   GET /api/pncp/busca?q=notebook&pagina=1&uf=SP     contratações com propostas abertas
//   GET /api/pncp/compras/:cnpj/:ano/:sequencial/itens   itens (quantidade e valor unitário estimado)
import { listarItens } from '../pncp/cliente.js';
import { normalizarItens } from '../pncp/detalhes.js';
import { buscarNoPncp, ErroBuscaPncp } from '../pncp/busca.js';
import { UFS } from '../pncp/dominio.js';

export function ligarPncpAoVivo(app, { buscar = buscarNoPncp, itens = listarItens } = {}) {
  app.get('/api/pncp/busca', async (c) => {
    const q = (c.req.query('q') || '').trim();
    if (q.length < 3) return c.json({ erro: 'Digite pelo menos 3 letras para buscar no PNCP.' }, 400);
    if (q.length > 200) return c.json({ erro: 'Busca longa demais.' }, 400);
    const pagina = Math.min(50, Math.max(1, Number.parseInt(c.req.query('pagina') || '1', 10) || 1));
    const uf = (c.req.query('uf') || '').toUpperCase();
    try {
      return c.json(await buscar({ q, pagina, tamanho: 20, uf: UFS.includes(uf) ? uf : null }));
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
