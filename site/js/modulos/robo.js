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
      const vivo = LH.roboAoVivo; // estado global: as disputas seguem rodando fora desta tela
      let filtro = '';
      let carregado = false;
      const item = (id) => vivo.item(id);

      const msgHtml = (m) => `<li class="robo-chat__msg ${m.tipo}"><b>${esc(m.autor)}</b><time>${m.hora}</time><p>${esc(m.texto)}</p></li>`;
      const falarNaTela = (m) => {
        chat.querySelector('.robo-chat__vazio')?.remove();
        chat.insertAdjacentHTML('beforeend', msgHtml(m));
        while (chat.children.length > 200) chat.firstElementChild.remove();
        chat.scrollTop = chat.scrollHeight;
      };
      if (vivo.mensagens().length) {
        chat.innerHTML = vivo.mensagens().map(msgHtml).join('');
        requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
      }

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
        const itens = vivo.lista();
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
                if (i) vivo.atualizarLimites(i.id, { piso: dados.piso, teto: dados.teto });
                const salvo = await LH.repo.salvarRoboItem(dados);
                if (i) vivo.atualizar(i.id, { teto: salvo.teto, custo: salvo.custo, piso: salvo.piso, descricao: salvo.descricao, decremento: salvo.decremento, intervaloSeg: salvo.intervaloSeg });
                else vivo.adicionar(salvo);
                fechar();
                LH.aviso(soLimites ? 'Limites atualizados. O robô já usa os valores novos.' : 'Item salvo.', 'sucesso');
              } catch (e) { caixaErro.textContent = e.message; caixaErro.hidden = false; }
            } },
          ],
        });
      };

      LH.ao(raiz, 'click', '[data-novo]', () => abrirForm());
      LH.ao(raiz, 'click', '[data-portal]', (e, b) => {
        filtro = b.dataset.portal;
        raiz.querySelectorAll('[data-portal]').forEach((x) => x.classList.toggle('ativo', x === b));
        desenhar();
      });
      LH.ao(caixa, 'click', '[data-acao]', async (e, botao) => {
        const i = item(botao.closest('[data-item]').dataset.item);
        switch (botao.dataset.acao) {
          case 'iniciar': vivo.iniciar(i.id, curto(nomePortal(i.plataforma))); break;
          case 'pausar': vivo.pausar(i.id); break;
          case 'parar': vivo.parar(i.id); break;
          case 'limites': abrirForm(i, true); break;
          case 'excluir':
            if (!(await LH.confirmar('Excluir item', `Excluir "${i.descricao}" do robô?`, 'Excluir', true))) return;
            try { await vivo.remover(i.id); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
            break;
          default:
        }
      });

      // A tela só "ouve" o estado global. Ao sair, deixa de ouvir: os robôs continuam
      // rodando e aparecem no mini player flutuante (js/robo-ao-vivo.js).
      const deixarDeOuvir = vivo.ouvir((tipo, dado) => {
        if (!carregado) return;
        if (tipo === 'item') redesenhar(dado);
        else if (tipo === 'lista') desenhar();
        else if (tipo === 'chat') falarNaTela(dado);
      });
      vivo.carregar()
        .then(() => { carregado = true; desenhar(); })
        .catch((e) => { caixa.innerHTML = LH.erroHtml(e); });

      return deixarDeOuvir;
    },
  };
}());
