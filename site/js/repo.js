/* =============================================================================
   Uso LicitaHub · repo.js
   Um só jeito de as telas pedirem dados (todas as funções são assíncronas):
     - modo real: Supabase (com o login e o RLS do usuário) e a API do servidor;
     - modo demonstração: os dados de exemplo e o armazenamento do navegador.
   LH.repo é escolhido no início (js/app.js).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const dois = (n) => String(n).padStart(2, '0');
  const sem = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const COLUNAS = 'id, fonte, numero_controle_pncp, objeto, orgao_razao_social, uf, municipio, modalidade_nome, '
    + 'valor_estimado, data_publicacao, data_encerramento_proposta, sistema_origem, link_sistema_origem, link_pncp, orgao_esfera, '
    + 'unidade_codigo, numero_compra, ano_compra';
  const EXTRAS = ['ie', 'im', 'regime', 'endereco', 'cep', 'representante', 'cpfRepresentante', 'cargo', 'banco', 'agencia', 'conta'];
  const POR_PAGINA = 20;

  // Licitações já vistas nesta visita (para abrir os detalhes sem buscar de novo).
  const cache = new Map();
  LH.licitacaoEmCache = (id) => cache.get(Number(id)) ?? LH.dados.licitacao(id);

  /** Linha do banco -> formato usado pelas telas. */
  function normalizar(r) {
    const prazo = r.data_encerramento_proposta ? new Date(r.data_encerramento_proposta) : null;
    const l = {
      id: Number(r.id),
      numero: String(r.numero_controle_pncp || '').split('-').pop() || `Nº ${r.id}`,
      objeto: r.objeto || 'Objeto não informado',
      orgao: r.orgao_razao_social || 'Órgão não informado',
      uf: r.uf || '—',
      municipio: r.municipio || '',
      modalidade: r.modalidade_nome || 'Licitação',
      valor: r.valor_estimado == null ? null : Number(r.valor_estimado),
      abertura: prazo ? LH.datas.paraIso(prazo) : null,
      hora: prazo ? `${dois(prazo.getHours())}:${dois(prazo.getMinutes())}` : '',
      plataforma: r.sistema_origem || 'Não informada',
      publicada: r.data_publicacao ? LH.datas.paraIso(new Date(r.data_publicacao)) : null,
      fonte: r.fonte === 'manual' ? 'Manual' : 'PNCP',
      linkPncp: r.link_pncp || null,
      linkDisputa: r.link_sistema_origem || null,
      esfera: r.orgao_esfera && r.orgao_esfera !== 'N' ? r.orgao_esfera : null,
      edital: r.numero_compra ? [r.numero_compra, r.ano_compra].filter(Boolean).join('/') : null,
      uasg: r.unidade_codigo || null,
      me_epp: false,
    };
    cache.set(l.id, l);
    return l;
  }

  /** Erro do banco em português (sem detalhes técnicos para o usuário). */
  function erroBanco(error, contexto = 'Não foi possível concluir') {
    const msg = String(error?.message || '');
    if (error?.code === '23505') return new Error('Esse registro já existe.');
    if (error?.code === '42501') return new Error('Você não tem permissão para fazer isso nesta organização.');
    if (/Failed to fetch|NetworkError/i.test(msg)) return new Error('Sem conexão com o banco de dados. Confira a internet.');
    if (error?.code === 'P0001' && msg) return new Error(msg); // mensagens dos gatilhos do banco (já em português)
    return new Error(`${contexto}. Tente de novo em instantes.`);
  }

  // Empresa: banco <-> tela
  const empresaParaTela = (r) => ({
    id: r.id, razao: r.razao_social, fantasia: r.nome_fantasia || '', cnpj: r.cnpj || '',
    porte: r.porte === 'DEMAIS' ? 'Demais' : (r.porte || 'ME'), uf: r.uf || '', cidade: r.municipio || '',
    email: r.email_contato || '', telefone: r.telefone_contato || '', ...(r.dados || {}),
  });
  const empresaParaBanco = (e) => ({
    razao_social: String(e.razao || '').trim().toUpperCase(),
    nome_fantasia: e.fantasia?.trim() || null,
    cnpj: LH.cnpj.limpar(e.cnpj),
    porte: e.porte === 'Demais' ? 'DEMAIS' : (e.porte || null),
    uf: e.uf || null,
    municipio: e.cidade?.trim() || null,
    email_contato: e.email?.trim() || null,
    telefone_contato: e.telefone?.trim() || null,
    dados: Object.fromEntries(EXTRAS.map((k) => [k, String(e[k] ?? '').trim()])),
  });
  const EMPRESA_VAZIA = { razao: '', fantasia: '', cnpj: '', porte: 'ME', uf: 'SP', cidade: '', email: '', telefone: '', ...Object.fromEntries(EXTRAS.map((k) => [k, ''])) };

  /** Favorita com prazo -> evento do calendário (marcado com estrela). */
  const eventoFavorita = (l) => ({
    id: `fav${l.id}`, data: l.abertura, hora: l.hora || '23:59', titulo: `★ Favorita encerra: ${l.objeto.slice(0, 70)}`,
    detalhe: l.orgao, tipo: 'favorita', licitacaoId: l.id,
  });

  // =========================================================================
  // Modo REAL
  // =========================================================================
  const db = () => LH.nuvem.cliente;
  const ctx = () => LH.nuvem.ctx;

  /** Trechos do nome do portal -> condição do PostgREST (sem vírgulas, parênteses nem espaços). */
  const padraoIlike = (p) => `*${String(p).replace(/[,()"]/g, '').replace(/\s+/g, '*')}*`;
  function filtroPlataformas(chaves) {
    const conds = [];
    for (const [chave, , partes] of LH.PLATAFORMAS) {
      if (chaves.includes(chave)) conds.push(...partes.map((p) => `sistema_origem.ilike.${padraoIlike(p)}`));
    }
    if (chaves.includes('outros')) {
      const todas = LH.PLATAFORMAS.flatMap(([, , partes]) => partes).map((p) => `sistema_origem.not.ilike.${padraoIlike(p)}`);
      conds.push(`and(${todas.join(',')})`, 'sistema_origem.is.null');
    }
    return conds.join(',');
  }
  const ORDEM_TABELA = {
    prazo: ['data_encerramento_proposta', { ascending: true }],
    relevancia: ['data_encerramento_proposta', { ascending: true }],
    valor: ['valor_estimado', { ascending: false, nullsFirst: false }],
    recentes: ['data_publicacao', { ascending: false, nullsFirst: false }],
  };
  /** Busca com filtro de plataforma / período de abertura (a função do banco não tem esses filtros). */
  async function buscarNaTabela(f, offset) {
    const agora = new Date().toISOString();
    const de = f.de ? `${f.de}T00:00:00-03:00` : null;
    let q = db().from('licitacoes').select(COLUNAS, { count: 'exact' })
      .gte('data_encerramento_proposta', de && de > agora ? de : agora);
    if (f.ate) q = q.lte('data_encerramento_proposta', `${f.ate}T23:59:59-03:00`);
    const termo = String(f.termo || '').trim();
    if (termo) q = q.textSearch('busca', termo, { type: 'websearch', config: 'portugues_sem_acento' });
    if (f.orgao) q = q.ilike('orgao_razao_social', `%${String(f.orgao).trim()}%`);
    if (f.uf) q = q.eq('uf', f.uf);
    if (f.municipio) q = q.ilike('municipio', String(f.municipio).trim());
    if (f.modalidade) q = q.eq('modalidade_id', Number(f.modalidade));
    if (f.min) q = q.gte('valor_estimado', f.min);
    if (f.max) q = q.lte('valor_estimado', f.max);
    if (f.plataformas?.length) q = q.or(filtroPlataformas(f.plataformas));
    const [coluna, opcoes] = ORDEM_TABELA[f.ordem] || ORDEM_TABELA.prazo;
    const { data, error, count } = await q.order(coluna, opcoes).order('id').range(offset, offset + POR_PAGINA - 1);
    if (error) throw erroBanco(error, 'A busca falhou');
    return { lista: data.map(normalizar), total: count ?? data.length, porPagina: POR_PAGINA };
  }

  const real = {
    modo: 'real',
    modalidades: LH.MODALIDADES.map(([id, nome]) => [String(id), nome]),

    async buscar(f, offset = 0) {
      if (f.plataformas?.length || f.de) return buscarNaTabela(f, offset);
      const municipios = (f.municipios?.length ? f.municipios : [f.municipio]).map((m) => String(m || '').trim()).filter(Boolean);
      const termoBase = [f.termo, f.orgao].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
      const termo = termoBase;
      const parametros = {
        p_termo: termo || null,
        p_ufs: f.ufs?.length ? f.ufs : (f.uf ? [f.uf] : null),
        p_modalidades: f.modalidades?.length ? f.modalidades.map(Number) : (f.modalidade ? [Number(f.modalidade)] : null),
        p_valor_min: f.min || null,
        p_valor_max: f.max || null,
        p_encerramento_ate: f.ate ? `${f.ate}T23:59:59-03:00` : null,
        p_somente_abertas: true,
        p_ordem: f.ordem === 'relevancia' && !termo ? 'prazo' : (f.ordem || 'prazo'),
        p_limite: POR_PAGINA,
        p_offset: offset,
      };
      let { data, error } = await db().rpc('buscar_licitacoes', { ...parametros, ...(municipios.length ? { p_municipios: municipios } : {}) });
      // Banco ainda sem o filtro de municípios (schema.sql antigo): o município vira palavra da busca.
      if (error?.code === 'PGRST202' && municipios.length) {
        ({ data, error } = await db().rpc('buscar_licitacoes', {
          ...parametros, p_termo: [termoBase, municipios.length === 1 ? municipios[0] : ''].filter(Boolean).join(' ') || null,
        }));
      }
      if (error) throw erroBanco(error, 'A busca falhou');
      // A função de busca não devolve a esfera do órgão: lê só essa coluna, de uma vez.
      const esferas = new Map();
      if (data?.length) {
        const { data: extra } = await db().from('licitacoes').select('id, orgao_esfera, unidade_codigo, numero_compra, ano_compra').in('id', data.map((r) => r.id));
        for (const e of extra || []) esferas.set(Number(e.id), e);
      }
      const lista = (data || []).map((r) => normalizar({ ...r, ...esferas.get(Number(r.id)), id: r.id }));
      return { lista, total: data?.length ? Number(data[0].total) : null, porPagina: POR_PAGINA };
    },

    /**
     * Radar: licitações abertas por município (para o mapa).
     * f: { termo, ufs, municipios, modalidades (ids), de, ate }  ->  [{ uf, municipio, total }]
     */
    async radarContagem(f) {
      const { data, error } = await db().rpc('radar_contagem', {
        p_termo: f.termo || null,
        p_ufs: f.ufs?.length ? f.ufs : null,
        p_municipios: f.municipios?.length ? f.municipios : null,
        p_modalidades: f.modalidades?.length ? f.modalidades.map(Number) : null,
        p_abertura_de: f.de || null,
        p_abertura_ate: f.ate || null,
      });
      if (error?.code === 'PGRST202') {
        throw new Error('O mapa do Radar precisa da função radar_contagem: rode de novo o supabase/schema.sql no Supabase.');
      }
      if (error) throw erroBanco(error, 'A busca do Radar falhou');
      return (data || []).map((r) => ({ uf: r.uf, municipio: r.municipio, total: Number(r.total) }));
    },
    /** Radar: as licitações de um município (ao clicar no mapa), com os mesmos filtros. */
    async licitacoesDoMunicipio(f, uf, municipio) {
      let q = db().from('licitacoes').select(COLUNAS)
        .eq('uf', uf).eq('municipio', municipio)
        .gte('data_encerramento_proposta', new Date().toISOString());
      if (f.termo) q = q.textSearch('busca', f.termo, { type: 'websearch', config: 'portugues_sem_acento' });
      if (f.modalidades?.length) q = q.in('modalidade_id', f.modalidades.map(Number));
      if (f.de) q = q.gte('data_abertura_proposta', `${f.de}T00:00:00-03:00`);
      if (f.ate) q = q.lte('data_abertura_proposta', `${f.ate}T23:59:59-03:00`);
      const { data, error } = await q.order('data_encerramento_proposta', { ascending: true }).limit(100);
      if (error) throw erroBanco(error, 'Não consegui carregar as licitações do município');
      return data.map(normalizar);
    },

    /** Observações do usuário: ids -> Map(id, texto). */
    async observacoes(ids) {
      const lista = [...new Set(ids.map(Number))].filter(Boolean).slice(0, 200);
      if (!lista.length) return new Map();
      const { data, error } = await db().from('licitacao_observacoes').select('licitacao_id, texto').in('licitacao_id', lista);
      if (error?.code === '42P01' || error?.code === 'PGRST205') {
        throw new Error('Falta a tabela de observações: rode o supabase/atualizar-observacoes.sql no Supabase.');
      }
      if (error) throw erroBanco(error, 'Não consegui carregar as observações');
      return new Map(data.map((o) => [Number(o.licitacao_id), o.texto]));
    },
    /** Grava (ou apaga, se vazio) a observação do usuário na licitação. */
    async salvarObservacao(id, texto) {
      const tabela = db().from('licitacao_observacoes');
      const { error } = texto
        ? await tabela.upsert({ licitacao_id: Number(id), texto, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id,licitacao_id' })
        : await tabela.delete().eq('licitacao_id', Number(id));
      if (error?.code === '42P01' || error?.code === 'PGRST205') {
        throw new Error('Falta a tabela de observações: rode o supabase/atualizar-observacoes.sql no Supabase.');
      }
      if (error) throw erroBanco(error, 'Não consegui salvar a observação');
    },

    async licitacoes(ids) {
      const lista = [...new Set(ids.map(Number))].filter(Boolean);
      if (!lista.length) return [];
      const { data, error } = await db().from('licitacoes').select(COLUNAS).in('id', lista.slice(0, 200));
      if (error) throw erroBanco(error, 'Não consegui carregar as licitações');
      return data.map(normalizar);
    },

    async favoritos() {
      const { data, error } = await db().from('favoritos').select('licitacao_id');
      if (error) throw erroBanco(error, 'Não consegui carregar as favoritas');
      return new Set(data.map((f) => Number(f.licitacao_id)));
    },

    async alternarFavorito(id) {
      const { data: existe, error: e1 } = await db().from('favoritos').select('licitacao_id').eq('licitacao_id', id).maybeSingle();
      if (e1) throw erroBanco(e1);
      if (existe) {
        const { error } = await db().from('favoritos').delete().eq('licitacao_id', id);
        if (error) throw erroBanco(error);
        return false;
      }
      const { error } = await db().from('favoritos').insert({ licitacao_id: Number(id) });
      if (error) throw erroBanco(error);
      return true;
    },

    async kpis() {
      const desde = new Date(Date.now() - 86400000).toISOString();
      const [abertas, novas, crm] = await Promise.all([
        db().rpc('buscar_licitacoes', { p_limite: 1 }),
        db().from('licitacoes').select('id', { count: 'exact', head: true }).gte('data_publicacao', desde),
        db().from('crm_cards').select('id', { count: 'exact', head: true }).eq('organizacao_id', ctx().organizacao.id).eq('arquivado', false),
      ]);
      return {
        total: Number(abertas.data?.[0]?.total ?? 0), totalDesc: 'Abertas agora, vindas do PNCP',
        novas: novas.count ?? 0, acompanhando: crm.count ?? 0,
      };
    },

    // --- CRM ---------------------------------------------------------------
    etapas: () => ctx().etapas.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, tipo: e.tipo })),

    async quadro() {
      const c = ctx();
      if (!c.empresaAtual) return { etapas: real.etapas(), cartoes: [], semEmpresa: true };
      const { data, error } = await db().from('vw_crm_cards').select('*')
        .eq('organizacao_id', c.organizacao.id).eq('empresa_id', c.empresaAtual).eq('arquivado', false).order('posicao');
      if (error) throw erroBanco(error, 'Não consegui carregar o CRM');
      return {
        etapas: real.etapas(),
        cartoes: data.map((r) => ({
          id: r.id, etapaId: r.etapa_id, nota: r.observacoes || '',
          licitacao: normalizar({ ...r, id: r.licitacao_id, fonte: r.licitacao_fonte }),
        })),
      };
    },
    async moverCartao(id, etapaId) {
      const { error } = await db().from('crm_cards').update({ etapa_id: etapaId }).eq('id', id);
      if (error) throw erroBanco(error);
    },
    async adicionarAoCrm(licitacaoId) {
      const c = ctx();
      if (!c.empresaAtual) throw Object.assign(new Error('Cadastre a sua empresa antes de acompanhar licitações no CRM.'), { codigo: 'sem_empresa' });
      const { error } = await db().from('crm_cards').insert({
        organizacao_id: c.organizacao.id, empresa_id: c.empresaAtual, licitacao_id: Number(licitacaoId), etapa_id: c.etapas[0].id,
      });
      if (error?.code === '23505') throw Object.assign(new Error('Esta licitação já está no seu CRM.'), { codigo: 'ja_existe' });
      if (error) throw erroBanco(error, 'Não consegui adicionar ao CRM');
    },
    async removerCartao(id) {
      const { error } = await db().from('crm_cards').delete().eq('id', id);
      if (error) throw erroBanco(error);
    },
    async anotar(id, texto) {
      const { error } = await db().from('crm_cards').update({ observacoes: texto || null }).eq('id', id);
      if (error) throw erroBanco(error);
    },

    // --- Empresas ------------------------------------------------------------
    empresas: () => ctx().empresas.map(empresaParaTela),
    empresaAtualId: () => ctx().empresaAtual,
    escolherEmpresa: (id) => LH.nuvem.escolherEmpresa(id),
    limiteEmpresas: () => ctx().organizacao.limite_empresas,
    /** Empresa usada em propostas e declarações (síncrono). */
    empresaPerfil() {
      const atual = ctx()?.empresas.find((e) => e.id === ctx().empresaAtual);
      return atual ? empresaParaTela(atual) : { ...EMPRESA_VAZIA };
    },
    async salvarEmpresa(e) {
      const gravar = (linha) => (e.id
        ? db().from('empresas').update(linha).eq('id', e.id).select('id').single()
        : db().from('empresas').insert({ ...linha, organizacao_id: ctx().organizacao.id }).select('id').single());
      let r = await gravar(empresaParaBanco(e));
      // Banco ainda sem a coluna "dados" (schema.sql antigo): salva o principal e avisa.
      if (r.error?.code === 'PGRST204' && /dados/.test(r.error.message || '')) {
        const { dados, ...semDados } = empresaParaBanco(e);
        r = await gravar(semDados);
        if (!r.error) LH.aviso('Empresa salva. Endereço, representante e banco só ficam guardados depois de rodar o schema.sql novo no Supabase.', 'alerta', 9000);
      }
      if (r.error?.code === '23505') throw new Error('Este CNPJ já está cadastrado nesta organização.');
      if (r.error?.code === '23514') throw new Error('Confira o CNPJ e o porte: o banco recusou os dados.');
      if (r.error) throw erroBanco(r.error, 'Não consegui salvar a empresa');
      await LH.nuvem.carregarContexto();
      if (!e.id && !ctx().empresaAtual) LH.nuvem.escolherEmpresa(r.data.id);
      return r.data.id;
    },
    async removerEmpresa(id) {
      if (!LH.nuvem.podeGerenciar()) throw new Error('Só o dono ou um administrador da organização pode remover empresas.');
      // Os arquivos dos documentos saem antes: o banco não apaga arquivos do Storage.
      const pasta = `${ctx().organizacao.id}/${id}`;
      const { data: itens, error: e1 } = await db().storage.from('documentos').list(pasta, { limit: 1000 });
      if (e1) throw erroBanco(e1, 'Não consegui apagar os arquivos da empresa');
      const arquivos = (itens || []).filter((i) => i.id).map((i) => `${pasta}/${i.name}`);
      if (arquivos.length) {
        const { error: e2 } = await db().storage.from('documentos').remove(arquivos);
        if (e2) throw erroBanco(e2, 'Não consegui apagar os arquivos da empresa');
      }
      const { error } = await db().from('empresas').delete().eq('id', id);
      if (error) throw erroBanco(error, 'Não consegui remover a empresa');
      await LH.nuvem.carregarContexto();
    },

    // --- Agenda --------------------------------------------------------------
    async eventos() {
      const [quadro, favs, proprios, docs] = await Promise.all([real.quadro(), real.favoritos(), real.eventosProprios(), real.documentos()]);
      const favoritas = await real.licitacoes([...favs]);
      const doBanco = [
        ...quadro.cartoes.map((c) => c.licitacao).filter((l) => l.abertura && !favs.has(l.id))
          .map((l) => ({ id: `crm${l.id}`, data: l.abertura, hora: l.hora, titulo: `Prazo final: ${l.objeto.slice(0, 70)}`, detalhe: l.orgao, tipo: 'sessao' })),
        ...favoritas.filter((l) => l.abertura).map(eventoFavorita),
      ];
      return [...doBanco, ...proprios, ...vencimentosDe(docs.lista)].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    },
    async licitacoesDoUsuario() {
      const [quadro, favs] = await Promise.all([real.quadro(), real.favoritos()]);
      const doCrm = quadro.cartoes.map((c) => c.licitacao);
      const ids = new Set(doCrm.map((l) => l.id));
      return [...doCrm, ...(await real.licitacoes([...favs].filter((id) => !ids.has(id))))];
    },

    // --- Leitura de edital (IA) ---------------------------------------------
    async analisar({ licitacaoId, arquivo }) {
      const corpo = { organizacao_id: ctx().organizacao.id };
      if (arquivo) {
        const nome = sem(arquivo.name).replace(/[^\w.-]+/g, '-').slice(-80) || 'edital.pdf';
        const caminho = `${ctx().organizacao.id}/${Date.now()}-${nome}`;
        const { error } = await db().storage.from('editais').upload(caminho, arquivo, { contentType: 'application/pdf' });
        if (error) throw erroBanco(error, 'Não consegui enviar o PDF');
        corpo.arquivo_path = caminho;
        corpo.nome_arquivo = arquivo.name;
      } else {
        corpo.licitacao_id = Number(licitacaoId);
      }
      return LH.nuvem.api('/api/editais/analisar', { metodo: 'POST', corpo });
    },
    analise: (id) => LH.nuvem.api(`/api/editais/analises/${encodeURIComponent(id)}`),
    async historico() {
      const { data, error } = await db().from('analises_edital')
        .select('id, status, arquivo_nome, criado_em, licitacao_id, licitacoes(objeto)')
        .eq('organizacao_id', ctx().organizacao.id).order('criado_em', { ascending: false }).limit(8);
      if (error) throw erroBanco(error, 'Não consegui carregar o histórico');
      return data.map((a) => ({ id: a.id, status: a.status, criado: a.criado_em, titulo: a.licitacoes?.objeto || a.arquivo_nome || 'Edital enviado' }));
    },
    async usoIa() {
      const inicio = `${LH.datas.hoje().slice(0, 7)}-01T00:00:00-03:00`;
      const { count } = await db().from('analises_edital').select('id', { count: 'exact', head: true })
        .eq('organizacao_id', ctx().organizacao.id).gte('criado_em', inicio).neq('status', 'erro')
        .or('modelo.is.null,modelo.neq.reaproveitado');
      return { usadas: count ?? 0, limite: ctx().organizacao.limite_analises_ia_mes };
    },

    // --- Conta e assinatura -----------------------------------------------------
    conta() {
      const c = ctx();
      return {
        nome: c.perfil.nome, telefone: c.perfil.telefone || '', email: LH.nuvem.usuario.email,
        organizacao: c.organizacao, papel: c.papel, assinatura: c.assinatura,
      };
    },
    async salvarConta({ nome, telefone }) {
      const { error } = await db().from('perfis').update({ nome: nome.trim(), telefone: telefone.trim() || null }).eq('id', LH.nuvem.usuario.id);
      if (error) throw erroBanco(error, 'Não consegui salvar os seus dados');
      await LH.nuvem.carregarContexto();
    },
    async marketing() {
      const { data } = await db().from('vw_consentimentos_atuais').select('aceito').eq('tipo', 'comunicacoes_marketing').maybeSingle();
      return Boolean(data?.aceito);
    },
    async definirMarketing(aceito) {
      const { error } = await db().from('consentimentos').insert({ tipo: 'comunicacoes_marketing', versao: '2026-11', aceito, origem: 'app' });
      if (error) throw erroBanco(error);
    },
    trocarSenha: (nova) => LH.nuvem.trocarSenha(nova),
    async exportar() {
      const { data, error } = await db().rpc('exportar_meus_dados');
      if (error) throw erroBanco(error, 'Não consegui exportar os dados');
      return data;
    },
    async excluirConta() {
      await LH.nuvem.api('/api/conta', { metodo: 'DELETE' });
      await LH.nuvem.sair().catch(() => {});
    },
    async assinar() {
      const r = await LH.nuvem.api('/api/assinaturas/checkout', { metodo: 'POST', corpo: { organizacao_id: ctx().organizacao.id, plano: 'starter', ciclo: 'mensal' } });
      return r.url;
    },
    async portal() {
      const r = await LH.nuvem.api('/api/assinaturas/portal', { metodo: 'POST', corpo: { organizacao_id: ctx().organizacao.id } });
      return r.url;
    },
    recarregar: () => LH.nuvem.carregarContexto(),

    // --- Documentos da empresa (tabela documentos + pasta "documentos") ---------
    async documentos() {
      const c = ctx();
      if (!c.empresaAtual) return { semEmpresa: true, lista: [] };
      const { data, error } = await db().from('documentos').select('id, nome, tipo, emissao, validade, arquivo_path, arquivo_nome')
        .eq('organizacao_id', c.organizacao.id).eq('empresa_id', c.empresaAtual).order('validade', { ascending: true, nullsFirst: false });
      if (error) throw erroBanco(error, 'Não consegui carregar os documentos');
      return { lista: data.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo, emissao: d.emissao, validade: d.validade, arquivo: d.arquivo_nome || '', arquivoPath: d.arquivo_path })) };
    },
    async salvarDocumento(doc, arquivo) {
      const c = ctx();
      if (!c.empresaAtual) throw Object.assign(new Error('Cadastre a sua empresa antes de guardar documentos.'), { codigo: 'sem_empresa' });
      let caminho = doc.arquivoPath || null;
      let nomeArquivo = doc.arquivo || null;
      if (arquivo) {
        const nome = sem(arquivo.name).replace(/[^\w.-]+/g, '-').slice(-80) || 'documento.pdf';
        const novo = `${c.organizacao.id}/${c.empresaAtual}/${Date.now()}-${nome}`;
        const { error } = await db().storage.from('documentos').upload(novo, arquivo, { contentType: arquivo.type || 'application/pdf' });
        if (error) throw erroBanco(error, 'Não consegui enviar o arquivo (PDF, PNG ou JPG de até 10 MB)');
        if (caminho) await db().storage.from('documentos').remove([caminho]);
        caminho = novo;
        nomeArquivo = arquivo.name;
      }
      const linha = { nome: doc.nome.trim(), tipo: doc.tipo, emissao: doc.emissao || null, validade: doc.validade || null, arquivo_path: caminho, arquivo_nome: nomeArquivo };
      const r = doc.id
        ? await db().from('documentos').update(linha).eq('id', doc.id)
        : await db().from('documentos').insert({ ...linha, organizacao_id: c.organizacao.id, empresa_id: c.empresaAtual });
      if (r.error) throw erroBanco(r.error, 'Não consegui salvar o documento');
    },
    async removerDocumento(doc) {
      if (doc.arquivoPath) await db().storage.from('documentos').remove([doc.arquivoPath]);
      const { error } = await db().from('documentos').delete().eq('id', doc.id);
      if (error) throw erroBanco(error);
    },
    async abrirArquivo(doc) {
      const { data, error } = await db().storage.from('documentos').createSignedUrl(doc.arquivoPath, 120);
      if (error) throw erroBanco(error, 'Não consegui abrir o arquivo');
      return data.signedUrl;
    },

    // --- Propostas -------------------------------------------------------------
    async propostas() {
      const { data, error } = await db().from('propostas').select('*').eq('organizacao_id', ctx().organizacao.id).order('criado_em', { ascending: false });
      if (error) throw erroBanco(error, 'Não consegui carregar as propostas');
      return data.map(propostaParaTela);
    },
    async proposta(id) {
      const { data, error } = await db().from('propostas').select('*').eq('id', id).maybeSingle();
      if (error) throw erroBanco(error, 'Não consegui abrir a proposta');
      return data ? propostaParaTela(data) : null;
    },
    async proximoNumeroProposta() {
      const { count } = await db().from('propostas').select('id', { count: 'exact', head: true }).eq('organizacao_id', ctx().organizacao.id);
      return `PROP-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(3, '0')}`;
    },
    async salvarProposta(p) {
      const linha = {
        numero: p.numero, status: p.status || 'Rascunho', licitacao_id: p.licitacaoId || null, licitacao_resumo: p.licitacao || null,
        validade_dias: Number(p.validade) || null, prazo: p.prazo || null, pagamento: p.pagamento || null,
        observacoes: p.observacoes || null, itens: p.itens || [], total: Number(p.total) || 0, empresa_id: ctx().empresaAtual || null,
      };
      const r = p.id
        ? await db().from('propostas').update(linha).eq('id', p.id).select('id').single()
        : await db().from('propostas').insert({ ...linha, organizacao_id: ctx().organizacao.id }).select('id').single();
      if (r.error) throw erroBanco(r.error, 'Não consegui salvar a proposta');
      return r.data.id;
    },
    async removerProposta(id) {
      const { error } = await db().from('propostas').delete().eq('id', id);
      if (error) throw erroBanco(error);
    },

    // --- Radares ---------------------------------------------------------------
    async radares() {
      const ler = (colunas) => db().from('radares').select(colunas)
        .eq('organizacao_id', ctx().organizacao.id).order('criado_em', { ascending: false });
      let { data, error } = await ler('id, nome, palavras, ufs, municipios, modalidades, canais, ativo');
      // Coluna "municipios" ainda não criada (schema.sql antigo): lê sem ela.
      if (error?.code === '42703') ({ data, error } = await ler('id, nome, palavras, ufs, modalidades, canais, ativo'));
      if (error) throw erroBanco(error, 'Não consegui carregar os radares');
      return data.map((r) => ({ ...r, municipios: r.municipios || [] }));
    },
    async salvarRadar(r) {
      const linha = {
        nome: r.nome, palavras: r.palavras.slice(0, 20), ufs: r.ufs, municipios: r.municipios || [],
        modalidades: r.modalidades, canais: r.canais, ativo: r.ativo !== false,
      };
      const gravar = (l) => (r.id
        ? db().from('radares').update(l).eq('id', r.id)
        : db().from('radares').insert({ ...l, organizacao_id: ctx().organizacao.id }));
      let res = await gravar(linha);
      if (res.error?.code === '23514') {
        throw new Error('O raio tem municípios demais para salvar. Rode de novo o supabase/schema.sql (ele aumenta o limite) ou diminua o raio.');
      }
      if (res.error?.code === 'PGRST204' && linha.municipios.length) {
        throw new Error('Para salvar municípios no radar, rode de novo o supabase/schema.sql no Supabase (ele cria a coluna "municipios").');
      }
      if (res.error?.code === 'PGRST204') { const { municipios, ...semMunicipios } = linha; res = await gravar(semMunicipios); }
      if (res.error) throw erroBanco(res.error, 'Não consegui salvar o radar');
    },
    async removerRadar(id) {
      const { error } = await db().from('radares').delete().eq('id', id);
      if (error) throw erroBanco(error);
    },

    // --- Eventos do calendário criados pelo usuário ------------------------------
    async eventosProprios() {
      const { data, error } = await db().from('eventos').select('id, data, hora, titulo, detalhe, tipo').eq('organizacao_id', ctx().organizacao.id);
      if (error) throw erroBanco(error, 'Não consegui carregar a agenda');
      return data.map((e) => ({ ...e, hora: String(e.hora || '09:00').slice(0, 5), detalhe: e.detalhe || '', proprio: true }));
    },
    async salvarEvento(ev) {
      const { error } = await db().from('eventos').insert({
        organizacao_id: ctx().organizacao.id, data: ev.data, hora: ev.hora || null, titulo: ev.titulo, detalhe: ev.detalhe || null, tipo: ev.tipo,
      });
      if (error) throw erroBanco(error, 'Não consegui marcar o evento');
    },
    async removerEvento(id) {
      const { error } = await db().from('eventos').delete().eq('id', id);
      if (error) throw erroBanco(error);
    },

    // --- Monitoramento (Cadastro Comprasnet) ------------------------------------
    async monitoramento() {
      const { data, error } = await db().from('monitoramentos').select('cnpj, nome, pregoes, palavras').eq('organizacao_id', ctx().organizacao.id).maybeSingle();
      if (error) throw erroBanco(error, 'Não consegui carregar o monitoramento');
      const emp = real.empresaPerfil();
      return data ?? { cnpj: emp.cnpj || '', nome: emp.razao || '', pregoes: [], palavras: [emp.razao, 'convoca', 'anexo', 'prazo'].filter(Boolean) };
    },
    async salvarMonitoramento(cfg) {
      const { error } = await db().from('monitoramentos').upsert({
        organizacao_id: ctx().organizacao.id, cnpj: LH.cnpj.limpar(cfg.cnpj) || null, nome: cfg.nome || null,
        pregoes: cfg.pregoes || [], palavras: cfg.palavras || [],
      }, { onConflict: 'organizacao_id' });
      if (error) throw erroBanco(error, 'Não consegui salvar o monitoramento');
    },

    // --- Licita Lances ---
    async roboItens() {
      const { data, error } = await db().from('robo_itens').select('*').eq('organizacao_id', ctx().organizacao.id).order('criado_em');
      if (error?.code === '42P01' || error?.code === 'PGRST205') throw new Error('Falta a tabela do Licita Lances: rode o supabase/atualizar-robo.sql no Supabase.');
      if (error) throw erroBanco(error, 'Não consegui carregar os itens do Licita Lances');
      return data.map(roboParaTela);
    },
    async salvarRoboItem(item) {
      const linha = roboParaBanco(item);
      const { data, error } = await (item.id
        ? db().from('robo_itens').update(linha).eq('id', item.id).select('*').single()
        : db().from('robo_itens').insert({ ...linha, organizacao_id: ctx().organizacao.id }).select('*').single());
      if (error) throw erroBanco(error, 'Não consegui salvar o item');
      return roboParaTela(data);
    },
    async roboEstado(id, { status, nossoLance, melhorLance, fase }) {
      const campos = { bid_status: status };
      if (fase !== undefined) campos.fase = fase;
      if (nossoLance !== undefined) campos.nosso_lance = nossoLance;
      if (melhorLance !== undefined) campos.melhor_lance = melhorLance;
      const { error } = await db().from('robo_itens').update(campos).eq('id', id);
      if (error) throw erroBanco(error, 'Não consegui gravar o estado do Licita Lances');
    },
    async excluirRoboItem(id) {
      const { error } = await db().from('robo_itens').delete().eq('id', id);
      if (error) throw erroBanco(error, 'Não consegui excluir o item');
    },
  };

  const numOuNulo = (v) => (v == null || v === '' ? null : Number(v));
  function roboParaTela(r) {
    return {
      id: r.id, descricao: r.descricao, itemNumero: r.item_numero, licitacaoId: r.licitacao_id,
      teto: numOuNulo(r.max_price), custo: numOuNulo(r.supplier_cost), piso: numOuNulo(r.min_floor_price),
      decremento: numOuNulo(r.decremento) ?? 0.01, intervaloSeg: r.intervalo_seg ?? 20, status: r.bid_status || 'idle',
      plataforma: r.plataforma || 'comprasnet', quantidade: r.quantidade || 1,
      nossoPorte: r.nosso_porte || 'demais', fugirEmpate: !!r.fugir_empate, fase: r.fase || null,
      pregaoRef: r.pregao_ref || null, loteRef: r.lote_ref || null,
      nossoLance: numOuNulo(r.nosso_lance), melhorLance: numOuNulo(r.melhor_lance),
    };
  }
  function roboParaBanco(i) {
    return {
      descricao: i.descricao, item_numero: i.itemNumero || null, licitacao_id: i.licitacaoId || null,
      max_price: i.teto, supplier_cost: i.custo ?? null, min_floor_price: i.piso,
      decremento: i.decremento || 0.01, intervalo_seg: i.intervaloSeg ?? 20, plataforma: i.plataforma || 'comprasnet',
      quantidade: i.quantidade || 1, nosso_porte: i.nossoPorte || 'demais', fugir_empate: !!i.fugirEmpate,
      pregao_ref: i.pregaoRef || null, lote_ref: i.loteRef || null,
    };
  }

  /** Proposta do banco -> formato da tela. */
  function propostaParaTela(r) {
    return {
      id: r.id, numero: r.numero, status: r.status, licitacaoId: r.licitacao_id, licitacao: r.licitacao_resumo,
      criada: LH.datas.paraIso(new Date(r.criado_em)), validade: r.validade_dias || 60, prazo: r.prazo || '',
      pagamento: r.pagamento || '', observacoes: r.observacoes || '', itens: r.itens || [], total: Number(r.total) || 0,
    };
  }

  /** Vencimentos de documentos viram prazos no calendário. */
  function vencimentosDe(lista) {
    return lista.filter((d) => d.validade)
      .map((d) => ({ id: `v${d.id}`, data: d.validade, hora: '23:59', titulo: `Vence: ${d.nome}`, detalhe: 'Gestor de documentos', tipo: 'prazo' }));
  }

  // =========================================================================
  // Modo DEMONSTRAÇÃO (dados de exemplo + navegador)
  // =========================================================================
  const ordens = {
    relevancia: (a, b) => a.abertura.localeCompare(b.abertura),
    prazo: (a, b) => a.abertura.localeCompare(b.abertura),
    valor: (a, b) => b.valor - a.valor,
    recentes: (a, b) => b.publicada.localeCompare(a.publicada),
  };
  const etapasDemo = () => LH.dados.etapas.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, tipo: e.id === 6 ? 'ganha' : e.id === 7 ? 'perdida' : 'aberta' }));

  /** Demonstração: aplica os filtros do Radar aos dados de exemplo. */
  function filtrarRadarDemo(f) {
    const alternativas = sem(f.termo).split(/\s+or\s+/).map((t) => t.replace(/"/g, '').split(/\s+/).filter(Boolean)).filter((t) => t.length);
    const municipios = new Set((f.municipios || []).map(sem));
    return LH.dados.licitacoes.filter((l) => {
      const texto = sem(`${l.objeto} ${l.orgao}`);
      return (!alternativas.length || alternativas.some((ps) => ps.every((t) => texto.includes(t))))
        && (!f.ufs?.length || f.ufs.includes(l.uf))
        && (!municipios.size || municipios.has(sem(l.municipio)))
        && (!f.modalidades?.length || f.modalidades.map(LH.nomeModalidade).includes(l.modalidade))
        && (!f.de || l.abertura >= f.de)
        && (!f.ate || l.abertura <= f.ate);
    }).sort(ordens.prazo);
  }

  const demo = {
    modo: 'demo',
    modalidades: LH.MODALIDADES.map(([, nome]) => [nome, nome]),

    async buscar(f, offset = 0) {
      // "a or b" (Radar): basta um dos termos; senão, todas as palavras.
      const alternativas = sem(f.termo).split(/\s+or\s+/).map((t) => t.replace(/"/g, '').split(/\s+/).filter(Boolean)).filter((t) => t.length);
      const municipios = (f.municipios?.length ? f.municipios : [f.municipio]).filter(Boolean).map(sem);
      const ufs = f.ufs?.length ? f.ufs : (f.uf ? [f.uf] : []);
      const modalidades = f.modalidades?.length ? f.modalidades : (f.modalidade ? [f.modalidade] : []);
      const lista = LH.dados.licitacoes.filter((l) => {
        const texto = sem(`${l.objeto} ${l.orgao} ${l.numero} ${l.municipio}`);
        return (!alternativas.length || alternativas.some((ps) => ps.every((t) => texto.includes(t))))
          && (!f.orgao || sem(l.orgao).includes(sem(f.orgao)))
          && (!municipios.length || municipios.includes(sem(l.municipio)) || (!f.municipios?.length && sem(l.municipio).includes(municipios[0])))
          && (!modalidades.length || modalidades.includes(l.modalidade))
          && (!ufs.length || ufs.includes(l.uf))
          && (!f.min || l.valor >= f.min)
          && (!f.max || l.valor <= f.max)
          && (!f.ate || l.abertura <= f.ate)
          && (!f.de || l.abertura >= f.de)
          && (!f.plataformas?.length || f.plataformas.includes(LH.plataformaDe(l.plataforma)));
      }).sort(ordens[f.ordem] || ordens.prazo);
      return { lista: lista.slice(offset, offset + POR_PAGINA), total: lista.length, porPagina: POR_PAGINA };
    },
    async radarContagem(f) {
      const contagem = new Map();
      for (const l of filtrarRadarDemo(f)) {
        const chave = `${l.uf}|${l.municipio}`;
        contagem.set(chave, { uf: l.uf, municipio: l.municipio, total: (contagem.get(chave)?.total || 0) + 1 });
      }
      return [...contagem.values()];
    },
    licitacoesDoMunicipio: async (f, uf, municipio) => filtrarRadarDemo(f).filter((l) => l.uf === uf && l.municipio === municipio),
    licitacoes: async (ids) => ids.map(LH.dados.licitacao).filter(Boolean),
    // Demonstração: observações neste navegador.
    async observacoes(ids) {
      const todas = LH.estado.obter('observacoes') || {};
      return new Map(ids.filter((id) => todas[id]).map((id) => [Number(id), todas[id]]));
    },
    async salvarObservacao(id, texto) {
      const todas = { ...(LH.estado.obter('observacoes') || {}) };
      if (texto) todas[id] = texto; else delete todas[id];
      LH.estado.salvar('observacoes', todas);
    },
    favoritos: async () => new Set(LH.estado.obter('favoritos')),
    alternarFavorito: async (id) => LH.estado.alternarFavorito(Number(id)),
    kpis: async () => ({
      total: LH.dados.totais.plataforma, totalDesc: 'Na plataforma',
      novas: LH.dados.totais.novas24h, acompanhando: LH.estado.obter('crm').length,
    }),

    etapas: etapasDemo,
    async quadro() {
      return {
        etapas: etapasDemo(),
        cartoes: LH.estado.obter('crm').map((c) => ({ id: c.id, etapaId: c.etapa, nota: c.nota, licitacao: LH.dados.licitacao(c.licitacaoId) })).filter((c) => c.licitacao),
      };
    },
    async moverCartao(id, etapaId) {
      const crm = LH.estado.obter('crm');
      crm.find((c) => c.id === id).etapa = Number(etapaId);
      LH.estado.salvar('crm', crm);
    },
    async adicionarAoCrm(licitacaoId) {
      const crm = LH.estado.obter('crm');
      if (crm.some((c) => c.licitacaoId === Number(licitacaoId))) throw Object.assign(new Error('Esta licitação já está no seu CRM.'), { codigo: 'ja_existe' });
      crm.push({ id: LH.idNovo('c'), licitacaoId: Number(licitacaoId), etapa: 1, nota: '' });
      LH.estado.salvar('crm', crm);
    },
    async removerCartao(id) { LH.estado.salvar('crm', LH.estado.obter('crm').filter((c) => c.id !== id)); },
    async anotar(id, texto) {
      const crm = LH.estado.obter('crm');
      crm.find((c) => c.id === id).nota = texto;
      LH.estado.salvar('crm', crm);
    },

    empresas: () => LH.estado.obter('empresas').map((m) => ({ ...EMPRESA_VAZIA, ...m })),
    empresaAtualId: () => LH.estado.obter('empresas')[0]?.id ?? null,
    escolherEmpresa: () => {},
    limiteEmpresas: () => 10,
    empresaPerfil: () => ({ ...EMPRESA_VAZIA, ...LH.estado.obter('empresa') }),
    async salvarEmpresa(e) {
      if (e.perfil) { LH.estado.salvar('empresa', { ...LH.estado.obter('empresa'), ...e }); return 'perfil'; }
      const lista = LH.estado.obter('empresas');
      if (lista.some((m) => m.cnpj === LH.cnpj.limpar(e.cnpj) && m.id !== e.id)) throw new Error('Este CNPJ já está cadastrado nesta organização.');
      const nova = { ...e, id: e.id || LH.idNovo('m'), cnpj: LH.cnpj.limpar(e.cnpj), razao: String(e.razao).trim().toUpperCase() };
      LH.estado.salvar('empresas', [...lista.filter((m) => m.id !== nova.id), nova]);
      return nova.id;
    },
    async removerEmpresa(id) { LH.estado.salvar('empresas', LH.estado.obter('empresas').filter((m) => m.id !== id)); },

    eventos: async () => [
      ...LH.dados.eventosPadrao, ...(await demo.eventosProprios()), ...vencimentosDe(LH.estado.obter('documentos')),
      ...LH.estado.obter('favoritos').map(LH.dados.licitacao).filter((l) => l?.abertura).map(eventoFavorita),
    ]
      .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)),
    licitacoesDoUsuario: async () => LH.dados.licitacoes,

    analisar: async () => { throw new Error('demo'); },
    analise: async () => null,
    historico: async () => [],
    usoIa: async () => ({ usadas: 4, limite: 30 }),

    conta() {
      const p = LH.estado.obter('perfil');
      return { nome: p.nome, telefone: p.telefone, email: p.email, organizacao: { nome: 'Minha organização', plano: 'starter', limite_empresas: 10, limite_analises_ia_mes: 30 }, papel: 'dono', assinatura: { status: 'trialing', teste_fim: new Date(Date.now() + 30 * 86400000).toISOString() } };
    },
    async salvarConta(d) { LH.estado.salvar('perfil', { ...LH.estado.obter('perfil'), ...d }); },
    marketing: async () => Boolean(LH.estado.obter('perfil').marketing),
    async definirMarketing(aceito) { LH.estado.salvar('perfil', { ...LH.estado.obter('perfil'), marketing: aceito }); },
    trocarSenha: async () => { throw new Error('Na demonstração não há senha para trocar.'); },
    async exportar() {
      const nomes = ['perfil', 'empresa', 'empresas', 'documentos', 'propostas', 'crm', 'favoritos', 'radares', 'eventos', 'comprasnet'];
      return { gerado_em: new Date().toISOString(), ...Object.fromEntries(nomes.map((n) => [n, LH.estado.obter(n)])) };
    },
    async excluirConta() { LH.estado.limparTudo(); },
    assinar: async () => { throw new Error('Na demonstração o pagamento não é aberto. Rode o site pelo servidor (npm run servidor).'); },
    portal: async () => { throw new Error('Na demonstração o portal da Stripe não é aberto.'); },
    recarregar: async () => {},

    // Documentos, propostas, radares, eventos e monitoramento no navegador
    documentos: async () => ({ lista: LH.estado.obter('documentos') }),
    async salvarDocumento(doc, arquivo) {
      const novo = { id: doc.id || LH.idNovo('d'), nome: doc.nome.trim(), tipo: doc.tipo, emissao: doc.emissao || LH.datas.hoje(), validade: doc.validade || null, arquivo: arquivo?.name || doc.arquivo || '' };
      LH.estado.salvar('documentos', [...LH.estado.obter('documentos').filter((d) => d.id !== novo.id), novo]);
    },
    async removerDocumento(doc) { LH.estado.salvar('documentos', LH.estado.obter('documentos').filter((d) => d.id !== doc.id)); },
    abrirArquivo: async () => { throw new Error('Na demonstração o arquivo não fica guardado.'); },

    propostas: async () => LH.estado.obter('propostas'),
    proposta: async (id) => LH.estado.obter('propostas').find((p) => p.id === id) ?? null,
    proximoNumeroProposta: async () => `PROP-${new Date().getFullYear()}-${String(LH.estado.obter('propostas').length + 14).padStart(3, '0')}`,
    async salvarProposta(p) {
      const nova = { ...p, id: p.id || LH.idNovo('p'), criada: p.criada || LH.datas.hoje() };
      LH.estado.salvar('propostas', [nova, ...LH.estado.obter('propostas').filter((x) => x.id !== nova.id)]);
      return nova.id;
    },
    async removerProposta(id) { LH.estado.salvar('propostas', LH.estado.obter('propostas').filter((p) => p.id !== id)); },

    radares: async () => LH.estado.obter('radares'),
    async salvarRadar(r) {
      const novo = { ...r, id: r.id || LH.idNovo('r'), ativo: r.ativo !== false };
      const lista = LH.estado.obter('radares');
      LH.estado.salvar('radares', r.id ? lista.map((x) => (x.id === r.id ? novo : x)) : [novo, ...lista]);
    },
    async removerRadar(id) { LH.estado.salvar('radares', LH.estado.obter('radares').filter((r) => r.id !== id)); },

    eventosProprios: async () => LH.estado.obter('eventos').map((e) => ({ ...e, proprio: true })),
    async salvarEvento(ev) { LH.estado.salvar('eventos', [...LH.estado.obter('eventos'), { ...ev, id: LH.idNovo('u') }]); },
    async removerEvento(id) { LH.estado.salvar('eventos', LH.estado.obter('eventos').filter((e) => e.id !== id)); },

    monitoramento: async () => LH.estado.obter('comprasnet'),
    async salvarMonitoramento(cfg) { LH.estado.salvar('comprasnet', { ...LH.estado.obter('comprasnet'), ...cfg, cnpj: LH.cnpj.limpar(cfg.cnpj) }); },

    // Licita Lances (demonstração: neste navegador)
    roboItens: async () => LH.estado.obter('robo') || [],
    async salvarRoboItem(item) {
      const lista = LH.estado.obter('robo') || [];
      const salvo = { status: 'idle', nossoLance: null, melhorLance: null, ...item, id: item.id || LH.idNovo('r') };
      LH.estado.salvar('robo', item.id ? lista.map((i) => (i.id === item.id ? { ...i, ...salvo } : i)) : [...lista, salvo]);
      return salvo;
    },
    async roboEstado(id, campos) {
      const limpos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
      LH.estado.salvar('robo', (LH.estado.obter('robo') || []).map((i) => (i.id === id ? { ...i, ...limpos } : i)));
    },
    async excluirRoboItem(id) { LH.estado.salvar('robo', (LH.estado.obter('robo') || []).filter((i) => i.id !== id)); },
  };

  LH.repos = { real, demo };
  LH.repo = demo;
})();
