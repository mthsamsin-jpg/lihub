/* =============================================================================
   Uso LicitaHub · Agenda
   Calendário (mensal, com eventos por dia) e Gestor de documentos
   (certidões, vencimentos e arquivos). No modo real, tudo fica no banco
   (tabelas eventos e documentos, pasta privada "documentos").
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const TIPOS = [['sessao', 'Sessão pública'], ['prazo', 'Prazo'], ['abertura', 'Abertura']];

  /** Seletor da empresa (só aparece com 2 ou mais). Ao trocar, recarrega a tela. */
  LH.seletorEmpresa = (rota) => {
    const lista = LH.repo.empresas();
    if (lista.length < 2) return '';
    return `<label class="campo" style="grid-auto-flow:column;align-items:center;gap:8px"><span class="campo__rotulo">Empresa</span>
      <select data-trocar-empresa="${esc(rota)}">${LH.opcoes(lista.map((e) => [e.id, e.fantasia || e.razao]), LH.repo.empresaAtualId())}</select></label>`;
  };
  document.addEventListener('change', (e) => {
    const s = e.target.closest('[data-trocar-empresa]');
    if (!s) return;
    LH.repo.escolherEmpresa(s.value);
    LH.ir(s.dataset.trocarEmpresa);
  });

  // --- Calendário --------------------------------------------------------------------
  LH.vistas.calendario = {
    titulo: 'Calendário',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Calendário',
        texto: 'Sessões públicas, prazos das licitações que você acompanha, suas favoritas (com estrela), vencimento de documentos e os seus lembretes, dia a dia.',
      })}
      <div class="grade grade--lateral">
        <section class="card spot" data-reveal>
          <div class="card__titulo">
            <h2>${icone('calendario')} Calendário de licitações</h2>
            <div class="chips">
              <span class="selo"><i style="width:8px;height:8px;border-radius:50%;background:var(--ciano)"></i>Abertura</span>
              <span class="selo"><i style="width:8px;height:8px;border-radius:50%;background:var(--alerta)"></i>Sessão</span>
              <span class="selo"><i style="width:8px;height:8px;border-radius:50%;background:var(--perigo)"></i>Prazo</span>
              <span class="selo"><i style="width:8px;height:8px;border-radius:50%;background:var(--favorita)"></i>Favorita</span>
            </div>
          </div>
          <div id="cal-grande"></div>
        </section>
        <aside class="grade" style="align-content:start">
          <form class="card form" id="form-evento" data-reveal>
            <div class="card__titulo"><h2>${icone('mais')} Novo evento</h2></div>
            <label class="campo"><span class="campo__rotulo">Título</span><input name="titulo" required maxlength="200" placeholder="ex.: Sessão do pregão 90012/2026"></label>
            <div class="form__linha">
              <label class="campo"><span class="campo__rotulo">Data</span><input type="date" name="data" required value="${LH.datas.hoje()}"></label>
              <label class="campo"><span class="campo__rotulo">Hora</span><input type="time" name="hora" required value="09:00"></label>
            </div>
            <label class="campo"><span class="campo__rotulo">Tipo</span><select name="tipo">${LH.opcoes(TIPOS, 'sessao')}</select></label>
            <label class="campo"><span class="campo__rotulo">Detalhe (opcional)</span><input name="detalhe" maxlength="400" placeholder="Órgão, link da sessão..."></label>
            <button class="btn btn--primario" type="submit">Adicionar ao calendário</button>
          </form>
          <section class="card" data-reveal>
            <div class="card__titulo"><h2>${icone('relogio')} Próximos 7 dias</h2></div>
            <div class="cal__eventos" id="proximos" style="margin:0">${LH.carregando()}</div>
          </section>
        </aside>
      </div>`,
    montar(raiz) {
      const form = raiz.querySelector('#form-evento');
      let eventos = [];
      const cal = LH.calendario(raiz.querySelector('#cal-grande'), {
        grande: true,
        eventos: () => eventos,
        aoSelecionar: (data) => { form.data.value = data; },
      });

      const desenharProximos = () => {
        const hoje = LH.datas.hoje();
        const limite = LH.datas.somar(7);
        const lista = eventos.filter((e) => e.data >= hoje && e.data <= limite);
        raiz.querySelector('#proximos').innerHTML = lista.length ? lista.map((ev) => `
          <div class="evento evento--${ev.tipo}">
            <span class="evento__hora">${fmt.data(ev.data).slice(0, 5)}</span>
            <div class="evento__texto">${esc(ev.titulo)}<span>${ev.hora === '23:59' ? 'o dia todo' : esc(ev.hora)} · ${esc(fmt.relativo(ev.data))}</span></div>
            ${ev.proprio ? `<button class="btn-icone btn-icone--pequeno" type="button" data-apagar="${esc(ev.id)}" aria-label="Apagar evento">${icone('lixeira')}</button>` : ''}
          </div>`).join('') : '<p class="fraco">Nada marcado para os próximos dias.</p>';
      };
      const recarregar = async () => {
        try {
          eventos = await LH.repo.eventos();
        } catch (e) {
          LH.aviso(`Não consegui carregar a agenda: ${e.message}`, 'alerta');
        }
        cal.atualizar();
        desenharProximos();
      };

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        const botao = form.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          await LH.repo.salvarEvento({ data: d.data, hora: d.hora, titulo: d.titulo.trim(), detalhe: d.detalhe.trim(), tipo: d.tipo });
          form.titulo.value = '';
          form.detalhe.value = '';
          LH.aviso(`Evento marcado para ${fmt.data(d.data)}.`, 'sucesso');
          await recarregar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        botao.disabled = false;
      });
      LH.ao(raiz, 'click', '[data-apagar]', async (e, b) => {
        try {
          await LH.repo.removerEvento(b.dataset.apagar);
          await recarregar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      // Favoritou ou tirou uma licitação (em qualquer tela): o calendário se atualiza na hora.
      document.addEventListener('lh:favoritos', recarregar);
      recarregar();
      return () => document.removeEventListener('lh:favoritos', recarregar);
    },
  };

  // --- Gestor de documentos ----------------------------------------------------------
  const MODELOS = [
    'CND Federal (Receita Federal / PGFN)', 'CND FGTS (Certificado de Regularidade do FGTS)',
    'CNDT - Certidão Negativa de Débitos Trabalhistas', 'Certidão Negativa Correcional (CGU)',
    'Certidão de Regularidade Estadual (SEFAZ)', 'Certidão Negativa de Débitos Municipais',
    'Certidão de Falência e Recuperação Judicial', 'Balanço Patrimonial e Demonstrações Contábeis',
    'Atestado de Capacidade Técnica', 'Contrato Social Consolidado', 'Alvará de Funcionamento',
  ];
  const TIPOS_DOC = ['Fiscal', 'Trabalhista', 'Jurídica', 'Econômico-financeira', 'Técnica', 'Integridade', 'Outros'];
  const FILTROS = [['todos', 'Todos'], ['vencido', 'Vencidos'], ['avencer', 'A vencer (15 dias)'], ['valido', 'Válidos'], ['sem', 'Sem validade']];

  function formDocumento(doc = {}) {
    return `
      <form class="form" id="form-doc">
        <label class="campo"><span class="campo__rotulo">Documento</span>
          <input name="nome" list="modelos-doc" required maxlength="200" value="${esc(doc.nome || '')}" placeholder="ex.: CND FGTS">
          <datalist id="modelos-doc">${MODELOS.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></label>
        <label class="campo"><span class="campo__rotulo">Tipo</span><select name="tipo">${LH.opcoes(TIPOS_DOC, doc.tipo || 'Fiscal')}</select></label>
        <div class="form__linha">
          <label class="campo"><span class="campo__rotulo">Emissão</span><input type="date" name="emissao" value="${esc(doc.emissao || LH.datas.hoje())}"></label>
          <label class="campo"><span class="campo__rotulo">Validade (vazio = não vence)</span><input type="date" name="validade" value="${esc(doc.validade || '')}"></label>
        </div>
        <label class="campo"><span class="campo__rotulo">Arquivo (PDF, PNG ou JPG, até 10 MB)${doc.arquivo ? ` · atual: ${esc(doc.arquivo)}` : ''}</span>
          <input type="file" name="arquivo" accept="application/pdf,image/png,image/jpeg">
          <span class="campo__ajuda">${LH.repo.modo === 'real' ? 'O arquivo fica guardado numa pasta privada da sua organização.' : 'Na demonstração o arquivo não sai do seu computador: só o nome fica guardado.'}</span></label>
      </form>`;
  }

  LH.vistas.documentos = {
    titulo: 'Gestor de documentos',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Gestor de documentos',
        texto: 'Certidões negativas, CND FGTS, balanço e atestados com alerta de vencimento, para nunca perder uma habilitação por documento vencido.',
        acoes: `${LH.seletorEmpresa('documentos')}<button class="btn btn--primario" type="button" data-acao="novo">${icone('enviar')} Adicionar documento</button>`,
      })}
      <div class="contadores contadores--3" id="doc-contadores" data-reveal></div>
      <section class="card spot" data-reveal>
        <div class="card__titulo">
          <div class="alternador" role="group" aria-label="Filtrar documentos" id="doc-filtros">
            ${FILTROS.map(([v, r], i) => `<button type="button" data-filtro="${v}" class="${i ? '' : 'ativo'}">${r}</button>`).join('')}
          </div>
        </div>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Documento</th><th>Tipo</th><th>Emissão</th><th>Validade</th><th>Situação</th><th>Arquivo</th><th></th></tr></thead>
            <tbody id="doc-linhas"><tr><td colspan="7">${LH.carregando()}</td></tr></tbody>
          </table>
        </div>
      </section>
      <p class="nota" data-reveal style="margin-top:18px">${icone('info')} Onde emitir: CND Federal na Receita Federal/PGFN, CND FGTS na Caixa, CNDT no Tribunal Superior do Trabalho e a Certidão Correcional na CGU. Confira sempre a validade exigida no edital.</p>`,
    montar(raiz) {
      let filtro = 'todos';
      let docs = [];
      const desenhar = async () => {
        let r;
        try {
          r = await LH.repo.documentos();
        } catch (e) {
          raiz.querySelector('#doc-linhas').innerHTML = `<tr><td colspan="7">${LH.erroHtml(e)}</td></tr>`;
          return;
        }
        if (r.semEmpresa) {
          raiz.querySelector('#doc-contadores').innerHTML = '';
          raiz.querySelector('#doc-linhas').innerHTML = `<tr><td colspan="7">${LH.vazio('predio', 'Cadastre a sua empresa primeiro',
            'Os documentos são guardados por empresa (CNPJ).', '<a class="btn btn--primario" href="#/crm/empresa">Cadastrar empresa</a>')}</td></tr>`;
          return;
        }
        docs = r.lista.map((d) => ({ ...d, sit: LH.situacaoDocumento(d) }));
        const conta = (c) => docs.filter((d) => d.sit.chave === c).length;
        raiz.querySelector('#doc-contadores').innerHTML = `
          <div class="contador contador--perigo"><strong>${conta('vencido')}</strong><span>Vencidos</span></div>
          <div class="contador contador--alerta"><strong>${conta('avencer')}</strong><span>Vencem em até 15 dias</span></div>
          <div class="contador contador--sucesso"><strong>${conta('valido')}</strong><span>Válidos</span></div>`;
        const lista = docs.filter((d) => filtro === 'todos' || d.sit.chave === filtro)
          .sort((a, b) => (a.validade || '9999').localeCompare(b.validade || '9999'));
        raiz.querySelector('#doc-linhas').innerHTML = lista.length ? lista.map((d) => `
          <tr>
            <td><strong>${esc(d.nome)}</strong></td>
            <td>${esc(d.tipo)}</td>
            <td>${fmt.data(d.emissao)}</td>
            <td>${d.validade ? fmt.data(d.validade) : '—'}</td>
            <td><span class="selo ${d.sit.classe}">${esc(d.sit.texto)}</span></td>
            <td>${d.arquivo
              ? (d.arquivoPath ? `<button class="btn btn--pequeno" type="button" data-abrir="${esc(d.id)}">${icone('arquivo')} ${esc(d.arquivo.slice(0, 28))}</button>` : `<span class="selo selo--info">${icone('arquivo')} ${esc(d.arquivo)}</span>`)
              : '<span class="fraco">—</span>'}</td>
            <td style="white-space:nowrap">
              <button class="btn-icone btn-icone--pequeno" type="button" data-editar="${esc(d.id)}" aria-label="Atualizar ${esc(d.nome)}">${icone('lapis')}</button>
              <button class="btn-icone btn-icone--pequeno" type="button" data-excluir="${esc(d.id)}" aria-label="Excluir ${esc(d.nome)}">${icone('lixeira')}</button>
            </td>
          </tr>`).join('') : `<tr><td colspan="7" class="fraco">${docs.length ? 'Nenhum documento neste filtro.' : 'Nenhum documento ainda. Use "Adicionar documento".'}</td></tr>`;
      };

      const abrirFormulario = (doc) => {
        LH.modal({
          titulo: doc ? 'Atualizar documento' : 'Adicionar documento',
          html: formDocumento(doc),
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            {
              rotulo: 'Salvar', classe: 'btn--primario',
              acao: async (fechar, janela) => {
                const f = janela.querySelector('#form-doc');
                if (!f.reportValidity()) return;
                const d = new FormData(f);
                const arquivo = d.get('arquivo');
                const temArquivo = arquivo && arquivo.name;
                if (temArquivo && arquivo.size > 10 * 1024 * 1024) return LH.aviso('O arquivo passa de 10 MB.', 'alerta');
                const botao = janela.querySelector('.btn--primario');
                botao.disabled = true;
                try {
                  await LH.repo.salvarDocumento({
                    ...(doc || {}), nome: d.get('nome'), tipo: d.get('tipo'), emissao: d.get('emissao'), validade: d.get('validade'),
                  }, temArquivo ? arquivo : null);
                  fechar();
                  LH.aviso('Documento salvo.', 'sucesso');
                  desenhar();
                } catch (erro) {
                  botao.disabled = false;
                  if (erro.codigo === 'sem_empresa') { fechar(); LH.ir('crm/empresa'); }
                  LH.aviso(erro.message, 'perigo');
                }
              },
            },
          ],
        });
      };

      LH.ao(raiz, 'click', '[data-acao="novo"]', () => abrirFormulario());
      LH.ao(raiz, 'click', '[data-editar]', (e, b) => abrirFormulario(docs.find((d) => String(d.id) === b.dataset.editar)));
      LH.ao(raiz, 'click', '[data-abrir]', async (e, b) => {
        // Abre a aba já no clique (senão o navegador bloqueia) e corta o vínculo com o site.
        const janela = window.open('', '_blank');
        if (janela) janela.opener = null;
        try {
          const url = await LH.repo.abrirArquivo(docs.find((d) => String(d.id) === b.dataset.abrir));
          if (janela) janela.location.href = url; else window.location.href = url;
        } catch (erro) { janela?.close(); LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-excluir]', async (e, b) => {
        if (!(await LH.confirmar('Excluir documento', 'O documento e o arquivo dele são apagados e deixam de gerar alertas.', 'Excluir', true))) return;
        try {
          await LH.repo.removerDocumento(docs.find((d) => String(d.id) === b.dataset.excluir));
          desenhar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-filtro]', (e, b) => {
        filtro = b.dataset.filtro;
        raiz.querySelectorAll('[data-filtro]').forEach((x) => x.classList.toggle('ativo', x === b));
        desenhar();
      });
      desenhar();
    },
  };
})();
