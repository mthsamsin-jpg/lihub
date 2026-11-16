// Formato da análise de edital devolvida pelo Claude.
// O mesmo esquema é enviado à API (saída estruturada: o modelo é obrigado a
// segui-lo) e usado aqui para validar a resposta antes de gravar.
import * as z from 'zod/v4';

const referencia = () =>
  z.string().nullable()
    .describe('Onde está no edital (item/cláusula e página), ex.: "item 9.4.2, pág. 18". null se não houver.');

const Exigencia = z.object({
  descricao: z.string().describe('O que é exigido, em linguagem simples.'),
  obrigatorio: z.boolean().describe('true se o edital exige; false se é opcional ou só recomendado.'),
  observacao: z.string().nullable().describe('Detalhe útil: validade, quem emite, quantidade mínima etc.'),
  referencia: referencia(),
});

const Prazo = z.object({
  evento: z.string().describe('Ex.: sessão pública, limite para impugnação, pedido de esclarecimento, entrega de amostra.'),
  data_hora_texto: z.string().describe('Exatamente como aparece no edital.'),
  data_hora_iso: z.string().nullable()
    .describe('Data e hora em ISO 8601 com fuso de Brasília (-03:00), ex.: "2026-12-10T09:00:00-03:00". null se não der para converter.'),
  referencia: referencia(),
});

const Risco = z.object({
  titulo: z.string(),
  descricao: z.string(),
  severidade: z.enum(['alta', 'media', 'baixa']),
  categoria: z.enum(['desclassificacao', 'inabilitacao', 'prazo', 'penalidade', 'financeiro', 'operacional', 'juridico', 'outro']),
  recomendacao: z.string().describe('Ação prática para reduzir o risco.'),
  referencia: referencia(),
});

export const AnaliseEditalSchema = z.object({
  identificacao: z.object({
    objeto: z.string(),
    orgao: z.string().nullable(),
    numero_edital: z.string().nullable(),
    numero_processo: z.string().nullable(),
    modalidade: z.string().nullable(),
    criterio_julgamento: z.string().nullable().describe('Ex.: menor preço por item, maior desconto.'),
    modo_disputa: z.string().nullable().describe('Ex.: aberto, aberto e fechado.'),
    plataforma_disputa: z.string().nullable().describe('Portal onde ocorre a sessão, ex.: Compras.gov.br.'),
    valor_estimado: z.string().nullable().describe('Como aparece no edital, ou "sigiloso".'),
    registro_de_precos: z.boolean().nullable(),
    exclusivo_me_epp: z.boolean().nullable().describe('true se há participação exclusiva ou cota para ME/EPP.'),
    permite_consorcio: z.boolean().nullable(),
    vigencia_contrato: z.string().nullable(),
  }),
  resumo: z.string().describe('Resumo executivo em até 6 frases: o que é, quem pode participar, principais exigências e alertas.'),
  prazos: z.array(Prazo),
  habilitacao: z.object({
    juridica: z.array(Exigencia),
    fiscal_social_trabalhista: z.array(Exigencia),
    economico_financeira: z.array(Exigencia),
    tecnica: z.array(Exigencia),
    outras: z.array(Exigencia),
  }),
  documentos_obrigatorios: z.array(z.object({
    documento: z.string(),
    fase: z.enum(['proposta', 'habilitacao', 'contratacao', 'outra']),
    observacao: z.string().nullable(),
    referencia: referencia(),
  })).describe('Lista consolidada (checklist) de tudo que precisa ser entregue.'),
  proposta: z.object({
    requisitos: z.array(Exigencia).describe('Como a proposta deve ser apresentada: formato, planilhas, catálogos, marca/modelo.'),
    validade_minima_dias: z.number().nullable().describe('Validade mínima da proposta, em dias.'),
    exige_amostra_ou_prova_de_conceito: z.boolean().nullable(),
    garantia_proposta: z.string().nullable(),
  }),
  garantia_contratual: z.string().nullable(),
  penalidades: z.array(z.object({
    descricao: z.string(),
    referencia: referencia(),
  })),
  riscos: z.array(Risco).describe('O que pode levar à desclassificação, inabilitação, perda de prazo, multa ou prejuízo.'),
  pontos_para_esclarecimento: z.array(z.object({
    ponto: z.string(),
    motivo: z.string(),
    referencia: referencia(),
  })).describe('Trechos ambíguos ou possivelmente restritivos que merecem pedido de esclarecimento ou avaliação jurídica.'),
  informacoes_nao_encontradas: z.array(z.string()).describe('Informações importantes que não constam no documento analisado.'),
  confianca: z.enum(['alta', 'media', 'baixa'])
    .describe('Confiança geral na análise, considerando legibilidade e completude do documento.'),
});
