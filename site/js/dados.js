/* =============================================================================
   Uso LicitaHub · dados.js
   DADOS DE EXEMPLO para a demonstração do front-end, mais o armazenamento local
   (o que o usuário cadastra fica salvo no navegador).
   Na versão ligada ao sistema, estas listas vêm do Supabase e da API.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // --- Datas relativas a hoje (a demonstração sempre parece atual) -----------
  const dois = (n) => String(n).padStart(2, '0');
  const paraIso = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
  const hojeData = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const somar = (dias) => { const d = hojeData(); d.setDate(d.getDate() + dias); return paraIso(d); };

  LH.datas = {
    paraIso,
    hoje: () => paraIso(hojeData()),
    somar,
    /** 'AAAA-MM-DD' -> Date (meia-noite local) */
    paraData: (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); },
    /** Dias de hoje até a data (negativo = já passou) */
    diasAte: (iso) => Math.round((LH.datas.paraData(iso) - hojeData()) / 86400000),
  };

  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

  const MUNICIPIOS = {
    SP: ['São Paulo', 'Campinas', 'Ribeirão Preto', 'Santos', 'Sorocaba', 'São José dos Campos'],
    MG: ['Belo Horizonte', 'Uberlândia', 'Juiz de Fora', 'Contagem', 'Montes Claros'],
    RJ: ['Rio de Janeiro', 'Niterói', 'Duque de Caxias', 'Nova Iguaçu', 'Petrópolis'],
    PR: ['Curitiba', 'Londrina', 'Maringá', 'Cascavel', 'Ponta Grossa'],
    RS: ['Porto Alegre', 'Caxias do Sul', 'Pelotas', 'Canoas', 'Santa Maria'],
    SC: ['Florianópolis', 'Joinville', 'Blumenau', 'Chapecó', 'Itajaí'],
    BA: ['Salvador', 'Feira de Santana', 'Vitória da Conquista', 'Camaçari'],
    PE: ['Recife', 'Jaboatão dos Guararapes', 'Olinda', 'Caruaru', 'Petrolina'],
    CE: ['Fortaleza', 'Caucaia', 'Juazeiro do Norte', 'Sobral'],
    GO: ['Goiânia', 'Aparecida de Goiânia', 'Anápolis', 'Rio Verde'],
    DF: ['Brasília'],
    ES: ['Vitória', 'Vila Velha', 'Serra', 'Cariacica'],
    PA: ['Belém', 'Ananindeua', 'Santarém', 'Marabá'],
    AM: ['Manaus', 'Parintins'],
  };

  const MODALIDADES = ['Pregão Eletrônico', 'Dispensa de Licitação', 'Concorrência Eletrônica', 'Pregão Presencial', 'Credenciamento', 'Inexigibilidade'];

  // --- Licitações de exemplo ----------------------------------------------------
  // [objeto, órgão, UF, município, modalidade, valor estimado, dias até a abertura, hora, plataforma]
  const brutas = [
    ['Aquisição de papel A4 75 g/m² e materiais de expediente para as secretarias municipais', 'Prefeitura Municipal de Campinas', 'SP', 'Campinas', 'Pregão Eletrônico', 184500, 3, '09:00', 'Compras.gov.br'],
    ['Contratação de serviços contínuos de limpeza, conservação e higienização predial', 'Tribunal Regional do Trabalho', 'MG', 'Belo Horizonte', 'Pregão Eletrônico', 2350000, 6, '10:00', 'Compras.gov.br'],
    ['Registro de preços para aquisição de notebooks e monitores para laboratórios de ensino', 'Universidade Federal (campus Curitiba)', 'PR', 'Curitiba', 'Pregão Eletrônico', 978300, 9, '09:30', 'Compras.gov.br'],
    ['Manutenção preventiva e corretiva de aparelhos de ar-condicionado com fornecimento de peças', 'Secretaria de Estado da Saúde', 'BA', 'Salvador', 'Pregão Eletrônico', 642000, 1, '14:00', 'Compras.gov.br'],
    ['Aquisição de medicamentos da farmácia básica', 'Fundo Municipal de Saúde de Feira de Santana', 'BA', 'Feira de Santana', 'Pregão Eletrônico', 1520000, 12, '08:30', 'Portal de Compras Públicas'],
    ['Serviços de manutenção da rede elétrica e iluminação pública', 'Prefeitura Municipal de Sorocaba', 'SP', 'Sorocaba', 'Concorrência Eletrônica', 4890000, 18, '10:00', 'Licitanet'],
    ['Aquisição de gêneros alimentícios para a merenda escolar (agricultura familiar excluída)', 'Prefeitura Municipal de Londrina', 'PR', 'Londrina', 'Pregão Eletrônico', 735400, 5, '09:00', 'BLL Compras'],
    ['Locação de veículos com motorista para atender a Secretaria de Obras', 'Prefeitura Municipal de Niterói', 'RJ', 'Niterói', 'Pregão Eletrônico', 1210000, 7, '10:30', 'Compras.gov.br'],
    ['Aquisição de cadeiras e mesas de escritório ergonômicas', 'Câmara Municipal de Florianópolis', 'SC', 'Florianópolis', 'Dispensa de Licitação', 58900, 2, '11:00', 'Compras.gov.br'],
    ['Serviço de vigilância patrimonial armada, postos 12x36', 'Instituto Federal (reitoria)', 'GO', 'Goiânia', 'Pregão Eletrônico', 3100000, 15, '09:00', 'Compras.gov.br'],
    ['Fornecimento de água mineral em galões de 20 litros', 'Prefeitura Municipal de Recife', 'PE', 'Recife', 'Dispensa de Licitação', 42800, 1, '15:00', 'Compras.gov.br'],
    ['Desenvolvimento e sustentação de sistemas web, com métricas de ponto de função', 'Companhia Estadual de Tecnologia', 'RS', 'Porto Alegre', 'Concorrência Eletrônica', 6800000, 25, '10:00', 'Compras.gov.br'],
    ['Aquisição de luvas de procedimento, máscaras e aventais descartáveis', 'Hospital Regional', 'CE', 'Fortaleza', 'Pregão Eletrônico', 389000, 4, '09:00', 'BNC Compras'],
    ['Contratação de empresa para coleta e destinação de resíduos de serviços de saúde', 'Consórcio Intermunicipal de Saúde', 'MG', 'Uberlândia', 'Pregão Eletrônico', 960000, 11, '14:30', 'Portal de Compras Públicas'],
    ['Aquisição de pneus, câmaras e protetores para a frota municipal', 'Prefeitura Municipal de Caxias do Sul', 'RS', 'Caxias do Sul', 'Pregão Eletrônico', 412700, 8, '09:00', 'Licitanet'],
    ['Reforma e ampliação de unidade básica de saúde', 'Prefeitura Municipal de Anápolis', 'GO', 'Anápolis', 'Concorrência Eletrônica', 2780000, 21, '09:00', 'Compras.gov.br'],
    ['Aquisição de toners e cartuchos para impressoras', 'Defensoria Pública do Estado', 'ES', 'Vitória', 'Pregão Eletrônico', 96500, 3, '10:00', 'Compras.gov.br'],
    ['Credenciamento de clínicas para exames de imagem', 'Secretaria Municipal de Saúde de Belém', 'PA', 'Belém', 'Credenciamento', 1800000, 30, '08:00', 'Portal de Compras Públicas'],
    ['Serviços de buffet e coffee break para eventos institucionais', 'Assembleia Legislativa', 'DF', 'Brasília', 'Pregão Eletrônico', 215000, 10, '10:00', 'Compras.gov.br'],
    ['Aquisição de café torrado e moído, açúcar e adoçante', 'Prefeitura Municipal de Joinville', 'SC', 'Joinville', 'Dispensa de Licitação', 31600, 2, '09:30', 'Compras.gov.br'],
    ['Licença de software de gestão escolar com implantação e treinamento', 'Secretaria de Estado da Educação', 'AM', 'Manaus', 'Inexigibilidade', 540000, 14, '11:00', 'Compras.gov.br'],
    ['Fornecimento de uniformes escolares (camisetas, bermudas e agasalhos)', 'Prefeitura Municipal de Juiz de Fora', 'MG', 'Juiz de Fora', 'Pregão Eletrônico', 1340000, 13, '09:00', 'BLL Compras'],
    ['Aquisição de álcool 70% líquido e em gel, sabonete e papel toalha', 'Tribunal de Justiça do Estado', 'PE', 'Recife', 'Pregão Eletrônico', 158200, 6, '14:00', 'Compras.gov.br'],
    ['Pavimentação asfáltica de vias urbanas com drenagem superficial', 'Prefeitura Municipal de Maringá', 'PR', 'Maringá', 'Concorrência Eletrônica', 9450000, 28, '09:00', 'Compras.gov.br'],
  ];

  const licitacoes = brutas.map((b, i) => ({
    id: 1001 + i,
    numero: `${b[4] === 'Pregão Eletrônico' ? 'PE' : b[4] === 'Dispensa de Licitação' ? 'DE' : b[4] === 'Concorrência Eletrônica' ? 'CE' : 'LIC'} ${String(90010 + i * 7).padStart(5, '0')}/2026`,
    objeto: b[0], orgao: b[1], uf: b[2], municipio: b[3], modalidade: b[4],
    valor: b[5], abertura: somar(b[6]), hora: b[7], plataforma: b[8],
    edital: `${String(i * 3 + 11).padStart(3, '0')}/2026`, uasg: b[8] === 'Compras.gov.br' ? String(925000 + i * 137) : null,
    publicada: somar(-((i * 5) % 9) - 1),
    fonte: 'PNCP',
    me_epp: b[5] <= 80000,
  }));

  // --- CRM: etapas iguais às do banco (supabase/schema.sql) ---------------------
  const etapas = [
    { id: 1, nome: 'Triagem', cor: '#64748b' },
    { id: 2, nome: 'Análise do edital', cor: '#3b82f6' },
    { id: 3, nome: 'Proposta em preparo', cor: '#8b5cf6' },
    { id: 4, nome: 'Em disputa', cor: '#f59e0b' },
    { id: 5, nome: 'Habilitação / recursos', cor: '#06b6d4' },
    { id: 6, nome: 'Ganha', cor: '#22c55e' },
    { id: 7, nome: 'Perdida / desistência', cor: '#ef4444' },
  ];
  const crmPadrao = [
    [1001, 2], [1002, 1], [1003, 2], [1004, 4], [1007, 3], [1009, 5], [1011, 4], [1013, 3],
    [1017, 1], [1020, 6], [1023, 2], [1015, 7],
  ].map(([licitacaoId, etapa], i) => ({ id: `c${i + 1}`, licitacaoId, etapa, nota: '' }));

  // --- Documentos da empresa (validades relativas a hoje) ----------------------------
  const documentosPadrao = [
    ['CND Federal (Receita Federal / PGFN)', 'Fiscal', -150, 45],
    ['CND FGTS (Certificado de Regularidade do FGTS)', 'Fiscal', -27, -3],
    ['CNDT - Certidão Negativa de Débitos Trabalhistas', 'Trabalhista', -60, 120],
    ['Certidão Negativa Correcional (CGU)', 'Integridade', -80, 9],
    ['Certidão de Regularidade Estadual (SEFAZ)', 'Fiscal', -100, -12],
    ['Certidão Negativa de Débitos Municipais', 'Fiscal', -77, 13],
    ['Certidão de Falência e Recuperação Judicial', 'Econômico-financeira', -63, 27],
    ['Balanço Patrimonial e Demonstrações Contábeis', 'Econômico-financeira', -230, 160],
    ['Atestado de Capacidade Técnica', 'Técnica', -400, null],
    ['Contrato Social Consolidado', 'Jurídica', -900, null],
  ].map(([nome, tipo, emissao, validade], i) => ({
    id: `d${i + 1}`, nome, tipo, emissao: somar(emissao), validade: validade === null ? null : somar(validade), arquivo: '',
  }));

  // --- Agenda (sessões e prazos) -----------------------------------------------------
  const eventosPadrao = [
    { id: 'e1', data: somar(0), hora: '09:00', titulo: 'Sessão pública: água mineral 20 L', detalhe: 'Prefeitura Municipal de Recife', tipo: 'sessao' },
    { id: 'e2', data: somar(0), hora: '16:00', titulo: 'Enviar proposta ajustada: cadeiras ergonômicas', detalhe: 'Câmara Municipal de Florianópolis', tipo: 'prazo' },
    { id: 'e3', data: somar(1), hora: '14:00', titulo: 'Sessão pública: manutenção de ar-condicionado', detalhe: 'Secretaria de Estado da Saúde (BA)', tipo: 'sessao' },
    { id: 'e4', data: somar(2), hora: '18:00', titulo: 'Prazo para pedido de esclarecimento', detalhe: 'Locação de veículos com motorista', tipo: 'prazo' },
    { id: 'e5', data: somar(3), hora: '09:00', titulo: 'Abertura: papel A4 e expediente', detalhe: 'Prefeitura Municipal de Campinas', tipo: 'abertura' },
    { id: 'e6', data: somar(6), hora: '10:00', titulo: 'Abertura: limpeza e conservação predial', detalhe: 'Tribunal Regional do Trabalho (MG)', tipo: 'abertura' },
    { id: 'e7', data: somar(9), hora: '09:30', titulo: 'Abertura: notebooks e monitores', detalhe: 'Universidade Federal (PR)', tipo: 'abertura' },
    { id: 'e8', data: somar(-2), hora: '10:00', titulo: 'Recurso protocolado: uniformes escolares', detalhe: 'Prefeitura Municipal de Juiz de Fora', tipo: 'prazo' },
    { id: 'e9', data: somar(12), hora: '08:30', titulo: 'Abertura: medicamentos da farmácia básica', detalhe: 'Feira de Santana (BA)', tipo: 'abertura' },
  ];

  // --- Petronect (Beta): oportunidades de exemplo --------------------------------------
  const petronect = [
    ['7004581234', 'Fornecimento de válvulas esfera classe 600 em aço inox', 'Materiais - Válvulas', 6, 'Aberta'],
    ['7004581877', 'Serviço de manutenção de bombas centrífugas em unidade de processamento', 'Serviços - Manutenção', 3, 'Aberta'],
    ['7004582010', 'Aquisição de EPIs: luvas nitrílicas e óculos de proteção', 'Materiais - Segurança', 1, 'Encerrando'],
    ['7004582455', 'Locação de guindaste veicular com operador', 'Serviços - Logística', 10, 'Aberta'],
    ['7004582903', 'Fornecimento de cabos elétricos de média tensão', 'Materiais - Elétrica', 14, 'Aberta'],
    ['7004583118', 'Serviços de pintura industrial anticorrosiva', 'Serviços - Manutenção', 8, 'Aberta'],
  ].map(([numero, descricao, categoria, dias, status]) => ({ numero, descricao, categoria, limite: somar(dias), status }));

  // --- Monitoramento de chat: sessões e mensagens de exemplo ----------------------
  const sessoesChat = [
    { id: 's1', licitacaoId: 1011, status: 'Em disputa', mensagens: [
      ['09:01', 'Pregoeiro', 'Bom dia a todos. Declaro aberta a sessão pública da Dispensa Eletrônica.'],
      ['09:14', 'Pregoeiro', 'Iniciada a fase de lances. Prazo aleatório de até 10 minutos após o tempo regular.'],
      ['09:32', 'Sistema', 'Fase de lances encerrada para o item 1.'],
      ['09:40', 'Pregoeiro', 'Sr. fornecedor MINHA EMPRESA LTDA, favor enviar a proposta ajustada no prazo de 2 horas, pelo campo de anexos.'],
    ] },
    { id: 's2', licitacaoId: 1004, status: 'Suspensa', mensagens: [
      ['14:02', 'Pregoeiro', 'Sessão aberta. Passaremos à análise das propostas.'],
      ['14:35', 'Pregoeiro', 'A sessão será suspensa para análise técnica dos documentos. Retorno previsto para amanhã às 14h.'],
    ] },
    { id: 's3', licitacaoId: 1007, status: 'Aguardando', mensagens: [
      ['08:55', 'Sistema', 'A sessão pública está agendada e ainda não foi iniciada.'],
    ] },
  ];
  const mensagensSimuladas = [
    ['Pregoeiro', 'Solicito aos licitantes que permaneçam conectados.'],
    ['Pregoeiro', 'Convocamos a empresa MINHA EMPRESA LTDA para envio de anexo complementar em 1 hora.'],
    ['Sistema', 'O item 2 foi aceito e encaminhado para a habilitação.'],
    ['Pregoeiro', 'Informo que o prazo para intenção de recurso é de 10 minutos.'],
    ['Pregoeiro', 'Retomada a sessão. Seguiremos com a verificação dos documentos de habilitação.'],
  ];

  // --- Pesquisa de preço: itens do catálogo (preço de referência por unidade) -------
  const catalogo = [
    { nome: 'Papel A4 75 g/m², resma com 500 folhas', tipo: 'produto', unidade: 'resma', base: 27.9 },
    { nome: 'Toner compatível para impressora laser (preto)', tipo: 'produto', unidade: 'unidade', base: 89.5 },
    { nome: 'Notebook 15,6" Core i5 / 16 GB / SSD 512 GB', tipo: 'produto', unidade: 'unidade', base: 4380 },
    { nome: 'Cadeira giratória ergonômica com braços', tipo: 'produto', unidade: 'unidade', base: 690 },
    { nome: 'Ar-condicionado split inverter 12.000 BTUs', tipo: 'produto', unidade: 'unidade', base: 2490 },
    { nome: 'Álcool 70% líquido, frasco de 1 litro', tipo: 'produto', unidade: 'frasco', base: 8.7 },
    { nome: 'Luva de procedimento nitrílica, caixa com 100', tipo: 'produto', unidade: 'caixa', base: 32.4 },
    { nome: 'Café torrado e moído, pacote de 500 g', tipo: 'produto', unidade: 'pacote', base: 19.8 },
    { nome: 'Água mineral, galão de 20 litros', tipo: 'produto', unidade: 'galão', base: 11.5 },
    { nome: 'Pneu 175/70 R14', tipo: 'produto', unidade: 'unidade', base: 385 },
    { nome: 'Limpeza e conservação predial', tipo: 'servico', unidade: 'm²/mês', base: 7.4 },
    { nome: 'Vigilância armada, posto 12x36 diurno', tipo: 'servico', unidade: 'posto/mês', base: 9800 },
    { nome: 'Manutenção preventiva de ar-condicionado', tipo: 'servico', unidade: 'equipamento/mês', base: 95 },
    { nome: 'Locação de veículo com motorista', tipo: 'servico', unidade: 'diária', base: 640 },
    { nome: 'Coleta de resíduos de serviços de saúde', tipo: 'servico', unidade: 'kg', base: 6.9 },
    { nome: 'Coffee break para eventos', tipo: 'servico', unidade: 'pessoa', base: 28 },
  ];

  // --- Padrões do que o usuário pode editar (ficam salvos no navegador) -------------
  const padroes = {
    favoritos: [1001, 1004, 1009, 1011, 1017],
    robo: [
      { id: 'r1', descricao: 'Item 1 · Notebook 15,6" i5, 16 GB, SSD 512 GB', itemNumero: 1, plataforma: 'comprasnet', teto: 4890, custo: 3720, piso: 4150, decremento: 0.01, intervaloSeg: 20, status: 'idle', nossoLance: null, melhorLance: null },
      { id: 'r2', descricao: 'Item 3 · Monitor 24" Full HD', itemNumero: 3, plataforma: 'bll', teto: 1180, custo: 860, piso: 990, decremento: 0.05, intervaloSeg: 20, status: 'idle', nossoLance: null, melhorLance: null },
    ],
    crm: crmPadrao,
    documentos: documentosPadrao,
    eventos: [],
    propostas: [
      { id: 'p1', numero: 'PROP-2026-014', licitacaoId: 1009, criada: somar(-4), status: 'Enviada', total: 54210, itens: [] },
      { id: 'p2', numero: 'PROP-2026-015', licitacaoId: 1001, criada: somar(-1), status: 'Rascunho', total: 0, itens: [] },
    ],
    radares: [
      { id: 'r1', nome: 'Material de escritório (SP e PR)', palavras: ['papel', 'toner', 'expediente'], ufs: ['SP', 'PR'], modalidades: ['Pregão Eletrônico', 'Dispensa de Licitação'], canais: { email: true, telegram: false, computador: true }, ativo: true },
      { id: 'r2', nome: 'Limpeza e conservação', palavras: ['limpeza', 'conservação', 'higienização'], ufs: [], modalidades: ['Pregão Eletrônico'], canais: { email: true, telegram: true, computador: false }, ativo: true },
    ],
    empresa: {
      razao: 'MINHA EMPRESA LTDA', fantasia: 'Minha Empresa', cnpj: '', ie: '', im: '',
      regime: 'Simples Nacional', porte: 'ME', endereco: '', cidade: '', uf: 'SP', cep: '',
      email: '', telefone: '', representante: '', cpfRepresentante: '', cargo: 'Sócio-administrador',
      banco: '', agencia: '', conta: '',
    },
    empresas: [
      { id: 'm1', razao: 'MINHA EMPRESA LTDA', cnpj: '', porte: 'ME', uf: 'SP', cidade: 'Campinas' },
    ],
    perfil: { nome: 'Usuário de demonstração', email: 'voce@suaempresa.com.br', telefone: '', marketing: false },
    comprasnet: { cnpj: '', nome: '', pregoes: [], palavras: ['MINHA EMPRESA', 'convoca', 'anexo', 'prazo'] },
    alertasChat: { computador: false, telegram: false },
  };

  LH.dados = {
    UFS, MUNICIPIOS, MODALIDADES, licitacoes, etapas, eventosPadrao, petronect,
    sessoesChat, mensagensSimuladas, catalogo,
    totais: { plataforma: 1164739, novas24h: 699 },
    licitacao: (id) => licitacoes.find((l) => l.id === Number(id)),
  };

  // --- Armazenamento local (navegador) ------------------------------------------------
  // Pode falhar (aba anônima, bloqueio de cookies): aí fica só na memória.
  const memoria = {};
  const PREFIXO = 'licitahub:';
  const copiar = (v) => JSON.parse(JSON.stringify(v));

  LH.estado = {
    obter(nome) {
      if (nome in memoria) return copiar(memoria[nome]);
      try {
        const salvo = localStorage.getItem(PREFIXO + nome);
        if (salvo !== null) return JSON.parse(salvo);
      } catch { /* sem armazenamento: usa o padrão */ }
      return copiar(padroes[nome] ?? null);
    },
    salvar(nome, valor) {
      memoria[nome] = copiar(valor);
      try { localStorage.setItem(PREFIXO + nome, JSON.stringify(valor)); } catch { /* fica só na memória */ }
    },
    /** Liga/desliga favorito. Devolve true se ficou favoritada. */
    alternarFavorito(id) {
      const lista = new Set(LH.estado.obter('favoritos'));
      const ficou = !lista.has(id);
      if (ficou) lista.add(id); else lista.delete(id);
      LH.estado.salvar('favoritos', [...lista]);
      return ficou;
    },
    ehFavorita: (id) => LH.estado.obter('favoritos').includes(id),
    /** Volta tudo ao exemplo inicial. */
    limparTudo() {
      Object.keys(memoria).forEach((k) => delete memoria[k]);
      try { Object.keys(padroes).forEach((k) => localStorage.removeItem(PREFIXO + k)); } catch { /* nada */ }
    },
  };
})();
