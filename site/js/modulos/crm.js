/* =============================================================================
   LicitaHub · CRM - Licitante
   CRM do Licitante (quadro Kanban com as etapas do banco) e Cadastrar Empresa.
   No modo real, tudo é gravado no Supabase (crm_cards, empresas).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;

  /** Seletor da empresa cujo quadro está aberto (só aparece com 2 ou mais empresas). */
  function seletorEmpresa() {
    const lista = LH.repo.empresas();
    if (lista.length < 2) return '';
    return `<label class="campo" style="grid-auto-flow:column;align-items:center;gap:8px">
      <span class="campo__rotulo">Empresa</span>
      <select id="empresa-atual">${LH.opcoes(lista.map((e) => [e.id, e.fantasia || e.razao]), LH.repo.empresaAtualId())}</select></label>`;
  }

  // --- CRM do Licitante (Kanban) -----------------------------------------------------
  function cartao(c, etapas) {
    const l = c.licitacao;
    return `
      <article class="card spot kanban__cartao" draggable="true" data-cartao="${esc(c.id)}" aria-label="${esc(l.objeto)}">
        <h4>${esc(l.objeto)}</h4>
        <div class="kanban__meta">
          <span>${esc(l.orgao)}</span>
          <span>${esc(l.uf)} · ${l.valor == null ? 'Valor sigiloso' : fmt.moeda(l.valor)}</span>
          ${l.abertura ? `<span>Propostas até ${fmt.data(l.abertura)} (${fmt.relativo(l.abertura)})</span>` : ''}
        </div>
        ${c.nota ? `<p class="fraco"><strong>Nota:</strong> ${esc(c.nota)}</p>` : ''}
        <div class="kanban__acoes">
          <select data-mover="${esc(c.id)}" aria-label="Mover para a etapa">${LH.opcoes(etapas.map((e) => [e.id, e.nome]), c.etapaId)}</select>
          <button class="btn-icone btn-icone--pequeno" type="button" data-nota="${esc(c.id)}" aria-label="Anotação">${icone('lapis')}</button>
          <button class="btn-icone btn-icone--pequeno" type="button" data-tirar="${esc(c.id)}" aria-label="Tirar do CRM">${icone('lixeira')}</button>
        </div>
      </article>`;
  }

  LH.vistas.crm = {
    titulo: 'CRM do Licitante',
    trilha: 'CRM - Licitante',
    render: () => `
      ${LH.cabecalho({
        titulo: 'CRM do Licitante',
        texto: 'Acompanhe cada licitação da triagem até o resultado. Arraste os cartões entre as etapas.',
        acoes: `${seletorEmpresa()}<a class="btn btn--primario" href="#/buscar">${icone('mais')} Adicionar licitação</a>`,
      })}
      <div class="chips" id="crm-resumo" style="margin-bottom:16px" data-reveal></div>
      <div class="kanban" id="kanban" data-reveal>${LH.carregando('Carregando o quadro...')}</div>`,
    montar(raiz) {
      const quadro = raiz.querySelector('#kanban');
      let estado = { etapas: [], cartoes: [] };
      let arrastando = null;

      const desenhar = async () => {
        try {
          estado = await LH.repo.quadro();
        } catch (e) {
          quadro.innerHTML = LH.erroHtml(e);
          return;
        }
        if (estado.semEmpresa) {
          raiz.querySelector('#crm-resumo').innerHTML = '';
          quadro.innerHTML = `<div class="card" style="grid-column:1/-1">${LH.vazio('predio', 'Cadastre a sua empresa para começar',
            'No CRM, cada licitação é acompanhada por uma empresa (com CNPJ).', '<a class="btn btn--primario" href="#/crm/empresa">Cadastrar empresa</a>')}</div>`;
          return;
        }
        const { etapas, cartoes } = estado;
        const valorDe = (lista) => lista.reduce((s, c) => s + (c.licitacao.valor || 0), 0);
        const tipoDe = (c) => etapas.find((e) => String(e.id) === String(c.etapaId))?.tipo;
        const abertas = cartoes.filter((c) => tipoDe(c) === 'aberta');
        raiz.querySelector('#crm-resumo').innerHTML = `
          <span class="selo selo--info">${cartoes.length} licitação(ões) no CRM</span>
          <span class="selo">${fmt.moeda(valorDe(abertas))} em andamento</span>
          <span class="selo selo--sucesso">${cartoes.filter((c) => tipoDe(c) === 'ganha').length} ganha(s)</span>`;
        quadro.innerHTML = etapas.map((e) => {
          const daEtapa = cartoes.filter((c) => String(c.etapaId) === String(e.id));
          return `
            <section class="kanban__coluna" data-etapa="${esc(e.id)}" aria-label="${esc(e.nome)}">
              <header class="kanban__cabecalho">
                <span class="kanban__cor" style="background:${esc(e.cor)}"></span>${esc(e.nome)}
                <span class="selo">${daEtapa.length}</span>
                <span class="kanban__total">${fmt.moeda(valorDe(daEtapa))}</span>
              </header>
              ${daEtapa.map((c) => cartao(c, etapas)).join('') || '<p class="fraco" style="text-align:center;padding:16px 0">Solte um cartão aqui</p>'}
            </section>`;
        }).join('');
        if (!cartoes.length) LH.aviso('O seu CRM está vazio. Em "Buscar Licitações", use "Acompanhar no CRM".', 'info');
      };

      const mover = async (id, etapaId) => {
        const c = estado.cartoes.find((x) => String(x.id) === String(id));
        if (!c || String(c.etapaId) === String(etapaId)) return;
        try {
          await LH.repo.moverCartao(id, LH.repo.modo === 'demo' ? Number(etapaId) : etapaId);
          LH.aviso(`Movida para "${estado.etapas.find((e) => String(e.id) === String(etapaId)).nome}".`, 'sucesso', 2500);
        } catch (e) {
          LH.aviso(e.message, 'perigo');
        }
        desenhar();
      };

      // Arrastar e soltar
      quadro.addEventListener('dragstart', (e) => {
        const c = e.target.closest('[data-cartao]');
        if (!c) return;
        arrastando = c.dataset.cartao;
        c.classList.add('arrastando');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', arrastando);
      });
      quadro.addEventListener('dragend', (e) => {
        e.target.closest('[data-cartao]')?.classList.remove('arrastando');
        quadro.querySelectorAll('.alvo').forEach((c) => c.classList.remove('alvo'));
      });
      quadro.addEventListener('dragover', (e) => {
        const col = e.target.closest('[data-etapa]');
        if (!col || !arrastando) return;
        e.preventDefault();
        quadro.querySelectorAll('.alvo').forEach((c) => c !== col && c.classList.remove('alvo'));
        col.classList.add('alvo');
      });
      quadro.addEventListener('drop', (e) => {
        const col = e.target.closest('[data-etapa]');
        if (!col || !arrastando) return;
        e.preventDefault();
        mover(arrastando, col.dataset.etapa);
        arrastando = null;
      });

      // Alternativa pelo teclado/celular: "Mover para"
      LH.ao(quadro, 'change', '[data-mover]', (e, s) => mover(s.dataset.mover, s.value));
      LH.ao(quadro, 'click', '[data-tirar]', async (e, b) => {
        if (!(await LH.confirmar('Tirar do CRM', 'A licitação sai do quadro (continua na busca).', 'Tirar', true))) return;
        try { await LH.repo.removerCartao(b.dataset.tirar); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        desenhar();
      });
      LH.ao(quadro, 'click', '[data-nota]', (e, b) => {
        const c = estado.cartoes.find((x) => String(x.id) === b.dataset.nota);
        LH.modal({
          titulo: 'Anotação',
          html: `<label class="campo"><span class="campo__rotulo">O que é importante lembrar?</span><textarea id="nota-texto" maxlength="400">${esc(c.nota)}</textarea></label>`,
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            { rotulo: 'Salvar', classe: 'btn--primario', acao: async (fechar, janela) => {
              try {
                await LH.repo.anotar(c.id, janela.querySelector('#nota-texto').value.trim());
                fechar();
                desenhar();
              } catch (erro) { LH.aviso(erro.message, 'perigo'); }
            } },
          ],
        });
      });
      raiz.querySelector('#empresa-atual')?.addEventListener('change', (e) => {
        LH.repo.escolherEmpresa(e.target.value);
        quadro.innerHTML = LH.carregando('Carregando o quadro...');
        desenhar();
      });
      desenhar();
    },
  };

  // --- Cadastrar Empresa ---------------------------------------------------------------
  LH.vistas['crm/empresa'] = {
    titulo: 'Cadastrar Empresa',
    trilha: 'CRM - Licitante',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Cadastrar Empresa',
        texto: 'As empresas que participam das licitações. Cada uma tem o seu próprio quadro no CRM.',
      })}
      <div class="grade grade--lateral">
        <section class="card spot" data-reveal>
          <div class="card__titulo"><h2>${icone('predio')} Empresas cadastradas</h2><span class="selo selo--info" id="uso-empresas"></span></div>
          <div class="barra" style="margin-bottom:16px"><div class="barra__preenchimento" id="barra-empresas" style="width:0"></div></div>
          <div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Razão social</th><th>CNPJ</th><th>Porte</th><th>Local</th><th></th></tr></thead>
            <tbody id="empresas"></tbody>
          </table></div>
        </section>
        <form class="card spot form" id="form-empresa" data-reveal novalidate>
          <div class="card__titulo"><h2>${icone('mais')} Nova empresa</h2></div>
          <label class="campo"><span class="campo__rotulo">Razão social</span><input name="razao" required maxlength="200"></label>
          <label class="campo"><span class="campo__rotulo">CNPJ</span><input name="cnpj" required inputmode="numeric" placeholder="00.000.000/0000-00">
            <span class="campo__erro" id="erro-cnpj" hidden>CNPJ inválido: confira os números.</span></label>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Porte</span><select name="porte">${LH.opcoes([['MEI', 'MEI'], ['ME', 'ME'], ['EPP', 'EPP'], ['Demais', 'Demais']], 'ME')}</select></label>
            <label class="campo"><span class="campo__rotulo">UF</span><select name="uf">${LH.opcoes(LH.dados.UFS, 'SP')}</select></label>
          </div>
          <label class="campo"><span class="campo__rotulo">Cidade</span><input name="cidade"></label>
          <button class="btn btn--primario" type="submit">Cadastrar empresa</button>
        </form>
      </div>`,
    montar(raiz) {
      const form = raiz.querySelector('#form-empresa');
      const erro = raiz.querySelector('#erro-cnpj');
      const desenhar = () => {
        const lista = LH.repo.empresas();
        const limite = LH.repo.limiteEmpresas();
        raiz.querySelector('#uso-empresas').textContent = `${lista.length} de ${limite} no seu plano`;
        raiz.querySelector('#barra-empresas').style.width = `${Math.min(100, (lista.length / Math.max(1, limite)) * 100)}%`;
        raiz.querySelector('#empresas').innerHTML = lista.length ? lista.map((m) => `
          <tr><td><strong>${esc(m.razao)}</strong></td><td>${esc(m.cnpj ? LH.cnpj.mascara(m.cnpj) : '—')}</td><td>${esc(m.porte)}</td>
          <td>${esc([m.cidade, m.uf].filter(Boolean).join('/'))}</td>
          <td><button class="btn-icone btn-icone--pequeno" type="button" data-remover="${esc(m.id)}" aria-label="Remover ${esc(m.razao)}">${icone('lixeira')}</button></td></tr>`).join('')
          : '<tr><td colspan="5" class="fraco">Nenhuma empresa ainda. Cadastre a primeira ao lado.</td></tr>';
        form.querySelector('button[type=submit]').disabled = lista.length >= limite;
      };
      form.cnpj.addEventListener('input', () => {
        form.cnpj.value = LH.cnpj.mascara(form.cnpj.value);
        erro.hidden = true;
        form.cnpj.classList.remove('invalido');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.razao.value.trim()) return form.razao.focus();
        if (!LH.cnpj.valido(form.cnpj.value)) {
          erro.hidden = false;
          form.cnpj.classList.add('invalido');
          return form.cnpj.focus();
        }
        const botao = form.querySelector('button[type=submit]');
        botao.disabled = true;
        try {
          await LH.repo.salvarEmpresa({ razao: form.razao.value, cnpj: form.cnpj.value, porte: form.porte.value, uf: form.uf.value, cidade: form.cidade.value });
          form.reset();
          LH.aviso('Empresa cadastrada.', 'sucesso');
        } catch (erro2) {
          LH.aviso(erro2.message, 'perigo');
        }
        botao.disabled = false;
        desenhar();
      });
      LH.ao(raiz, 'click', '[data-remover]', async (e, b) => {
        if (!(await LH.confirmar('Remover empresa', 'A empresa sai desta organização, junto com o quadro dela no CRM.', 'Remover', true))) return;
        try {
          await LH.repo.removerEmpresa(b.dataset.remover);
          LH.aviso('Empresa removida.', 'sucesso');
        } catch (erro2) {
          LH.aviso(erro2.message, 'perigo');
        }
        desenhar();
      });
      desenhar();
    },
  };
})();
