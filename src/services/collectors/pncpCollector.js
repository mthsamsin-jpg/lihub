// Coletor do PNCP (API pública de Consulta, gratuita e sem chave).
//
// Modos:
//   publicacao  -> contratações PUBLICADAS no período (desde/ate)
//   atualizacao -> contratações criadas OU alteradas no período (pega retificações) [padrão]
//   abertas     -> com propostas abertas que encerram até hoje + N dias
//
// Filtros: período, UFs, modalidades; paginação completa (até maxPaginas por
// modalidade/UF). Consulta nacional quando nenhuma UF é pedida; se a nacional falhar na
// 1ª página (o PNCP costuma dar 500 depois de ~50 s), divide por estado.
//
// O ritmo (1 consulta por vez, intervalo mínimo, pausa global em HTTP 429, novas
// tentativas com espera exponencial em 5xx) vem de src/pncp/cliente.js, compartilhado
// com a busca ao vivo e o coletor de mercado: o processo inteiro respeita o mesmo limite.
import { config as configGeral } from '../../config.js';
import { MODALIDADES, UFS } from '../../pncp/dominio.js';
import { obterJson, urlAtualizacoes, urlPropostasAbertas, urlPublicacoes } from '../../pncp/cliente.js';
import { normalizarContratacao } from '../../pncp/normalizar.js';
import { diaPncp, hojeBrasilia, somarDias } from '../../util.js';
import { BaseCollector } from './baseCollector.js';
import { registroPadrao } from './esquema.js';

const TAMANHO_PAGINA = 50; // máximo aceito pela API
const MAX_FALHAS_SEGUIDAS = 3;
const URL = { publicacao: urlPublicacoes, atualizacao: urlAtualizacoes, abertas: urlPropostasAbertas };

// Campos que a linha do PNCP tem além do esquema padrão (colunas próprias de licitacoes).
const PADRAO = new Set(['fonte', 'orgao_razao_social', 'orgao_cnpj', 'municipio', 'uf', 'objeto', 'modalidade_nome', 'modalidade_id',
  'valor_estimado', 'data_publicacao', 'data_abertura_proposta', 'data_encerramento_proposta', 'dados_brutos', 'sincronizado_em']);

export class PncpCollector extends BaseCollector {
  static fonte = 'pncp';
  static nome = 'PNCP';
  static validado = true;

  constructor(deps = {}) {
    super(deps);
    this.obterJson = deps.obterJson || obterJson; // injetável nos testes
  }

  normalizar(bruto) {
    const c = normalizarContratacao(bruto, { guardarBruto: false });
    if (!c) return null;
    const extras = Object.fromEntries(Object.entries(c).filter(([k]) => !PADRAO.has(k)));
    return registroPadrao({
      external_id: c.numero_controle_pncp, source: 'pncp',
      orgao: c.orgao_razao_social, orgao_cnpj: c.orgao_cnpj, municipio: c.municipio, uf: c.uf,
      objeto: c.objeto, modalidade: c.modalidade_nome, modalidade_id: c.modalidade_id,
      valor_estimado: c.valor_estimado, data_publicacao: c.data_publicacao, data_abertura: c.data_abertura_proposta,
      data_encerramento: c.data_encerramento_proposta, url_edital: c.link_sistema_origem,
      raw_data: bruto, extras,
    });
  }

  async *paginas(opcoes, { sinal } = {}) {
    const modo = opcoes.modo || 'atualizacao';
    const montar = URL[modo];
    if (!montar) throw new Error(`PNCP: modo inválido "${modo}". Use publicacao, atualizacao ou abertas.`);
    const modalidades = opcoes.modalidades?.length ? opcoes.modalidades : configGeral.pncp.modalidades;
    for (const m of modalidades) if (!MODALIDADES[m]) throw new Error(`PNCP: modalidade desconhecida ${m}.`);
    const maxPaginas = opcoes.maxPaginas ?? configGeral.pncp.maxPaginas;
    const janela = modo === 'abertas'
      ? { dataFinal: diaPncp(somarDias(hojeBrasilia(), opcoes.dias ?? configGeral.pncp.diasAFrente)) }
      : { dataInicial: diaPncp(opcoes.desde), dataFinal: diaPncp(opcoes.ate) };

    // Fila de tarefas (modalidade × UF). Sem UF: tenta a nacional (exceto "abertas",
    // em que a nacional quase sempre falha).
    const fila = [];
    for (const modalidade of modalidades) {
      if (opcoes.ufs?.length) for (const uf of opcoes.ufs) fila.push({ modalidade, uf, podeDividir: false });
      else if (modo === 'abertas') for (const uf of UFS) fila.push({ modalidade, uf, podeDividir: false });
      else fila.push({ modalidade, uf: null, podeDividir: true });
    }

    while (fila.length) {
      const t = fila.shift();
      const rotulo = `${MODALIDADES[t.modalidade]} / ${t.uf ?? 'Brasil'}`;
      const http = {
        sinal,
        tentativas: t.podeDividir ? 2 : configGeral.pncp.tentativas,
        aoFalhar: ({ tentativa, erro, esperaMs }) => this.log.aviso('pncp.tentar_de_novo', { rotulo, tentativa, erro: erro.message, esperaMs }),
      };
      let pagina = 1;
      let totalPaginas = 1;
      let falhasSeguidas = 0;
      while (pagina <= Math.min(totalPaginas, maxPaginas)) {
        let resp;
        try {
          resp = await this.obterJson(montar({ ...janela, modalidade: t.modalidade, uf: t.uf, pagina, tamanhoPagina: TAMANHO_PAGINA }), http);
        } catch (erro) {
          if (sinal?.aborted) throw erro;
          // 429 persistente: o PNCP pediu para parar; insistir só piora o bloqueio.
          if (erro?.status === 429) { erro.fatal = true; yield { rotulo, pagina, erro }; return; }
          if (pagina === 1 && t.podeDividir) {
            this.log.aviso('pncp.dividir_por_uf', { rotulo, erro: erro.message });
            for (const uf of UFS) fila.push({ modalidade: t.modalidade, uf, podeDividir: false });
            break;
          }
          yield { rotulo, pagina, erro };
          if (pagina === 1 || ++falhasSeguidas >= MAX_FALHAS_SEGUIDAS) break;
          pagina++;
          continue;
        }
        falhasSeguidas = 0;
        const brutos = Array.isArray(resp?.data) ? resp.data : [];
        totalPaginas = Number(resp?.totalPaginas ?? 0);
        if (pagina === 1) {
          this.log.info('pncp.tarefa', { rotulo, totalRegistros: resp?.totalRegistros ?? 0, totalPaginas, limite: maxPaginas });
        }
        if (!brutos.length) break;
        const registros = [];
        for (const b of brutos) { const r = this.normalizar(b); if (r) registros.push(r); }
        yield { rotulo, pagina, totalPaginas: Math.min(totalPaginas, maxPaginas), registros };
        pagina++;
      }
    }
  }
}
