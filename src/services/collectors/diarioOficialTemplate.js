// MODELO para coletores de Diários Oficiais municipais e portais próprios de
// prefeituras que não publicam no PNCP. NÃO está registrado em index.js: copie
// este arquivo, ajuste e registre.
//
// Boas práticas para fontes novas:
//   - prefira API ou dados abertos (JSON/CSV/RSS) a raspar HTML;
//   - respeite robots.txt e os termos de uso do site; nunca burle captcha ou login;
//   - use criarRequisitador() com intervalo generoso (>= 2 s): sites de prefeitura são frágeis;
//   - external_id precisa ser ESTÁVEL (o mesmo edital sempre gera o mesmo id), senão
//     a retificação vira duplicata. Use o número do edital/processo + órgão, nunca a posição na página.
//
// Exemplo de fonte com API aberta: Querido Diário (Open Knowledge Brasil), que indexa
// diários oficiais de centenas de municípios: https://queridodiario.ok.org.br/api/docs
import { BaseCollector } from './baseCollector.js';
import { registroPadrao } from './esquema.js';
import { criarRequisitador } from './http.js';

export class DiarioOficialTemplate extends BaseCollector {
  static fonte = 'diario_exemplo'; // ex.: 'do_sp_campinas' ou 'querido_diario'
  static nome = 'Diário Oficial (modelo)';
  static validado = false;

  constructor(deps = {}) {
    super(deps);
    this.requisitar = deps.requisitar || criarRequisitador({ intervaloMs: 2_000, timeoutMs: 45_000, tentativas: 4, log: this.log });
    this.urlBase = deps.config?.urlBase || 'https://exemplo.gov.br/api/licitacoes';
  }

  /** Bruto da fonte -> RegistroPadrao. Ajuste os nomes dos campos à fonte real. */
  normalizar(b) {
    if (!b?.id) return null;
    return registroPadrao({
      source: this.fonte,
      external_id: String(b.id),
      orgao: b.orgao, orgao_cnpj: b.cnpj, municipio: b.municipio, uf: b.uf,
      objeto: b.objeto, modalidade: b.modalidade, valor_estimado: b.valor,
      data_publicacao: b.publicado_em, data_abertura: b.abertura_em,
      url_edital: b.link,
      raw_data: b, // só é gravado com SCRAPER_GUARDAR_BRUTO=1 (e se for pequeno)
    });
  }

  async *paginas({ desde, ate, ufs, maxPaginas = 50 }, { sinal } = {}) {
    const rotulo = `${this.nome} ${ufs?.join(',') || ''}`.trim();
    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      let resp;
      try {
        const url = new URL(this.urlBase);
        url.searchParams.set('desde', desde);
        url.searchParams.set('ate', ate);
        url.searchParams.set('pagina', String(pagina));
        resp = await this.requisitar(url.toString(), { sinal });
      } catch (erro) {
        if (sinal?.aborted) throw erro;
        yield { rotulo, pagina, erro };
        return;
      }
      const itens = Array.isArray(resp?.itens) ? resp.itens : [];
      if (!itens.length) return;
      const registros = itens.map((b) => this.normalizar(b)).filter(Boolean)
        .filter((r) => !ufs?.length || !r.uf || ufs.includes(r.uf));
      yield { rotulo, pagina, registros };
      if (!resp?.temMais) return;
    }
  }
}
