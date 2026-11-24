/* =============================================================================
   Uso LicitaHub · Regras da proposta (sem tela)
   Declarações, snapshot da empresa, duplicação e valores em centavos.
   Testes: testes/propostas-regras.test.js
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // Declarações legais: uma redação só para a proposta e para o Gerador de declarações.
  // Artigos conferidos no texto do Planalto em 24/11/2026.
  const LEGAIS = [
    { id: 'habilitacao', titulo: 'Cumprimento dos requisitos de habilitação', ref: 'Art. 63, I, da Lei nº 14.133/2021',
      corpo: 'atende aos requisitos de habilitação previstos no edital e responde pela veracidade das informações prestadas, na forma da lei, nos termos do art. 63, inciso I, da Lei nº 14.133/2021.' },
    { id: 'impeditivo', titulo: 'Inexistência de fato impeditivo', ref: 'Art. 14 da Lei nº 14.133/2021', penas: true,
      corpo: 'até a presente data inexistem fatos impeditivos à sua participação nesta licitação, que não incorre nas vedações do art. 14 da Lei nº 14.133/2021 e que se compromete a informar a ocorrência de qualquer fato superveniente.' },
    { id: 'menor', titulo: 'Não emprego de menor', ref: 'Art. 68, VI, da Lei nº 14.133/2021',
      corpo: 'cumpre o disposto no art. 7º, inciso XXXIII, da Constituição Federal, nos termos do art. 68, inciso VI, da Lei nº 14.133/2021: não emprega menor de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre, nem menor de 16 (dezesseis) anos em qualquer trabalho, salvo na condição de aprendiz, a partir de 14 (quatorze) anos.' },
    { id: 'reserva', titulo: 'Reserva de cargos para pessoa com deficiência e reabilitado', ref: 'Art. 63, IV, da Lei nº 14.133/2021',
      corpo: 'cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas, nos termos do art. 63, inciso IV, da Lei nº 14.133/2021.' },
    { id: 'trabalhistas', titulo: 'Proposta compreende todos os custos trabalhistas', ref: 'Art. 63, § 1º, da Lei nº 14.133/2021',
      corpo: 'sua proposta econômica compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na data de entrega das propostas, nos termos do art. 63, § 1º, da Lei nº 14.133/2021.' },
    { id: 'meepp', titulo: 'Enquadramento como ME/EPP', ref: 'LC nº 123/2006 e art. 4º, § 2º, da Lei nº 14.133/2021', manual: true, penas: true,
      corpo: 'se enquadra como {porte}, nos termos do art. 3º da Lei Complementar nº 123/2006, que não incorre nas vedações do § 4º desse artigo, que está apta a usufruir do tratamento favorecido dos arts. 42 a 49 da mesma Lei Complementar, conforme o art. 4º da Lei nº 14.133/2021, e que, no ano-calendário de realização da licitação, ainda não celebrou contratos com a Administração Pública cujos valores somados extrapolem a receita bruta máxima admitida para fins de enquadramento como empresa de pequeno porte (art. 4º, § 2º, da Lei nº 14.133/2021).' },
  ];

  const PORTES = { ME: 'microempresa', EPP: 'empresa de pequeno porte' };
  /** Texto legal em terceira pessoa, a partir do verbo ("declara"). */
  const textoLegal = (d, verbo, porte) =>
    `${verbo}${d.penas ? ', sob as penas da lei,' : ''} que ${d.corpo.replace('{porte}', PORTES[porte] || 'microempresa ou empresa de pequeno porte')}`;

  // {validade} e {pagamento} são trocados pelos campos da proposta na hora de gerar.
  const DECLARACOES = [
    ['ciencia', 'Ciência do instrumento convocatório',
      'Declaramos que temos pleno conhecimento de todas as condições do edital (instrumento convocatório) e de seus anexos, com as quais concordamos integralmente, e que recebemos todas as informações necessárias à elaboração desta proposta.'],
    ['exigencias', 'Cumprimento das exigências do edital',
      'Declaramos que cumprimos plenamente as exigências do edital e que o objeto ofertado atende a todas as especificações do termo de referência, responsabilizando-nos pela veracidade das informações prestadas.'],
    ['custos', 'Impostos, taxas, frete e custos indiretos inclusos',
      'Declaramos que nos preços propostos estão incluídos todos os impostos, taxas, tributos, fretes, seguros, encargos sociais e trabalhistas e demais custos diretos e indiretos necessários ao cumprimento integral do objeto, nada mais podendo ser cobrado além do valor proposto.'],
    ['validade', 'Validade da proposta',
      'Declaramos que esta proposta é válida por {validade} dias, contados da data de abertura da sessão pública.'],
    ['pagamento', 'Forma de pagamento conforme o edital',
      'Declaramos que aceitamos a forma e as condições de pagamento previstas no edital{pagamento}.'],
    ...LEGAIS.map((d) => [d.id, d.titulo, textoLegal(d, 'A proponente declara'), !d.manual]),
  ];
  /** Declarações de uma proposta nova. ME/EPP (sob as penas da lei) é sempre marcada à mão. */
  const declaracoesPadrao = () => DECLARACOES.map(([id, titulo, texto, ativo = true]) => ({ id, titulo, texto, ativo }));
  /** Declarações da proposta. Numa já salva, o que ela não tinha entra desmarcado. */
  const declaracoesDe = (p) => {
    const salvas = p.extras?.declaracoes;
    if (Array.isArray(salvas)) {
      return declaracoesPadrao().map((d) => ({ ...d, ativo: false, ...(salvas.find((s) => s.id === d.id) || {}) }));
    }
    // Antes das declarações editáveis, o documento só tinha a de custos inclusos.
    return declaracoesPadrao().map((d) => (p.id ? { ...d, ativo: d.id === 'custos' } : d));
  };

  // --- Empresa: cópia dos dados no momento de salvar ---------------------------------
  const CAMPOS_EMPRESA = ['id', 'razao', 'fantasia', 'cnpj', 'porte', 'regime', 'ie', 'im', 'uf', 'cidade', 'endereco', 'cep', 'email', 'telefone',
    'representante', 'cpfRepresentante', 'rgRepresentante', 'cargo', 'banco', 'agencia', 'conta', 'logo'];
  const snapshotEmpresa = (e) => Object.fromEntries(CAMPOS_EMPRESA.map((k) => [k, e?.[k] ?? '']));
  const VAZIA = Object.freeze(snapshotEmpresa({}));
  /** Empresa da proposta: snapshot > cadastro escolhido > vazia. Nunca outra empresa. */
  function empresaDe(p, empresas = []) {
    const foto = p.extras?.empresa;
    if (foto?.razao && (!p.empresaId || String(foto.id) === String(p.empresaId))) return { ...VAZIA, ...foto };
    return (p.empresaId && empresas.find((e) => String(e.id) === String(p.empresaId))) || { ...VAZIA };
  }

  /** Cópia da proposta: sem id, assinatura de hoje, empresa atualizada e ME/EPP desmarcada. */
  function duplicar(p, { numero, hoje, empresas = [] }) {
    const extras = JSON.parse(JSON.stringify(p.extras || {}));
    extras.fechamento = { ...(extras.fechamento || {}), data: hoje };
    extras.declaracoes = declaracoesDe(p).map((d) => (d.id === 'meepp' ? { ...d, ativo: false } : d));
    const id = p.empresaId || extras.empresa?.id;
    const atual = id && empresas.find((e) => String(e.id) === String(id));
    if (atual) extras.empresa = snapshotEmpresa(atual);
    return { ...p, id: undefined, criada: undefined, numero, status: 'Rascunho', extras };
  }

  // --- Valores: cada linha é arredondada em centavos e o total soma as linhas ----------
  const centavosLinha = (it) => Math.round(Number(((Number(it.quantidade) || 0) * (Number(it.unitario) || 0) * 100).toPrecision(15)));
  const totalLinha = (it) => centavosLinha(it) / 100;
  const totalProposta = (itens = []) => itens.reduce((s, it) => s + centavosLinha(it), 0) / 100;

  /** Próximo número da sequência (demonstração). No modo real, quem numera é o banco. */
  function proximoNumero(numeros, ano, ultimo = 0) {
    const re = new RegExp(`^PROP-${ano}-(\\d{1,9})$`);
    const maior = numeros.reduce((m, n) => Math.max(m, Number(re.exec(n)?.[1] || 0)), Number(ultimo) || 0);
    return { ultimo: maior + 1, numero: `PROP-${ano}-${String(maior + 1).padStart(3, '0')}` };
  }

  // --- Conferência antes de salvar ou baixar -------------------------------------------
  function cpfValido(cpf) {
    const d = String(cpf || '').replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    return [9, 10].every((n) => {
      const soma = [...d.slice(0, n)].reduce((s, x, i) => s + Number(x) * (n + 1 - i), 0);
      return ((soma * 10) % 11) % 10 === Number(d[n]);
    });
  }
  /** O que falta ou está incoerente: [{ campo, onde: 'empresa' | 'proposta' | 'itens' }]. */
  function pendencias(p, { empresa: e, banco, fim }) {
    const tem = (v) => !!String(v ?? '').trim();
    const l = p.licitacao || {};
    const naProposta = p.extras?.banco?.origem === 'proposta';
    const envio = tem(l.limite) && `${l.limite}T${l.horaLimite || '00:00'}`;
    const sessao = tem(l.abertura) && `${l.abertura}T${l.hora || '23:59'}`;
    const itens = p.itens || [];
    const nums = (f) => itens.map((it, i) => (f(it) ? it.numero || i + 1 : null)).filter((x) => x !== null);
    const deItens = (f, texto) => { const n = nums(f); return n.length > 0 && { campo: `${texto}: ${n.length === 1 ? 'item' : 'itens'} ${n.slice(0, 10).join(', ')}${n.length > 10 ? '…' : ''}`, onde: 'itens' }; };
    const numeros = itens.map((it) => String(it.numero ?? ''));
    return [
      !tem(l.orgao) && { campo: 'Órgão licitante', onde: 'proposta' },
      !tem(l.numero) && { campo: 'Nº da compra / edital', onde: 'proposta' },
      !tem(l.objeto) && { campo: 'Objeto', onde: 'proposta' },
      envio && sessao && envio > sessao && { campo: 'Envio das propostas depois da abertura da sessão', onde: 'proposta' },
      !tem(e.id) && { campo: 'Empresa proponente selecionada', onde: 'empresa' },
      !tem(e.razao) && { campo: 'Razão social', onde: 'empresa' },
      !tem(e.cnpj) && { campo: 'CNPJ', onde: 'empresa' },
      !tem(e.endereco) && { campo: 'Endereço', onde: 'empresa' },
      !tem(fim.cidade) && { campo: 'Cidade da assinatura', onde: 'proposta' },
      !tem(fim.representante) && { campo: 'Representante legal', onde: 'proposta' },
      !tem(fim.cpf) ? { campo: 'CPF do representante', onde: 'proposta' }
        : !cpfValido(fim.cpf) && { campo: 'CPF do representante inválido', onde: 'proposta' },
      !(tem(banco.banco) && tem(banco.agencia) && tem(banco.conta)) && { campo: 'Dados bancários (banco, agência e conta)', onde: naProposta ? 'proposta' : 'empresa' },
      deItens((it) => !tem(it.descricao), 'Sem descrição'),
      deItens((it) => !(it.quantidade > 0), 'Sem quantidade'),
      deItens((it) => !(it.unitario > 0), 'Sem valor unitário'),
      numeros.some((n, i) => numeros.indexOf(n) !== i) && { campo: 'Número de item repetido', onde: 'itens' },
    ].filter(Boolean);
  }
  /** Validade em dias: inteiro de 1 a 365 (limite do banco). */
  const validadeOk = (v) => /^\d{1,3}$/.test(String(v).trim()) && Number(v) >= 1 && Number(v) <= 365;

  LH.propostasRegras = { pendencias, cpfValido, validadeOk, LEGAIS, textoLegal, declaracoesPadrao, declaracoesDe, snapshotEmpresa, empresaDe, duplicar, totalLinha, totalProposta, proximoNumero };
}());
