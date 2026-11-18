/* =============================================================================
   Uso LicitaHub · Robô de Lances (6. Disputa)
   Painel em tempo real: itens em disputa, melhor lance da praça x nosso lance,
   status do robô, edição rápida do piso e do teto e o chat da sala.
   O motor e a trava do piso ficam em js/robo-motor.js (LH.robo).
   Por enquanto a sala é SIMULADA: os portais não têm API pública de lances.
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const ROTULO = {
    idle: ['Parado', 'robo-status--parado'],
    running: ['Ativo', 'robo-status--ativo'],
    paused: ['Pausado', 'robo-status--pausado'],
    stopped_at_floor: ['Parado por segurança', 'robo-status--piso'],
  };
  const moeda = (v) => (v == null ? '—' : fmt.moeda(v));
  const INTERVALO_SIMULACAO_MS = 1500; // na sala simulada o intervalo é acelerado
  // Portais onde o robô pode atuar: os mesmos da busca, mais a Petronect.
  const PORTAIS = () => [...LH.PLATAFORMAS.map(([k, n]) => [k, n]), ['petronect', 'Petronect'], LH.PLATAFORMA_OUTROS];
  const nomePortal = (k) => (PORTAIS().find(([c]) => c === k) || LH.PLATAFORMA_OUTROS)[1];
  const curto = (nome) => nome.replace(/\s*\(.*\)$/, '');

  LH.vistas.robo = {
    titulo: 'Robô de lances',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Robô de lances',
        texto: 'Cobre os lances dos concorrentes por centavos e para sozinho no seu preço mínimo de segurança. Nunca dá lance em prejuízo.',
        acoes: `<span class="selo selo--alerta">${icone('info')} Sala simulada</span>
                <button class="btn btn--primario" type="button" data-novo>${icone('mais')} Novo item</button>`,
      })}
      <p class="nota robo-aviso">${icone('escudo')} <span><strong>Trava de segurança:</strong> o robô nunca dá lance abaixo do preço mínimo nem acima do teto. A regra é conferida no motor e de novo no banco de dados. Os portais oficiais (Compras.gov.br e outros) ainda não têm API pública de lances, então a sala abaixo é uma <strong>simulação</strong> para testar a estratégia.</span></p>
      <div class="robo-portais" role="group" aria-label="Filtrar por portal">
        <span class="robo-portais__rotulo">${icone('computador')} Portal</span>
        <button type="button" class="chip-portal ativo" data-portal="">Todos</button>
        ${PORTAIS().map(([k, n]) => `<button type="button" class="chip-portal" data-portal="${esc(k)}">${esc(curto(n))}</button>`).join('')}
      </div>
      <div class="robo-grade">
        <section class="robo-itens" id="robo-itens" aria-live="polite">${LH.carregando('Carregando itens...')}</section>
        <aside class="card robo-chat" aria-label="Chat da sala de pregão">
          <div class="card__titulo"><h2>${icone('chat')} Sala de pregão</h2><span class="robo-chat__ao-vivo"><i></i> ao vivo</span></div>
          <ol class="robo-chat__lista" id="robo-chat"><li class="robo-chat__vazio">As mensagens oficiais e os lances aparecem aqui quando o robô estiver ativo.</li></ol>
        </aside>
      </div>`,
    montar(raiz) {
      const caixa = raiz.querySelector('#robo-itens');
      const chat = raiz.querySelector('#robo-chat');
      const disputas = new Map(); // id -> Disputa
      let itens = [];
      let filtro = '';

      const gravar = LH.atrasar((id, campos) => LH.repo.roboEstado(id, campos).catch((e) => LH.aviso(e.message, 'perigo')), 300);
      const item = (id) => itens.find((i) => i.id === id);

      const falar = (autor, texto, tipo = '') => {
        chat.querySelector('.robo-chat__vazio')?.remove();
        const hora = new Date().toLocaleTimeString('pt-BR');
        chat.insertAdjacentHTML('beforeend', `<li class="robo-chat__msg ${tipo}"><b>${esc(autor)}</b><time>${hora}</time><p>${esc(texto)}</p></li>`);
        while (chat.children.length > 200) chat.firstElementChild.remove();
        chat.scrollTop = chat.scrollHeight;
      };

      // Barra teto -> piso: quanto da margem de descida o nosso lance já consumiu.
      const trilho = (i) => {
        if (i.nossoLance == null || !(i.teto > i.piso)) return '';
        const pct = Math.max(0, Math.min(100, ((i.teto - i.nossoLance) / (i.teto - i.piso)) * 100));
        const nivel = pct >= 85 ? 'robo-trilho--perto' : pct >= 60 ? 'robo-trilho--meio' : '';
        return `<div class="robo-trilho ${nivel}" role="meter" aria-label="Margem consumida até o piso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
            <div class="robo-trilho__barra"><i style="width:${pct.toFixed(1)}%"></i></div>
            <div class="robo-trilho__legenda"><span>Teto</span><b>${Math.round(pct)}% da margem usada</b><span>Piso</span></div>
          </div>`;
      };

      const cartao = (i) => {
        const [rotulo, classe] = ROTULO[i.status] || ROTULO.idle;
        const vencendo = i.nossoLance != null && (i.melhorLance == null || i.nossoLance < i.melhorLance);
        const folga = i.nossoLance != null && i.piso ? i.nossoLance - i.piso : null;
        return `
        <article class="card robo-item ${classe}" data-item="${esc(i.id)}">
          <header class="robo-item__topo">
            <div><span class="selo robo-portal">${icone('computador')} ${esc(curto(nomePortal(i.plataforma)))}</span>
            <h3>${esc(i.descricao)}</h3></div>
            <span class="robo-status ${classe}"><i aria-hidden="true"></i>${rotulo}</span>
          </header>
          <div class="robo-placar">
            <div><span>Melhor lance da praça</span><strong>${moeda(i.melhorLance)}</strong></div>
            <div class="${i.nossoLance == null ? '' : vencendo ? 'robo-placar--vencendo' : 'robo-placar--coberto'}"><span>Nosso lance</span><strong>${moeda(i.nossoLance)}</strong>
              <em>${i.nossoLance == null ? 'ainda sem lance' : vencendo ? 'estamos na frente' : 'fomos cobertos'}</em></div>
          </div>
          ${trilho(i)}
          <dl class="robo-limites">
            <div><dt>Preço teto</dt><dd>${moeda(i.teto)}</dd></div>
            <div><dt>Custo</dt><dd>${moeda(i.custo)}</dd></div>
            <div class="robo-limites__piso"><dt>Mínimo de segurança</dt><dd>${moeda(i.piso)}</dd></div>
            <div><dt>Folga até o piso</dt><dd>${folga == null ? '—' : moeda(folga)}</dd></div>
          </dl>
          <div class="robo-item__acoes">
            ${i.status === 'running'
              ? `<button class="btn btn--pequeno" data-acao="pausar">${icone('relogio')} Pausar</button>`
              : `<button class="btn btn--pequeno btn--primario" data-acao="iniciar">${icone('play')} ${i.status === 'paused' ? 'Retomar' : 'Iniciar'}</button>`}
            <button class="btn btn--pequeno" data-acao="parar" ${i.status === 'idle' ? 'disabled' : ''}>${icone('fechar')} Parar</button>
            <button class="btn btn--pequeno btn--fantasma" data-acao="limites">${icone('lapis')} Piso e teto</button>
            <button class="btn btn--pequeno btn--fantasma" data-acao="excluir" ${i.status === 'running' ? 'disabled' : ''} aria-label="Excluir item">${icone('lixeira')}</button>
          </div>
        </article>`;
      };

      const desenhar = () => {
        const visiveis = itens.filter((i) => !filtro || i.plataforma === filtro);
        if (itens.length && !visiveis.length) {
          caixa.innerHTML = `<div class="card">${LH.vazio('computador', `Nenhum item em ${nomePortal(filtro)}`, 'Escolha outro portal ou cadastre um item neste.', `<button class="btn btn--primario" data-novo>${icone('mais')} Novo item</button>`)}</div>`;
          return;
        }
        caixa.innerHTML = itens.length ? visiveis.map(cartao).join('')
          : `<div class="card">${LH.vazio('alvo', 'Nenhum item no robô', 'Cadastre um item com o preço teto, o seu custo e o preço mínimo de segurança.', `<button class="btn btn--primario" data-novo>${icone('mais')} Novo item</button>`)}</div>`;
      };
      const redesenhar = (id) => {
        const el = caixa.querySelector(`[data-item="${CSS.escape(id)}"]`);
        if (el && item(id)) el.outerHTML = cartao(item(id));
      };
      const mudar = (id, campos, salvar = true) => {
        Object.assign(item(id), campos);
        redesenhar(id);
        if (salvar) gravar(id, { status: item(id).status, nossoLance: item(id).nossoLance, melhorLance: item(id).melhorLance });
      };

      // --- Formulário (novo item e edição rápida dos limites) ---
      const campo = (nome, rotulo, valor, extra = '') => `<label class="campo"><span class="campo__rotulo">${rotulo}</span>
        <input name="${nome}" inputmode="decimal" value="${valor == null ? '' : esc(String(valor).replace('.', ','))}" ${extra}></label>`;
      const lerForm = (janela) => {
        const f = janela.querySelector('form');
        const n = (k) => (f[k] && f[k].value.trim() !== '' ? fmt.lerNumero(f[k].value) : null);
        return { descricao: f.descricao?.value.trim(), plataforma: f.plataforma?.value, teto: n('teto'), custo: n('custo'), piso: n('piso'), decremento: n('decremento') ?? 0.01, intervaloSeg: n('intervalo') ?? 20 };
      };
      const abrirForm = (i = null, soLimites = false) => {
        LH.modal({
          titulo: soLimites ? 'Piso e teto (vale na hora)' : (i ? 'Editar item' : 'Novo item no robô'),
          html: `<form class="form" onsubmit="return false">
            ${soLimites ? `<p class="fraco">${esc(i.descricao)}</p>` : `<label class="campo"><span class="campo__rotulo">Descrição do item</span>
              <input name="descricao" maxlength="300" required value="${esc(i?.descricao || '')}" placeholder="ex.: Item 1 · Notebook i5 16 GB"></label>
              <label class="campo"><span class="campo__rotulo">Portal da disputa</span>
                <select name="plataforma">${LH.opcoes(PORTAIS(), i?.plataforma || filtro || 'comprasnet')}</select></label>`}
            <div class="form__linha">${campo('teto', 'Preço teto (R$)', i?.teto, 'required')}${soLimites ? '' : campo('custo', 'Custo do fornecedor (R$)', i?.custo)}</div>
            ${campo('piso', 'Preço mínimo de segurança (R$)', i?.piso, 'required')}
            ${soLimites ? '' : `<div class="form__linha">${campo('decremento', 'Cobrir por (R$)', i?.decremento ?? 0.01)}${campo('intervalo', 'Intervalo entre lances (s)', i?.intervaloSeg ?? 20)}</div>
            <p class="fraco">O mínimo de segurança deve cobrir o custo, os impostos, o frete e a sua margem. O intervalo e o valor mínimo de cobertura seguem o edital.</p>`}
            <p class="texto-perigo" data-erro hidden></p>
          </form>`,
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            { rotulo: 'Salvar', classe: 'btn--primario', acao: async (fechar, janela) => {
              const v = lerForm(janela);
              const dados = soLimites ? { ...i, teto: v.teto, piso: v.piso } : { ...i, ...v };
              const erros = (!soLimites && !dados.descricao ? ['Informe a descrição do item.'] : [])
                .concat(LH.robo.validarLimites({ teto: dados.teto, custo: dados.custo, piso: dados.piso, decremento: dados.decremento }));
              const caixaErro = janela.querySelector('[data-erro]');
              if (erros.length) { caixaErro.textContent = erros[0]; caixaErro.hidden = false; return; }
              try {
                disputas.get(i?.id)?.atualizarLimites({ piso: dados.piso, teto: dados.teto });
                const salvo = await LH.repo.salvarRoboItem(dados);
                if (i) Object.assign(item(i.id), { teto: salvo.teto, custo: salvo.custo, piso: salvo.piso, descricao: salvo.descricao, decremento: salvo.decremento, intervaloSeg: salvo.intervaloSeg });
                else itens.push(salvo);
                fechar();
                desenhar();
                LH.aviso(soLimites ? 'Limites atualizados. O robô já usa os valores novos.' : 'Item salvo.', 'sucesso');
              } catch (e) { caixaErro.textContent = e.message; caixaErro.hidden = false; }
            } },
          ],
        });
      };

      // --- Disputa simulada de um item ---
      const iniciar = (i) => {
        const existente = disputas.get(i.id);
        if (existente && existente.status === 'paused') return existente.retomar();
        // Concorrentes da simulação: param entre ~95% do custo e ~5% acima do piso.
        const custo = i.custo ?? i.piso * 0.9;
        const minimo = custo * 0.95 + Math.random() * (i.piso * 1.05 - custo * 0.95);
        const sala = new LH.robo.SalaSimulada({ inicial: i.teto * 1.03, minimoConcorrentes: Math.round(minimo * 100) / 100 });
        const d = new LH.robo.Disputa({
          sala, piso: i.piso, teto: i.teto, custo: i.custo, decremento: i.decremento,
          intervaloMs: Math.min(i.intervaloSeg * 1000, INTERVALO_SIMULACAO_MS), nossoLance: null,
          aoStatus: (status, motivo) => {
            mudar(i.id, { status: status === 'idle' && motivo === 'encerrada' ? 'idle' : status });
            if (motivo === 'encerrada') falar('Sistema', `Disputa encerrada · ${i.descricao}. ${item(i.id).nossoLance != null && item(i.id).nossoLance <= (item(i.id).melhorLance ?? Infinity) ? 'Terminamos na frente.' : 'Não ficamos com o melhor lance.'}`, 'robo-chat__msg--sistema');
          },
          aoLance: (v) => { mudar(i.id, { nossoLance: v }); falar('Robô (nós)', `Lance de ${moeda(v)} · ${i.descricao}`, 'robo-chat__msg--nos'); },
          aoConcorrente: (v, autor) => { mudar(i.id, { melhorLance: v }); falar(autor, `Lance de ${moeda(v)} · ${i.descricao}`); },
          aoMensagem: (m) => falar(m.autor, m.texto, 'robo-chat__msg--oficial'),
          aoAlerta: (texto) => {
            falar('Trava de segurança', texto, 'robo-chat__msg--alerta');
            LH.aviso(texto, 'perigo');
            LH.notificar?.('Robô parado por segurança', texto);
          },
        });
        disputas.set(i.id, d);
        mudar(i.id, { nossoLance: null, melhorLance: null });
        falar('Sistema', `Robô ligado · ${curto(nomePortal(i.plataforma))} · ${i.descricao}. Piso ${moeda(i.piso)}, teto ${moeda(i.teto)}.`, 'robo-chat__msg--sistema');
        d.iniciar().catch((e) => { LH.aviso(e.message, 'perigo'); mudar(i.id, { status: 'stopped_at_floor' }); });
      };

      LH.ao(raiz, 'click', '[data-novo]', () => abrirForm());
      LH.ao(raiz, 'click', '[data-portal]', (e, b) => {
        filtro = b.dataset.portal;
        raiz.querySelectorAll('[data-portal]').forEach((x) => x.classList.toggle('ativo', x === b));
        desenhar();
      });
      LH.ao(caixa, 'click', '[data-acao]', async (e, botao) => {
        const i = item(botao.closest('[data-item]').dataset.item);
        const d = disputas.get(i.id);
        switch (botao.dataset.acao) {
          case 'iniciar': iniciar(i); break;
          case 'pausar': d?.pausar(); falar('Sistema', `Robô pausado · ${i.descricao}`, 'robo-chat__msg--sistema'); break;
          case 'parar': if (d) d.parar(); else mudar(i.id, { status: 'idle' }); disputas.delete(i.id); break;
          case 'limites': abrirForm(i, true); break;
          case 'excluir':
            if (!(await LH.confirmar('Excluir item', `Excluir "${i.descricao}" do robô?`, 'Excluir', true))) return;
            try { await LH.repo.excluirRoboItem(i.id); itens = itens.filter((x) => x.id !== i.id); desenhar(); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
            break;
          default:
        }
      });

      LH.repo.roboItens()
        .then((lista) => {
          // Ao abrir a tela, nenhum robô está rodando: "ativo" de outra visita vira "pausado".
          itens = lista.map((i) => (i.status === 'running' ? { ...i, status: 'paused' } : i));
          desenhar();
        })
        .catch((e) => { caixa.innerHTML = LH.erroHtml(e); });

      // Ao sair da tela, os robôs simulados param.
      return () => disputas.forEach((d) => d.status !== 'idle' && d.parar());
    },
  };
}());
