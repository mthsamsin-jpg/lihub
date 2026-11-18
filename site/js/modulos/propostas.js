/* =============================================================================
   Uso LicitaHub · Propostas e declarações
   Gerador de proposta (Criar proposta / Minhas propostas; no modo real, tabela
   propostas) e Gerador de declarações (modelos da Lei nº 14.133/2021).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const STATUS = ['Rascunho', 'Enviada', 'Em análise', 'Aceita', 'Recusada'];
  const AVISO_RESPONSABILIDADE = `<p class="nota nota--alerta nao-imprimir">${icone('alerta')} Revise a proposta e o edital antes de enviar. O Uso LicitaHub ajuda a montar o documento, mas a responsabilidade final pela proposta é sua.</p>`;

  const empresa = () => LH.repo.empresaPerfil();
  const numeroCurto = (n) => String(n ?? '').split(' ').pop();
  /** Licitação da proposta: o resumo salvo junto, ou a que está em memória. */
  const licitacaoDe = (p) => p.licitacao || LH.licitacaoEmCache(p.licitacaoId) || null;

  // --- Criar proposta ------------------------------------------------------------
  function linhaItem(item = {}, i = 0) {
    return `
      <tr>
        <td>${i + 1}</td>
        <td><input name="descricao" value="${esc(item.descricao || '')}" placeholder="Descrição do item conforme o edital" required></td>
        <td class="col-un"><input name="unidade" value="${esc(item.unidade || 'un')}"></td>
        <td class="col-qtd"><input name="quantidade" inputmode="decimal" value="${esc(item.quantidade ?? 1)}"></td>
        <td class="col-valor"><input name="unitario" inputmode="decimal" value="${esc(item.unitario ? String(item.unitario).replace('.', ',') : '')}" placeholder="0,00"></td>
        <td class="numero" data-total>—</td>
        <td><button class="btn-icone btn-icone--pequeno" type="button" data-remover aria-label="Remover item">${icone('lixeira')}</button></td>
      </tr>`;
  }

  function folhaProposta(p) {
    const e = empresa();
    const l = licitacaoDe(p);
    const total = p.itens.reduce((s, it) => s + it.quantidade * it.unitario, 0);
    return `
      <div class="folha">
        <h2>PROPOSTA COMERCIAL</h2>
        <p class="fraco" style="text-align:center">${esc(p.numero)} · ${esc(fmt.dataLonga(p.criada || LH.datas.hoje()))}</p>
        <h3>Ao(À) ${esc(l ? l.orgao : 'órgão licitante')}</h3>
        <p>Ref.: ${esc(l ? `${l.modalidade} nº ${numeroCurto(l.numero)}` : 'edital')}${l ? ` — ${esc(l.objeto)}` : ''}</p>
        <h3>Proponente</h3>
        <p><strong>${esc(e.razao || '—')}</strong> · CNPJ ${esc(e.cnpj ? LH.cnpj.mascara(e.cnpj) : 'não informado')}<br>
        ${esc([e.endereco, e.cidade && `${e.cidade}/${e.uf}`, e.cep].filter(Boolean).join(' · ') || 'Endereço não informado')}<br>
        ${esc([e.email, e.telefone].filter(Boolean).join(' · '))}</p>
        <h3>Itens</h3>
        <table>
          <thead><tr><th>#</th><th>Descrição</th><th>Un.</th><th class="numero">Qtd.</th><th class="numero">Valor unitário</th><th class="numero">Valor total</th></tr></thead>
          <tbody>${p.itens.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.descricao)}</td><td>${esc(it.unidade)}</td>
            <td class="numero">${fmt.numero(it.quantidade)}</td><td class="numero">${fmt.moeda(it.unitario)}</td><td class="numero">${fmt.moeda(it.quantidade * it.unitario)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="5" class="numero">Valor global</th><th class="numero">${fmt.moeda(total)}</th></tr></tfoot>
        </table>
        <p style="margin-top:8px"><strong>Valor global:</strong> ${fmt.moeda(total)} (${esc(LH.porExtenso(total))}).</p>
        <h3>Condições</h3>
        <p>Validade da proposta: ${esc(p.validade)} dias a contar da data de abertura da sessão pública.</p>
        <p>Prazo de entrega/execução: ${esc(p.prazo || 'conforme o edital')}.</p>
        <p>Condições de pagamento: ${esc(p.pagamento || 'conforme o edital')}.</p>
        <p>Declaramos que os preços propostos incluem todos os custos e despesas, como tributos, encargos sociais, trabalhistas, fretes e seguros, necessários ao cumprimento integral do objeto.</p>
        ${p.observacoes ? `<p>${esc(p.observacoes)}</p>` : ''}
        ${e.banco ? `<p>Dados bancários: ${esc(e.banco)}, agência ${esc(e.agencia)}, conta ${esc(e.conta)}.</p>` : ''}
        <div class="folha__assinatura"><span></span>${esc(e.representante || 'Representante legal')}<br>${esc(e.cargo || '')} · ${esc(e.razao || '')}</div>
      </div>`;
  }

  LH.vistas['proposta/criar'] = {
    titulo: 'Criar proposta',
    trilha: 'Gerador de proposta',
    render: (p) => `
      ${LH.cabecalho({
        titulo: p.id ? 'Proposta' : 'Criar proposta',
        texto: 'Monte a proposta comercial com os itens do edital. O valor total e o valor por extenso são calculados sozinhos.',
        acoes: `<a class="btn" href="#/proposta/minhas">${icone('arquivo')} Minhas propostas</a>`,
      })}
      ${!empresa().cnpj ? `<p class="nota" data-reveal style="margin-bottom:18px">${icone('info')} Complete os dados da sua empresa em <a href="#/empresa">Sua empresa</a>: eles entram automaticamente na proposta.</p>` : ''}
      <form class="grade" id="form-proposta" autocomplete="off">
        <section class="card spot form" data-reveal>
          <div class="card__titulo"><h2>${icone('arquivo')} Licitação e condições</h2><span class="selo" id="numero-proposta">…</span></div>
          <label class="campo"><span class="campo__rotulo">Licitação</span>
            <select name="licitacaoId" required><option value="">Carregando...</option></select></label>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Validade da proposta (dias)</span><input name="validade" inputmode="numeric" value="60"></label>
            <label class="campo"><span class="campo__rotulo">Prazo de entrega/execução</span><input name="prazo" maxlength="200" placeholder="ex.: 15 dias após o pedido"></label>
            <label class="campo"><span class="campo__rotulo">Condições de pagamento</span><input name="pagamento" maxlength="200" placeholder="ex.: 30 dias após o aceite"></label>
          </div>
        </section>
        <section class="card spot" data-reveal>
          <div class="card__titulo"><h2>${icone('etiqueta')} Itens</h2>
            <button class="btn btn--pequeno" type="button" data-acao="item">${icone('mais')} Adicionar item</button></div>
          <div class="tabela-rolagem">
            <table class="tabela itens">
              <thead><tr><th>#</th><th>Descrição</th><th>Unid.</th><th>Qtd.</th><th>Valor unit. (R$)</th><th class="numero">Total</th><th></th></tr></thead>
              <tbody id="itens">${linhaItem({}, 0)}</tbody>
            </table>
          </div>
          <div class="total-geral"><span class="suave">Valor global</span><strong id="total">R$ 0,00</strong></div>
          <p class="fraco" id="extenso" style="text-align:right"></p>
          <label class="campo" style="margin-top:14px"><span class="campo__rotulo">Observações (opcional)</span>
            <textarea name="observacoes" maxlength="2000" placeholder="Marca/modelo, garantia, assistência técnica..."></textarea></label>
          <div class="card__rodape">
            <button class="btn btn--primario" type="submit">${icone('check')} Salvar proposta</button>
            <button class="btn" type="button" data-acao="previa">${icone('olho')} Pré-visualizar</button>
            <button class="btn" type="button" data-acao="imprimir">${icone('impressora')} Imprimir / PDF</button>
          </div>
        </section>
      </form>
      ${AVISO_RESPONSABILIDADE}
      <section class="area-impressao" id="previa" style="margin-top:18px"></section>`,
    montar(raiz, p) {
      const form = raiz.querySelector('#form-proposta');
      const corpo = raiz.querySelector('#itens');
      let atual = null; // proposta aberta (ao editar)
      let numero = '';

      const ler = () => {
        const itens = [...corpo.rows].map((tr) => ({
          descricao: tr.querySelector('[name=descricao]').value.trim(),
          unidade: tr.querySelector('[name=unidade]').value.trim() || 'un',
          quantidade: fmt.lerNumero(tr.querySelector('[name=quantidade]').value),
          unitario: fmt.lerNumero(tr.querySelector('[name=unitario]').value),
        }));
        const total = itens.reduce((s, it) => s + it.quantidade * it.unitario, 0);
        const l = LH.licitacaoEmCache(form.licitacaoId.value) || atual?.licitacao || null;
        return {
          id: atual?.id, numero, criada: atual?.criada || LH.datas.hoje(), status: atual?.status || 'Rascunho',
          licitacaoId: Number(form.licitacaoId.value) || null,
          licitacao: l ? { numero: l.numero, objeto: l.objeto, orgao: l.orgao, modalidade: l.modalidade } : null,
          validade: form.validade.value || 60, prazo: form.prazo.value.trim(), pagamento: form.pagamento.value.trim(),
          observacoes: form.observacoes.value.trim(), itens, total,
        };
      };
      const recalcular = () => {
        [...corpo.rows].forEach((tr, i) => {
          tr.cells[0].textContent = i + 1;
          const q = fmt.lerNumero(tr.querySelector('[name=quantidade]').value);
          const u = fmt.lerNumero(tr.querySelector('[name=unitario]').value);
          tr.querySelector('[data-total]').textContent = q && u ? fmt.moeda(q * u) : '—';
        });
        const { total } = ler();
        raiz.querySelector('#total').textContent = fmt.moeda(total);
        raiz.querySelector('#extenso').textContent = total ? `(${LH.porExtenso(total)})` : '';
      };
      const previa = () => {
        const caixa = raiz.querySelector('#previa');
        caixa.innerHTML = `<div class="secao__titulo nao-imprimir"><h2>Pré-visualização</h2></div>${folhaProposta(ler())}`;
        return caixa;
      };

      // Carrega a proposta (ao editar) ou o próximo número, e as licitações do usuário.
      (async () => {
        try {
          if (p.id) {
            atual = await LH.repo.proposta(p.id);
            if (!atual) { LH.aviso('Proposta não encontrada.', 'alerta'); return LH.ir('proposta/minhas'); }
            numero = atual.numero;
            form.validade.value = atual.validade;
            form.prazo.value = atual.prazo;
            form.pagamento.value = atual.pagamento;
            form.observacoes.value = atual.observacoes;
            if (atual.itens?.length) corpo.innerHTML = atual.itens.map(linhaItem).join('');
            raiz.querySelector('h1').textContent = `Proposta ${atual.numero}`;
          } else {
            numero = await LH.repo.proximoNumeroProposta();
          }
          raiz.querySelector('#numero-proposta').textContent = numero;
          recalcular();
          const escolhida = Number(atual?.licitacaoId || p.licitacao) || null;
          let lista = await LH.repo.licitacoesDoUsuario();
          if (escolhida && !lista.some((l) => l.id === escolhida)) lista = [...(await LH.repo.licitacoes([escolhida])), ...lista];
          form.licitacaoId.innerHTML = LH.opcoes(lista.map((l) => [l.id, `${l.numero} · ${l.objeto.slice(0, 70)}`]), escolhida || '',
            lista.length ? 'Escolha a licitação' : 'Favorite ou acompanhe uma licitação primeiro');
        } catch (e) { LH.aviso(e.message, 'perigo'); }
      })();

      corpo.addEventListener('input', recalcular);
      LH.ao(raiz, 'click', '[data-remover]', (e, b) => {
        if (corpo.rows.length === 1) return LH.aviso('A proposta precisa de pelo menos um item.', 'alerta');
        b.closest('tr').remove();
        recalcular();
      });
      LH.ao(raiz, 'click', '[data-acao]', (e, b) => {
        if (b.dataset.acao === 'item') {
          corpo.insertAdjacentHTML('beforeend', linhaItem({}, corpo.rows.length));
          corpo.rows[corpo.rows.length - 1].querySelector('input').focus();
          recalcular();
        }
        if (b.dataset.acao === 'previa') previa().scrollIntoView({ behavior: 'smooth' });
        if (b.dataset.acao === 'imprimir') {
          if (!form.reportValidity()) return;
          previa();
          window.print();
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const proposta = ler();
        if (!proposta.total) return LH.aviso('Preencha a quantidade e o valor unitário dos itens.', 'alerta');
        const botao = form.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          const id = await LH.repo.salvarProposta(proposta);
          atual = { ...proposta, id };
          LH.aviso(`Proposta ${proposta.numero} salva em "Minhas propostas".`, 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        botao.disabled = false;
      });
    },
  };

  // --- Minhas propostas ----------------------------------------------------------
  LH.vistas['proposta/minhas'] = {
    titulo: 'Minhas propostas',
    trilha: 'Gerador de proposta',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Minhas propostas',
        texto: 'Propostas salvas, com a situação de cada uma.',
        acoes: `<a class="btn btn--primario" href="#/proposta/criar">${icone('mais')} Criar proposta</a>`,
      })}
      <section class="card spot" data-reveal>
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Número</th><th>Licitação</th><th>Criada em</th><th>Situação</th><th class="numero">Valor</th><th></th></tr></thead>
            <tbody id="propostas"><tr><td colspan="6">${LH.carregando()}</td></tr></tbody>
          </table>
        </div>
      </section>`,
    montar(raiz) {
      let lista = [];
      const desenhar = async () => {
        try {
          lista = await LH.repo.propostas();
        } catch (e) {
          raiz.querySelector('#propostas').innerHTML = `<tr><td colspan="6">${LH.erroHtml(e)}</td></tr>`;
          return;
        }
        raiz.querySelector('#propostas').innerHTML = lista.length ? lista.map((p) => {
          const l = licitacaoDe(p);
          return `
          <tr>
            <td><strong>${esc(p.numero)}</strong></td>
            <td>${l ? `${esc(l.objeto.slice(0, 60))}…<br><span class="fraco">${esc(l.orgao)}</span>` : '—'}</td>
            <td>${fmt.data(p.criada)}</td>
            <td><select data-status="${esc(p.id)}" aria-label="Situação da proposta ${esc(p.numero)}" style="min-width:140px">${LH.opcoes(STATUS, p.status)}</select></td>
            <td class="numero">${p.total ? fmt.moeda(p.total) : '—'}</td>
            <td style="white-space:nowrap">
              <a class="btn btn--pequeno" href="#/proposta/criar?id=${encodeURIComponent(p.id)}">${icone('lapis')} Abrir</a>
              <button class="btn-icone btn-icone--pequeno" type="button" data-duplicar="${esc(p.id)}" aria-label="Duplicar">${icone('copiar')}</button>
              <button class="btn-icone btn-icone--pequeno" type="button" data-excluir="${esc(p.id)}" aria-label="Excluir">${icone('lixeira')}</button>
            </td>
          </tr>`;
        }).join('') : `<tr><td colspan="6">${LH.vazio('arquivo', 'Nenhuma proposta ainda', '', '<a class="btn btn--primario" href="#/proposta/criar">Criar a primeira</a>')}</td></tr>`;
      };
      const achar = (id) => lista.find((p) => String(p.id) === id);
      LH.ao(raiz, 'change', '[data-status]', async (e, s) => {
        try {
          await LH.repo.salvarProposta({ ...achar(s.dataset.status), status: s.value });
          LH.aviso('Situação atualizada.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-duplicar]', async (e, b) => {
        try {
          const original = achar(b.dataset.duplicar);
          await LH.repo.salvarProposta({ ...original, id: undefined, numero: await LH.repo.proximoNumeroProposta(), status: 'Rascunho', criada: undefined });
          LH.aviso('Proposta duplicada.', 'sucesso');
          desenhar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-excluir]', async (e, b) => {
        if (!(await LH.confirmar('Excluir proposta', 'A proposta será apagada.', 'Excluir', true))) return;
        try {
          await LH.repo.removerProposta(b.dataset.excluir);
          desenhar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      desenhar();
    },
  };

  // --- Gerador de declarações ---------------------------------------------------------
  const PORTES = { ME: 'microempresa', EPP: 'empresa de pequeno porte' };
  const MODELOS = [
    {
      id: 'habilitacao', titulo: 'Cumprimento dos requisitos de habilitação', ref: 'Art. 63, I, da Lei nº 14.133/2021',
      texto: (d) => `DECLARA, para fins de participação no(a) ${d.edital}, promovido(a) pelo(a) ${d.orgao}, que cumpre plenamente os requisitos de habilitação exigidos no edital, respondendo pela veracidade das informações prestadas, na forma da lei.`,
    },
    {
      id: 'menor', titulo: 'Não emprega menor (art. 7º, XXXIII, da Constituição)', ref: 'Art. 68, VI, da Lei nº 14.133/2021',
      texto: () => 'DECLARA que não emprega menor de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 (dezesseis) anos, salvo a partir de 14 (quatorze) anos, na condição de aprendiz, nos termos do art. 7º, XXXIII, da Constituição Federal.',
    },
    {
      id: 'reserva', titulo: 'Reserva de cargos para PcD e reabilitados', ref: 'Art. 63, IV, da Lei nº 14.133/2021',
      texto: () => 'DECLARA que cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas.',
    },
    {
      id: 'custos', titulo: 'Proposta compreende todos os custos trabalhistas', ref: 'Art. 63, § 1º, da Lei nº 14.133/2021',
      texto: () => 'DECLARA que sua proposta econômica compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na data de entrega das propostas.',
    },
    {
      id: 'meepp', titulo: 'Enquadramento como ME/EPP', ref: 'LC nº 123/2006 e art. 4º da Lei nº 14.133/2021',
      texto: (d) => `DECLARA, sob as penas da lei, que se enquadra como ${PORTES[d.porte] || 'microempresa ou empresa de pequeno porte'}, nos termos do art. 3º da Lei Complementar nº 123/2006, estando apta a usufruir do tratamento favorecido previsto em seus arts. 42 a 49, conforme o art. 4º da Lei nº 14.133/2021, e que não se enquadra em nenhuma das vedações do § 4º do art. 3º da mesma Lei Complementar.`,
    },
    {
      id: 'impeditivo', titulo: 'Inexistência de fato impeditivo', ref: 'Art. 14 da Lei nº 14.133/2021',
      texto: (d) => `DECLARA, sob as penas da lei, que não existem fatos impeditivos à sua participação no(a) ${d.edital}, não estando incursa em nenhuma das vedações do art. 14 da Lei nº 14.133/2021, e que se compromete a informar a ocorrência de qualquer fato superveniente.`,
    },
  ];

  LH.vistas.declaracoes = {
    titulo: 'Gerador de declarações',
    render: () => {
      const e = empresa();
      return `
      ${LH.cabecalho({
        titulo: 'Gerador de declarações',
        texto: 'Modelos de declaração conforme a Lei nº 14.133/2021, preenchidos com os dados da sua empresa.',
      })}
      <div class="grade grade--lateral">
        <section class="grade" style="align-content:start">
          <div class="card spot" data-reveal>
            <div class="card__titulo"><h2>${icone('arquivoCheck')} Modelo</h2></div>
            <div class="lista" role="radiogroup" aria-label="Modelo de declaração">
              ${MODELOS.map((m, i) => `
                <label class="lista__item" style="cursor:pointer">
                  <input type="radio" name="modelo" value="${m.id}" ${i ? '' : 'checked'} style="accent-color:var(--azul)">
                  <span class="lista__texto"><strong style="white-space:normal">${esc(m.titulo)}</strong><span>${esc(m.ref)}</span></span>
                </label>`).join('')}
            </div>
          </div>
        </section>
        <form class="card spot form" id="form-decl" data-reveal autocomplete="off">
          <div class="card__titulo"><h2>${icone('lapis')} Dados</h2></div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Razão social</span><input name="razao" value="${esc(e.razao)}"></label>
            <label class="campo"><span class="campo__rotulo">CNPJ</span><input name="cnpj" value="${esc(e.cnpj ? LH.cnpj.mascara(e.cnpj) : '')}" placeholder="00.000.000/0000-00"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Representante legal</span><input name="rep" value="${esc(e.representante)}"></label>
            <label class="campo"><span class="campo__rotulo">CPF do representante</span><input name="cpf" value="${esc(e.cpfRepresentante)}"></label>
            <label class="campo"><span class="campo__rotulo">Cargo</span><input name="cargo" value="${esc(e.cargo)}"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Órgão</span><input name="orgao" placeholder="ex.: Prefeitura Municipal de Campinas"></label>
            <label class="campo"><span class="campo__rotulo">Licitação</span><input name="edital" placeholder="ex.: Pregão Eletrônico nº 90010/2026"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Cidade</span><input name="cidade" value="${esc(e.cidade)}"></label>
            <label class="campo"><span class="campo__rotulo">Data</span><input type="date" name="data" value="${LH.datas.hoje()}"></label>
            <label class="campo"><span class="campo__rotulo">Porte</span><select name="porte">${LH.opcoes([['ME', 'Microempresa (ME)'], ['EPP', 'Empresa de pequeno porte (EPP)'], ['Demais', 'Demais']], e.porte)}</select></label>
          </div>
          <div class="card__rodape">
            <button class="btn" type="button" data-acao="copiar">${icone('copiar')} Copiar texto</button>
            <button class="btn btn--primario" type="button" data-acao="imprimir">${icone('impressora')} Imprimir / PDF</button>
          </div>
        </form>
      </div>
      <p class="nota nao-imprimir" data-reveal style="margin-top:18px">${icone('info')} Modelos de referência. Se o edital trouxer um modelo próprio, use o do edital.</p>
      <section class="area-impressao" id="decl-previa" style="margin-top:18px"></section>`;
    },
    montar(raiz) {
      const form = raiz.querySelector('#form-decl');
      const dados = () => {
        const d = Object.fromEntries(new FormData(form));
        const ou = (v, alt) => (String(v || '').trim() ? String(v).trim() : alt);
        return {
          razao: ou(d.razao, '[RAZÃO SOCIAL]'), cnpj: ou(d.cnpj, '[CNPJ]'), rep: ou(d.rep, '[REPRESENTANTE LEGAL]'),
          cpf: ou(d.cpf, '[CPF]'), cargo: ou(d.cargo, '[CARGO]'), orgao: ou(d.orgao, '[ÓRGÃO]'),
          edital: ou(d.edital, '[LICITAÇÃO]'), cidade: ou(d.cidade, '[CIDADE]'), data: d.data || LH.datas.hoje(), porte: d.porte,
        };
      };
      const modelo = () => MODELOS.find((m) => m.id === raiz.querySelector('[name=modelo]:checked').value);
      const textoPuro = () => {
        const d = dados();
        const m = modelo();
        return `DECLARAÇÃO — ${m.titulo.toUpperCase()}\n(${m.ref})\n\n${d.orgao}\nRef.: ${d.edital}\n\n`
          + `A empresa ${d.razao}, inscrita no CNPJ sob o nº ${d.cnpj}, por intermédio de seu representante legal, ${d.rep}, CPF nº ${d.cpf}, ${m.texto(d)}\n\n`
          + `${d.cidade}, ${fmt.dataLonga(d.data)}.\n\n______________________________\n${d.rep}\n${d.cargo} · ${d.razao}`;
      };
      const desenhar = () => {
        const d = dados();
        const m = modelo();
        raiz.querySelector('#decl-previa').innerHTML = `
          <div class="folha">
            <h2>DECLARAÇÃO</h2>
            <p class="fraco" style="text-align:center">${esc(m.titulo)} · ${esc(m.ref)}</p>
            <p style="margin-top:18px">Ao(À) <strong>${esc(d.orgao)}</strong><br>Ref.: ${esc(d.edital)}</p>
            <p style="margin-top:18px;text-align:justify">A empresa <strong>${esc(d.razao)}</strong>, inscrita no CNPJ sob o nº ${esc(d.cnpj)}, por intermédio de seu representante legal, ${esc(d.rep)}, CPF nº ${esc(d.cpf)}, ${esc(m.texto(d))}</p>
            <p style="margin-top:18px">${esc(d.cidade)}, ${esc(fmt.dataLonga(d.data))}.</p>
            <div class="folha__assinatura"><span></span>${esc(d.rep)}<br>${esc(d.cargo)} · ${esc(d.razao)}</div>
          </div>`;
      };
      raiz.addEventListener('input', desenhar);
      raiz.addEventListener('change', desenhar);
      LH.ao(raiz, 'click', '[data-acao]', async (e, b) => {
        if (b.dataset.acao === 'imprimir') { desenhar(); window.print(); }
        if (b.dataset.acao === 'copiar') {
          try { await navigator.clipboard.writeText(textoPuro()); LH.aviso('Texto copiado.', 'sucesso'); } catch { LH.aviso('Não consegui copiar. Selecione o texto da prévia.', 'alerta'); }
        }
      });
      desenhar();
    },
  };
})();
