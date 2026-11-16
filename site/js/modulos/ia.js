/* =============================================================================
   LicitaHub · Funções com IA
   Leitor de Edital IA (no modo real: POST /api/editais/analisar e acompanhamento
   até concluir), Dossiê Jurídico IA e Cotação Online IA (Beta).
   O resultado do Leitor segue o formato da análise real do servidor (src/ia).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const dois = (n) => String(n).padStart(2, '0');

  /** Gerador de números "aleatórios" que se repetem para o mesmo texto. */
  LH.aleatorioDe = (texto) => {
    let h = 2166136261;
    for (const c of String(texto)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    let s = h >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** Mostra as etapas do trabalho da IA, uma a uma. */
  async function rodarEtapas(caixa, etapas, ms = 650) {
    for (let i = 0; i <= etapas.length; i++) {
      caixa.innerHTML = listaEtapas(etapas, i);
      if (i < etapas.length) await espera(ms);
    }
  }
  const listaEtapas = (etapas, atual) => `<ul class="etapas-ia">${etapas.map((t, j) => {
    const estado = j < atual ? 'feito' : j === atual ? 'agora' : '';
    const ic = j < atual ? icone('checkCirculo') : j === atual ? icone('atualizar', 'girando') : icone('relogio');
    return `<li class="${estado}">${ic}${esc(t)}</li>`;
  }).join('')}</ul>`;

  const avisoIa = `<p class="nota nota--alerta">${icone('alerta')} A IA ajuda na leitura, mas pode errar. Confira sempre no edital original: a responsabilidade final pela proposta é sua.</p>`;

  /** Opções de licitação do usuário (CRM + favoritas) para os seletores. */
  async function preencherLicitacoes(select, idPedido) {
    try {
      let lista = await LH.repo.licitacoesDoUsuario();
      if (idPedido && !lista.some((l) => l.id === Number(idPedido))) lista = [...(await LH.repo.licitacoes([idPedido])), ...lista];
      select.innerHTML = LH.opcoes(lista.map((l) => [l.id, `${l.numero} · ${l.objeto.slice(0, 64)}`]), idPedido || '',
        lista.length ? 'Escolha a licitação' : 'Nenhuma ainda: favorite ou acompanhe uma licitação');
      return new Map(lista.map((l) => [l.id, l]));
    } catch (e) {
      select.innerHTML = '<option value="">Não consegui carregar as licitações</option>';
      LH.aviso(e.message, 'alerta');
      return new Map();
    }
  }

  // --- Leitor de Edital IA -----------------------------------------------------------
  /** Exemplo da demonstração, no mesmo formato da análise real. */
  function analiseExemplo(l) {
    const abertura = l?.abertura || LH.datas.somar(7);
    const quando = (iso, hora = '09:00') => `${iso}T${hora}:00-03:00`;
    const item = (descricao, referencia) => ({ descricao, obrigatorio: true, observacao: null, referencia });
    return {
      identificacao: {
        objeto: l ? l.objeto : 'Objeto conforme o edital enviado', orgao: l ? l.orgao : 'Órgão licitante',
        numero_edital: l ? `${l.modalidade} nº ${l.numero}` : '—', numero_processo: null,
        modalidade: l ? l.modalidade : 'Pregão Eletrônico', criterio_julgamento: 'Menor preço por item', modo_disputa: 'Aberto',
        plataforma_disputa: l ? l.plataforma : 'Compras.gov.br', valor_estimado: l?.valor ? fmt.moeda(l.valor) : null,
        registro_de_precos: false, exclusivo_me_epp: Boolean(l?.me_epp), permite_consorcio: null, vigencia_contrato: '12 meses, prorrogável',
      },
      resumo: `Licitação para ${l ? l.objeto.charAt(0).toLowerCase() + l.objeto.slice(1) : 'o objeto descrito no edital'}. A disputa é eletrônica, com julgamento pelo menor preço por item.`,
      prazos: [
        { evento: 'Pedido de esclarecimento ou impugnação', data_hora_texto: 'Até 3 dias úteis antes da sessão', data_hora_iso: quando(LH.datas.somar(Math.max(0, LH.datas.diasAte(abertura) - 3)), '23:59'), referencia: 'item 4.1' },
        { evento: 'Sessão pública', data_hora_texto: `${fmt.data(abertura)}, ${l?.hora || '09:00'}`, data_hora_iso: quando(abertura, l?.hora || '09:00'), referencia: 'preâmbulo' },
        { evento: 'Envio da proposta ajustada', data_hora_texto: 'Em até 2 horas após a convocação', data_hora_iso: null, referencia: 'item 8.3' },
      ],
      habilitacao: {
        juridica: [item('Ato constitutivo (contrato social) e alterações', 'item 9.2')],
        fiscal_social_trabalhista: [item('CND Federal (Receita/PGFN)', 'item 9.3'), item('Certificado de Regularidade do FGTS', 'item 9.3'), item('CNDT (trabalhista)', 'item 9.3')],
        economico_financeira: [item('Certidão de falência e recuperação judicial', 'item 9.4')],
        tecnica: [item('Atestado de capacidade técnica compatível com o objeto', 'item 9.5')],
        outras: [],
      },
      documentos_obrigatorios: [{ documento: 'Proposta cadastrada no sistema, com marca e preço', fase: 'proposta', observacao: 'Antes da abertura da sessão', referencia: 'item 6.1' }],
      proposta: { requisitos: [item('Validade mínima de 60 dias', 'item 7.2')], validade_minima_dias: 60, exige_amostra_ou_prova_de_conceito: true, garantia_proposta: null },
      garantia_contratual: 'Não exigida.',
      penalidades: [{ descricao: 'Multa de 0,5% por dia de atraso, limitada a 10% do contrato.', referencia: 'item 18.2' }],
      riscos: [
        { titulo: 'Prazo de entrega diferente entre documentos', severidade: 'alta', categoria: 'prazo', descricao: 'O Termo de Referência fala em 30 dias para entrega, mas o edital fala em 7 dias.', recomendacao: 'Peça esclarecimento antes de montar a proposta.', referencia: 'TR 5.2 × edital 12.1' },
        { titulo: 'Amostra exigida em prazo curto', severidade: 'media', categoria: 'proposta', descricao: 'O primeiro colocado pode ter de entregar amostra em até 3 dias úteis.', recomendacao: 'Separe a amostra antes da sessão.', referencia: 'item 9.4' },
      ],
      pontos_para_esclarecimento: [{ ponto: 'Qual é o prazo de entrega que vale: 30 ou 7 dias?', motivo: 'Os documentos se contradizem.', referencia: 'TR 5.2 × edital 12.1' }],
      informacoes_nao_encontradas: ['Endereço para entrega das amostras.'],
      confianca: 'alta',
      aviso_legal: 'Análise gerada automaticamente por inteligência artificial. Confira sempre no edital original.',
    };
  }

  const simNao = (v) => (v === true ? 'Sim' : v === false ? 'Não' : 'Não informado');
  const texto = (v) => (v == null || v === '' ? 'Não informado' : String(v));
  const quandoTexto = (p) => {
    if (!p.data_hora_iso) return esc(p.data_hora_texto || 'Não informado');
    const d = new Date(p.data_hora_iso);
    if (Number.isNaN(d.getTime())) return esc(p.data_hora_texto || '');
    const iso = LH.datas.paraIso(d);
    return `${fmt.data(iso)} às ${dois(d.getHours())}:${dois(d.getMinutes())} <span class="fraco">(${fmt.relativo(iso)})</span>`;
  };
  const GRUPOS = { juridica: 'Jurídica', fiscal_social_trabalhista: 'Fiscal, social e trabalhista', economico_financeira: 'Econômico-financeira', tecnica: 'Técnica', outras: 'Outras' };
  const itemTexto = (i) => (typeof i === 'string' ? esc(i)
    : `${esc(i.descricao || i.documento || '')}${i.obrigatorio === false ? ' <span class="selo">opcional</span>' : ''}${i.observacao ? `<br><span class="fraco">${esc(i.observacao)}</span>` : ''}${i.referencia ? ` <span class="ref">(${esc(i.referencia)})</span>` : ''}`);

  /** Desenha o resultado de uma análise (formato do servidor). */
  function resultadoLeitor(a, l) {
    const id = a.identificacao || {};
    const sev = { alta: 'selo--perigo', media: 'selo--alerta', média: 'selo--alerta', baixa: 'selo--info' };
    const habil = Object.entries(a.habilitacao || {}).filter(([, itens]) => Array.isArray(itens) && itens.length);
    return `
      <div class="resultado-ia">
        <div class="card__titulo" style="margin:0">
          <h2>${icone('brilho')} Resultado da leitura</h2>
          <span class="selo selo--sucesso">${icone('escudo')} Confiança ${esc(a.confianca || 'não informada')}</span>
        </div>
        <section><h3>${icone('info')} Identificação</h3>
          <dl class="ficha">
            ${[['Objeto', texto(id.objeto)], ['Órgão', texto(id.orgao)], ['Edital', texto(id.numero_edital)], ['Processo', texto(id.numero_processo)],
              ['Modalidade', texto(id.modalidade)], ['Critério', texto(id.criterio_julgamento)], ['Disputa', [id.modo_disputa, id.plataforma_disputa].filter(Boolean).join(' · ') || 'Não informado'],
              ['Valor estimado', texto(id.valor_estimado)], ['Registro de preços', simNao(id.registro_de_precos)], ['Exclusivo ME/EPP', simNao(id.exclusivo_me_epp)],
              ['Consórcio', simNao(id.permite_consorcio)], ['Vigência', texto(id.vigencia_contrato)]]
              .map(([t, v]) => `<div><dt>${t}</dt><dd>${esc(v)}</dd></div>`).join('')}
          </dl></section>
        ${a.resumo ? `<section><h3>${icone('arquivo')} Resumo</h3><p class="suave">${esc(a.resumo)}</p></section>` : ''}
        ${a.prazos?.length ? `<section><h3>${icone('calendario')} Prazos</h3>
          <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Evento</th><th>Quando</th><th>Onde está</th></tr></thead><tbody>
            ${a.prazos.map((p) => `<tr><td>${esc(p.evento)}</td><td>${quandoTexto(p)}</td><td class="fraco">${esc(p.referencia || '')}</td></tr>`).join('')}
          </tbody></table></div></section>` : ''}
        ${habil.length ? `<section><h3>${icone('arquivoCheck')} Documentos de habilitação</h3>
          <div class="grade grade--2">${habil.map(([grupo, itens]) => `
            <div class="card card--compacto"><strong>${esc(GRUPOS[grupo] || grupo)}</strong>
              <ul style="margin:8px 0 0 18px;display:grid;gap:6px" class="suave">${itens.map((i) => `<li>${itemTexto(i)}</li>`).join('')}</ul></div>`).join('')}
          </div></section>` : ''}
        ${a.documentos_obrigatorios?.length ? `<section><h3>${icone('pasta')} Documentos a enviar</h3>
          <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>Documento</th><th>Fase</th><th>Observação</th></tr></thead><tbody>
            ${a.documentos_obrigatorios.map((d) => `<tr><td>${esc(d.documento)} ${d.referencia ? `<span class="ref">(${esc(d.referencia)})</span>` : ''}</td><td>${esc(d.fase || '')}</td><td class="fraco">${esc(d.observacao || '')}</td></tr>`).join('')}
          </tbody></table></div></section>` : ''}
        ${a.proposta ? `<section><h3>${icone('etiqueta')} Proposta</h3>
          <dl class="ficha">
            <div><dt>Validade mínima</dt><dd>${a.proposta.validade_minima_dias ? `${esc(a.proposta.validade_minima_dias)} dias` : 'Não informada'}</dd></div>
            <div><dt>Amostra ou prova de conceito</dt><dd>${simNao(a.proposta.exige_amostra_ou_prova_de_conceito)}</dd></div>
            <div><dt>Garantia da proposta</dt><dd>${esc(texto(a.proposta.garantia_proposta))}</dd></div>
            <div><dt>Garantia do contrato</dt><dd>${esc(texto(a.garantia_contratual))}</dd></div>
          </dl>
          ${a.proposta.requisitos?.length ? `<ul style="margin:10px 0 0 18px;display:grid;gap:6px" class="suave">${a.proposta.requisitos.map((i) => `<li>${itemTexto(i)}</li>`).join('')}</ul>` : ''}
        </section>` : ''}
        ${a.riscos?.length ? `<section><h3>${icone('alerta')} Riscos e pontos de atenção</h3>
          <div class="grade">${a.riscos.map((r) => `
            <div class="risco risco--${esc(String(r.severidade || 'baixa').replace('é', 'e'))}">
              <strong>${esc(r.titulo)} <span class="selo ${sev[r.severidade] || 'selo--info'}">${esc(r.severidade || '')}</span></strong>
              <p>${esc(r.descricao || '')}</p>${r.recomendacao ? `<p><strong>O que fazer:</strong> ${esc(r.recomendacao)}</p>` : ''}<span class="ref">${esc(r.referencia || '')}</span>
            </div>`).join('')}</div></section>` : ''}
        ${a.pontos_para_esclarecimento?.length ? `<section><h3>${icone('ajuda')} Pontos para pedir esclarecimento</h3>
          <ul class="lista">${a.pontos_para_esclarecimento.map((p) => `
            <li class="lista__item"><span class="lista__icone">${icone('ajuda')}</span><div class="lista__texto"><strong style="white-space:normal">${esc(p.ponto)}</strong><span>${esc(p.motivo || '')}</span></div></li>`).join('')}</ul></section>` : ''}
        ${a.penalidades?.length ? `<section><h3>${icone('balanca')} Penalidades</h3>
          <ul style="margin-left:18px;display:grid;gap:6px" class="suave">${a.penalidades.map((p) => `<li>${itemTexto(p)}</li>`).join('')}</ul></section>` : ''}
        ${a.informacoes_nao_encontradas?.length ? `<section><h3>${icone('busca')} Não encontrado no edital</h3>
          <ul style="margin-left:18px;display:grid;gap:6px" class="suave">${a.informacoes_nao_encontradas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
        ${avisoIa}
        ${l ? `<div class="card__rodape" style="margin-top:0">
          <button class="btn" type="button" data-acao="crm" data-id="${l.id}">${icone('kanban')} Acompanhar no CRM</button>
          <a class="btn" href="#/proposta/criar?licitacao=${l.id}">${icone('arquivo')} Gerar proposta</a>
          <a class="btn btn--primario" href="#/ia/dossie?tipo=esclarecimento&id=${l.id}">${icone('balanca')} Pedir esclarecimento</a>
        </div>` : ''}
      </div>`;
  }

  LH.vistas['ia/leitor'] = {
    titulo: 'Leitor de Edital IA',
    trilha: 'Funções com IA',
    render: (p) => `
      ${LH.cabecalho({
        titulo: 'Leitor de Edital IA',
        texto: 'Envie o PDF do edital ou escolha uma licitação: a IA extrai prazos, exigências de habilitação, riscos e divergências.',
        acoes: '<span class="selo selo--info" id="uso-ia">Leituras deste mês: …</span>',
      })}
      <div class="grade grade--lateral">
        <section class="card spot" data-reveal>
          <div class="card__titulo"><h2>${icone('enviar')} Edital</h2></div>
          <div class="form">
            <label class="soltar" id="soltar">
              ${icone('enviar')}
              <span><strong>Arraste o PDF do edital aqui</strong><br>ou clique para escolher (até 20 MB)</span>
              <span class="fraco" id="arquivo-nome">Nenhum arquivo escolhido</span>
              <input type="file" accept="application/pdf" hidden id="arquivo">
            </label>
            <label class="campo"><span class="campo__rotulo">Ou escolha uma licitação (favoritas e CRM)</span>
              <select id="licitacao"><option>Carregando...</option></select></label>
            <button class="btn btn--primario btn--grande" type="button" id="analisar">${icone('brilho')} Analisar edital</button>
          </div>
        </section>
        <aside class="card card--vidro" data-reveal style="align-self:start;padding:22px">
          <h2 style="font-size:1rem;margin-bottom:10px">Leituras recentes</h2>
          <ul class="lista" id="historico">${LH.carregando()}</ul>
          <p class="fraco" style="margin-top:12px">A leitura de um edital grande leva 1 a 2 minutos. Pode navegar à vontade: o resultado fica salvo aqui.</p>
        </aside>
      </div>
      <section class="card" id="saida-leitor" style="margin-top:18px" hidden></section>`,
    montar(raiz, p) {
      const entrada = raiz.querySelector('#arquivo');
      const soltar = raiz.querySelector('#soltar');
      const saida = raiz.querySelector('#saida-leitor');
      const select = raiz.querySelector('#licitacao');
      let arquivo = null;
      let licitacoes = new Map();
      let ativo = true; // para de acompanhar se a pessoa sair da tela

      const mostrarResultado = (resultado, l) => {
        saida.hidden = false;
        saida.innerHTML = resultadoLeitor(resultado, l);
      };
      const atualizarUso = () => LH.repo.usoIa().then(({ usadas, limite }) => {
        raiz.querySelector('#uso-ia').textContent = `Leituras deste mês: ${usadas} de ${limite}`;
      }).catch(() => {});
      const atualizarHistorico = async () => {
        const caixa = raiz.querySelector('#historico');
        try {
          const lista = await LH.repo.historico();
          const nomes = { pendente: 'Na fila', processando: 'Lendo', concluida: 'Pronta', erro: 'Erro' };
          const cls = { concluida: 'selo--sucesso', erro: 'selo--perigo', processando: 'selo--info', pendente: '' };
          caixa.innerHTML = lista.length ? lista.map((a) => `
            <li><button type="button" class="lista__item" data-analise="${esc(a.id)}" style="width:100%;text-align:left;color:inherit">
              <span class="lista__texto"><strong>${esc(a.titulo)}</strong><span>${new Date(a.criado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></span>
              <span class="selo ${cls[a.status]}">${nomes[a.status] || esc(a.status)}</span></button></li>`).join('')
            : `<li class="fraco">${LH.repo.modo === 'demo' ? 'Na demonstração as leituras não ficam salvas.' : 'Nenhuma leitura ainda.'}</li>`;
        } catch (e) { caixa.innerHTML = `<li>${LH.erroHtml(e)}</li>`; }
      };

      /** Acompanha uma análise do servidor até terminar. */
      const acompanhar = async (id, l) => {
        const inicio = Date.now();
        const etapas = ['Na fila', 'A IA está lendo o edital', 'Organizando prazos, exigências e riscos'];
        saida.hidden = false;
        while (ativo) {
          const a = await LH.repo.analise(id);
          if (a.status === 'concluida') {
            mostrarResultado(a.resultado, l);
            LH.aviso('Leitura do edital concluída.', 'sucesso');
            break;
          }
          if (a.status === 'erro') {
            saida.innerHTML = LH.erroHtml(a.erro || 'A leitura falhou. Tente de novo.');
            break;
          }
          const s = Math.round((Date.now() - inicio) / 1000);
          saida.innerHTML = `${listaEtapas(etapas, a.status === 'pendente' ? 0 : s > 50 ? 2 : 1)}<p class="fraco">${s} s · pode navegar, o resultado fica em "Leituras recentes".</p>`;
          await espera(3000);
        }
        atualizarHistorico();
        atualizarUso();
      };

      const escolher = (f) => {
        if (!f) return;
        if (f.type !== 'application/pdf') return LH.aviso('Envie um arquivo PDF.', 'alerta');
        if (f.size > 20 * 1024 * 1024) return LH.aviso('O PDF passa de 20 MB.', 'alerta');
        arquivo = f;
        raiz.querySelector('#arquivo-nome').textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
        select.value = '';
      };
      entrada.addEventListener('change', () => escolher(entrada.files[0]));
      ['dragenter', 'dragover'].forEach((t) => soltar.addEventListener(t, (e) => { e.preventDefault(); soltar.classList.add('arrastando'); }));
      ['dragleave', 'drop'].forEach((t) => soltar.addEventListener(t, (e) => { e.preventDefault(); soltar.classList.remove('arrastando'); }));
      soltar.addEventListener('drop', (e) => escolher(e.dataTransfer.files[0]));
      select.addEventListener('change', () => {
        if (!select.value) return;
        arquivo = null;
        entrada.value = '';
        raiz.querySelector('#arquivo-nome').textContent = 'Nenhum arquivo escolhido';
      });

      raiz.querySelector('#analisar').addEventListener('click', async (e) => {
        const botao = e.currentTarget;
        const l = licitacoes.get(Number(select.value)) || null;
        if (!arquivo && !l) return LH.aviso('Envie o PDF ou escolha uma licitação.', 'alerta');
        botao.disabled = true;
        saida.hidden = false;
        saida.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try {
          if (LH.repo.modo === 'demo') {
            await rodarEtapas(saida, [arquivo ? `Lendo ${arquivo.name}` : 'Baixando o edital no PNCP', 'Identificando o objeto, a modalidade e o órgão',
              'Extraindo prazos e datas da sessão', 'Listando documentos de habilitação', 'Procurando riscos e divergências']);
            mostrarResultado(analiseExemplo(l), l);
          } else {
            saida.innerHTML = LH.carregando(arquivo ? 'Enviando o PDF...' : 'Pedindo a leitura do edital no PNCP...');
            const { id } = await LH.repo.analisar({ licitacaoId: l?.id, arquivo });
            atualizarHistorico();
            await acompanhar(id, l);
          }
        } catch (erro) {
          saida.innerHTML = LH.erroHtml(erro.codigo === 'cota_esgotada' ? `${erro.message} Assine o plano Completo para ter 30 leituras por mês.` : erro);
        }
        botao.disabled = false;
      });
      LH.ao(raiz, 'click', '[data-analise]', async (e, b) => {
        saida.hidden = false;
        saida.innerHTML = LH.carregando('Abrindo a leitura...');
        try {
          const a = await LH.repo.analise(b.dataset.analise);
          if (a.status === 'concluida') mostrarResultado(a.resultado, LH.licitacaoEmCache(a.licitacao_id) || null);
          else if (a.status === 'erro') saida.innerHTML = LH.erroHtml(a.erro || 'Esta leitura falhou.');
          else await acompanhar(a.id, null);
          saida.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (erro) { saida.innerHTML = LH.erroHtml(erro); }
      });
      LH.ao(saida, 'click', '[data-acao="crm"]', (e, b) => LH.enviarParaCrm(b.dataset.id));

      preencherLicitacoes(select, p.id).then((mapa) => { licitacoes = mapa; });
      atualizarHistorico();
      atualizarUso();
      return () => { ativo = false; };
    },
  };

  // --- Dossiê Jurídico IA ------------------------------------------------------------
  const PECAS = {
    esclarecimento: {
      nome: 'Pedido de esclarecimento',
      prazo: 'Até 3 dias úteis antes da data de abertura do certame (art. 164 da Lei nº 14.133/2021).',
      base: 'O art. 164 da Lei nº 14.133/2021 garante a qualquer pessoa o direito de solicitar esclarecimento sobre os termos do edital, e a resposta deve ser divulgada em sítio eletrônico oficial no prazo de até 3 dias úteis, limitado ao último dia útil anterior à abertura do certame (parágrafo único).',
      pedido: 'Requer-se o esclarecimento dos pontos acima, com a divulgação da resposta a todos os interessados.',
    },
    impugnacao: {
      nome: 'Impugnação ao edital',
      prazo: 'Até 3 dias úteis antes da data de abertura do certame (art. 164 da Lei nº 14.133/2021).',
      base: 'Nos termos do art. 164 da Lei nº 14.133/2021, qualquer pessoa é parte legítima para impugnar edital de licitação por irregularidade na aplicação da Lei. A exigência apontada restringe a competitividade, em afronta aos princípios do art. 5º da mesma Lei, entre eles o da competitividade e o da igualdade.',
      pedido: 'Requer-se o acolhimento da impugnação, com a correção do edital e a republicação com a reabertura do prazo, quando a alteração afetar a formulação das propostas.',
    },
    recurso: {
      nome: 'Recurso administrativo',
      prazo: '3 dias úteis contados da intimação ou da lavratura da ata (art. 165, I, da Lei nº 14.133/2021).',
      base: 'O art. 165, I, da Lei nº 14.133/2021 prevê recurso contra o julgamento das propostas e o ato de habilitação ou inabilitação. A decisão recorrida não observou o disposto no edital e o princípio do julgamento objetivo (art. 5º).',
      pedido: 'Requer-se o conhecimento e o provimento do recurso, com a reforma da decisão, ou, caso mantida, o encaminhamento à autoridade superior.',
    },
    contrarrazoes: {
      nome: 'Contrarrazões',
      prazo: 'Mesmo prazo do recurso, contado da intimação ou divulgação da interposição (art. 165, § 4º, da Lei nº 14.133/2021).',
      base: 'Conforme o art. 165, § 4º, da Lei nº 14.133/2021, o prazo para contrarrazões é o mesmo do recurso. A decisão recorrida está de acordo com o edital e com o princípio da vinculação ao edital (art. 5º).',
      pedido: 'Requer-se o não provimento do recurso, com a manutenção da decisão recorrida.',
    },
  };

  LH.vistas['ia/dossie'] = {
    titulo: 'Dossiê Jurídico IA',
    trilha: 'Funções com IA',
    render: (p) => `
      ${LH.cabecalho({
        titulo: 'Dossiê Jurídico IA',
        texto: 'Monte rascunhos de esclarecimento, impugnação, recurso e contrarrazões com base na Lei nº 14.133/2021.',
      })}
      <div class="grade grade--lateral">
        <form class="card spot form" id="form-dossie" data-reveal>
          <div class="card__titulo"><h2>${icone('balanca')} Pedido</h2></div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Tipo de documento</span>
              <select name="tipo">${LH.opcoes(Object.entries(PECAS).map(([k, v]) => [k, v.nome]), p.tipo || 'esclarecimento')}</select></label>
            <label class="campo"><span class="campo__rotulo">Licitação</span>
              <select name="licitacao" required><option value="">Carregando...</option></select></label>
          </div>
          <label class="campo"><span class="campo__rotulo">Descreva a situação</span>
            <textarea name="fatos" required placeholder="ex.: O edital exige atestado de 100% do quantitativo, o que restringe a participação..."></textarea></label>
          <button class="btn btn--primario" type="submit">${icone('brilho')} Gerar rascunho</button>
        </form>
        <aside class="card card--vidro" data-reveal style="align-self:start;padding:22px">
          <h2 style="font-size:1rem;margin-bottom:10px">Prazo</h2>
          <p class="suave" id="prazo-peca"></p>
          <p class="fraco" style="margin-top:12px">Rascunho para revisão. Antes de protocolar, confira com um advogado.</p>
        </aside>
      </div>
      <section class="card" id="saida-dossie" style="margin-top:18px" hidden></section>`,
    montar(raiz, p) {
      const form = raiz.querySelector('#form-dossie');
      const saida = raiz.querySelector('#saida-dossie');
      let licitacoes = new Map();
      const mostrarPrazo = () => { raiz.querySelector('#prazo-peca').textContent = PECAS[form.tipo.value].prazo; };
      form.tipo.addEventListener('change', mostrarPrazo);
      mostrarPrazo();
      preencherLicitacoes(form.licitacao, p.id).then((mapa) => { licitacoes = mapa; });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const peca = PECAS[form.tipo.value];
        const l = licitacoes.get(Number(form.licitacao.value));
        if (!l) return LH.aviso('Escolha a licitação.', 'alerta');
        const emp = LH.repo.empresaPerfil();
        saida.hidden = false;
        await rodarEtapas(saida, ['Lendo a licitação e a sua descrição', 'Buscando a base legal na Lei nº 14.133/2021', 'Escrevendo o rascunho'], 600);
        const textoFinal = `AO(À) PREGOEIRO(A) / AGENTE DE CONTRATAÇÃO DO(A) ${l.orgao.toUpperCase()}\n\nRef.: ${l.modalidade} nº ${l.numero}\nObjeto: ${l.objeto}\n\n`
          + `${emp.razao || '[RAZÃO SOCIAL]'}, inscrita no CNPJ sob o nº ${emp.cnpj ? LH.cnpj.mascara(emp.cnpj) : '[CNPJ]'}, vem, respeitosamente, apresentar ${peca.nome.toUpperCase()}, pelos fatos e fundamentos a seguir.\n\n`
          + `I. DOS FATOS\n${form.fatos.value.trim()}\n\nII. DA FUNDAMENTAÇÃO\n${peca.base}\n\nIII. DO PEDIDO\n${peca.pedido}\n\n`
          + `Nestes termos, pede deferimento.\n\n${emp.cidade || '[CIDADE]'}, ${fmt.dataLonga(LH.datas.hoje())}.\n\n${emp.representante || '[REPRESENTANTE LEGAL]'}\n${emp.razao || ''}`;
        saida.innerHTML = `
          <div class="card__titulo"><h2>${icone('arquivo')} ${esc(peca.nome)} · rascunho</h2>
            <button class="btn btn--pequeno" type="button" data-copiar>${icone('copiar')} Copiar</button></div>
          <div class="documento-ia">${esc(textoFinal)}</div>
          <p class="nota nota--alerta" style="margin-top:16px">${icone('alerta')} Rascunho gerado a partir de modelos: revise os fatos, a fundamentação e o prazo antes de protocolar.</p>`;
        saida.querySelector('[data-copiar]').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(textoFinal); LH.aviso('Rascunho copiado.', 'sucesso'); } catch { LH.aviso('Não consegui copiar. Selecione o texto.', 'alerta'); }
        });
      });
    },
  };

  // --- Cotação Online IA (Beta) -------------------------------------------------------
  LH.vistas['ia/cotacao'] = {
    titulo: 'Cotação Online IA',
    trilha: 'Funções com IA',
    local: 'A Cotação Online ainda mostra cotações de exemplo: a busca real com fornecedores entra numa próxima etapa.',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Cotação Online IA <span class="selo selo--beta" style="vertical-align:middle">Beta</span>',
        texto: 'Descreva o item e a IA reúne cotações de fornecedores para você montar o preço da proposta.',
      })}
      <form class="card spot form" id="form-cotacao" data-reveal>
        <div class="form__linha">
          <label class="campo" style="grid-column:span 2"><span class="campo__rotulo">Item</span>
            <input name="item" required list="catalogo-cot" placeholder="ex.: Papel A4 75 g/m², resma com 500 folhas">
            <datalist id="catalogo-cot">${LH.dados.catalogo.filter((c) => c.tipo === 'produto').map((c) => `<option value="${esc(c.nome)}">`).join('')}</datalist></label>
          <label class="campo"><span class="campo__rotulo">Quantidade</span><input name="qtd" inputmode="numeric" value="100"></label>
          <label class="campo"><span class="campo__rotulo">UF de entrega</span><select name="uf">${LH.opcoes(LH.dados.UFS, 'SP')}</select></label>
        </div>
        <button class="btn btn--primario" type="submit" style="justify-self:start">${icone('brilho')} Buscar cotações</button>
      </form>
      <p class="nota" data-reveal style="margin-top:18px">${icone('info')} Beta com dados de exemplo. Na versão final, cada preço vem com a fonte e você confirma antes de usar.</p>
      <section class="card" id="saida-cotacao" style="margin-top:18px" hidden></section>`,
    montar(raiz) {
      const form = raiz.querySelector('#form-cotacao');
      const saida = raiz.querySelector('#saida-cotacao');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const item = form.item.value.trim();
        const qtd = Math.max(1, fmt.lerNumero(form.qtd.value));
        const ref = LH.dados.catalogo.find((c) => c.nome === item)?.base ?? 50;
        const sorte = LH.aleatorioDe(item + form.uf.value);
        saida.hidden = false;
        await rodarEtapas(saida, ['Entendendo a descrição do item', 'Consultando fornecedores', 'Comparando preço, frete e prazo'], 550);
        const cotacoes = Array.from({ length: 5 }, (_, i) => {
          const unit = ref * (0.82 + sorte() * 0.42);
          const frete = Math.round(sorte() * 180);
          return { nome: `Fornecedor exemplo ${String.fromCharCode(65 + i)}`, unit, frete, prazo: 3 + Math.round(sorte() * 12), total: unit * qtd + frete };
        }).sort((a, b) => a.total - b.total);
        const media = cotacoes.reduce((s, c) => s + c.unit, 0) / cotacoes.length;
        saida.innerHTML = `
          <div class="card__titulo"><h2>${icone('moeda')} ${cotacoes.length} cotações para ${esc(item)}</h2>
            <span class="selo selo--info">Média unitária ${fmt.moeda(media)}</span></div>
          <div class="tabela-rolagem"><table class="tabela">
            <thead><tr><th>Fornecedor</th><th class="numero">Unitário</th><th class="numero">Frete</th><th class="numero">Prazo</th><th class="numero">Total (${fmt.numero(qtd)} un.)</th></tr></thead>
            <tbody>${cotacoes.map((c, i) => `<tr><td>${esc(c.nome)} ${i === 0 ? '<span class="selo selo--sucesso">Melhor total</span>' : ''}</td>
              <td class="numero">${fmt.moeda(c.unit)}</td><td class="numero">${fmt.moeda(c.frete)}</td><td class="numero">${c.prazo} dias</td><td class="numero"><strong>${fmt.moeda(c.total)}</strong></td></tr>`).join('')}</tbody>
          </table></div>`;
      });
    },
  };
})();
