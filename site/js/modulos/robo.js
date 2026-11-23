/* =============================================================================
   Uso LicitaHub · Robô Turbo 2.0 (6. Disputa)
   Sala de disputa em tempo real, igual ao que o operador vê nos portais:
   - card por item com o selo do portal, as fases do pregão em abas (aberta,
     prorrogação, desempate ME/EPP, negociação, habilitação), quantidade e valor
     unitário x total, placar e a trava do piso;
   - painel lateral com o ranking da praça (posição, ME/EPP, faixa de 5% da
     LC 123) e o feed de lances/mensagens da sala;
   - o item em que estamos na liderança sobe para o topo; ao perder, desce.
   O motor e as travas ficam em js/robo-motor.js (LH.robo), o estado ao vivo em
   js/robo-ao-vivo.js e as regras dos portais em js/robo-portais.js.
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
    stopped_at_floor: ['Preço mínimo atingido', 'robo-status--piso'],
  };
  const FASES = [
    ['aberta', 'Aberta', 'Lances livres. O robô cobre a praça por centavos, respeitando o intervalo do portal, o teto e o piso.'],
    ['prorrogacao', 'Prorrogação', 'Lance nos últimos instantes estende o prazo automaticamente. O robô continua cobrindo até o piso.'],
    ['desempate', 'Desempate ME/EPP', 'LC 123, art. 44: a ME/EPP que ficou até 5% acima do melhor lance de uma empresa que não é ME/EPP pode cobri-lo. Não há lances do robô nesta fase.'],
    ['negociacao', 'Negociação', 'O pregoeiro negocia com o arrematante pelo chat. A contraproposta é decisão sua: o robô só acompanha.'],
    ['habilitacao', 'Habilitação', 'O arrematante envia os documentos de habilitação e a proposta ajustada no prazo do edital.'],
  ];
  const ORDEM_FASE = Object.fromEntries(FASES.map(([k], n) => [k, n]));
  const PORTE = { me: 'ME', epp: 'EPP', demais: 'Demais' };
  const moeda = (v) => (v == null ? '—' : fmt.moeda(v));
  const portais = () => LH.portaisRobo;
  const nomePortal = (k) => portais().de(k).nome;
  // Chips do filtro: nome do portal + situação do modo real (a simulação vale para todos).
  const chipsPortais = () => portais().lista().map((p) => {
    const x = portais().suporte(p.chave);
    return `<button type="button" class="chip-portal" data-portal="${esc(p.chave)}" style="--matiz:${p.matiz}" title="${esc(`${p.nome}: ${x.rotulo}. ${x.texto}`)}"><i aria-hidden="true"></i>${esc(p.nome)}<small class="chip-portal__etapa chip-portal__etapa--${x.cor}">${esc(x.curto)}</small></button>`;
  }).join('');
  /** Janela com o status/roadmap do modo real em cada portal. */
  const abrirStatusPortais = () => LH.modal({
    titulo: 'Portais no Robô Turbo 2.0',
    html: `<p class="fraco">Os portais não têm API pública de lances. Por isso cada um passa por 3 etapas antes do modo real: <b>1)</b> mapear o login, <b>2)</b> mapear a sala numa disputa real, só monitorando, <b>3)</b> liberar os lances. Enquanto isso, a Sala Simulada funciona com todos, e nenhum lance real é enviado num portal que não foi conferido.</p>
      <div class="tabela-rolagem"><table class="tabela tabela-portais">
        <thead><tr><th>#</th><th>Portal</th><th>Sala Simulada</th><th>Modo real</th></tr></thead>
        <tbody>${portais().porRoadmap().map((p) => `<tr>
          <td>${p.suporte.prioridade ?? '—'}</td>
          <td>${portais().selo(p.chave)}</td>
          <td>${p.disputa ? 'Sim' : '—'}</td>
          <td>${portais().etiqueta(p.chave)}<br><small class="fraco">${esc(p.suporte.texto)}</small></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="fraco">A credencial do cofre fica guardada mesmo antes de o portal ser liberado. Contas que o portal ainda não aprovou (cadastro em análise) também só usam a simulação.</p>`,
    acoes: [{ rotulo: 'Fechar', classe: 'btn--primario' }],
  });
  const lidera = (i) => i.nossoLance != null && (i.melhorLance == null || i.nossoLance < i.melhorLance);
  const emLances = (i) => !i.fase || i.fase === 'aberta' || i.fase === 'prorrogacao';
  const seloPorte = (p) => (p === 'me' || p === 'epp' ? `<span class="selo-porte">${PORTE[p]}</span>` : '');
  const reduzMovimento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cronometro = (fimEm) => {
    const s = Math.max(0, Math.ceil((fimEm - Date.now()) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  // Tutorial em vídeo do Robô Turbo 2.0: na tela do robô e na tela de bloqueio (quem não
  // tem o Max também pode assistir antes de assinar).
  LH.tutorialRobo = {
    html: () => `
      <details class="card tutorial-video" id="robo-tutorial" data-tutorial-robo>
        <summary class="tutorial-video__cabecalho">
          <span class="tutorial-video__capa" aria-hidden="true"><img src="video/robo-turbo-tutorial.jpg" alt="" loading="lazy" width="128" height="72">${icone('play')}</span>
          <span class="tutorial-video__textos">
            <span class="selo selo--info tutorial-video__selo">${icone('play')} Tutorial</span>
            <strong class="tutorial-video__titulo">Como usar o Robô Turbo 2.0 na prática</strong>
            <span class="fraco">Em pouco mais de 3 minutos, veja como o robô cobre os lances por centavos e trava no seu preço mínimo.</span>
          </span>
          <span class="btn btn--pequeno tutorial-video__acao" aria-hidden="true">${icone('play')} <span data-tutorial-rotulo>Assistir</span></span>
        </summary>
        <div class="tutorial-video__player">
          <video controls preload="metadata" playsinline poster="video/robo-turbo-tutorial.jpg" aria-label="Tutorial: Como usar o Robô Turbo 2.0 na prática">
            <source src="video/robo-turbo-tutorial.mp4" type="video/mp4">
            Seu navegador não reproduz vídeo. <a href="video/robo-turbo-tutorial.mp4">Baixe o tutorial</a>.
          </video>
        </div>
      </details>`,
    ligar(raiz) {
        // Tutorial em vídeo: fechado por padrão; lembra se a pessoa abriu. #/robo?tutorial=1 abre e rola até ele.
        const tutorial = raiz.querySelector('[data-tutorial-robo]');
        if (!tutorial) return;
        const video = tutorial.querySelector('video');
        const rotuloTutorial = tutorial.querySelector('[data-tutorial-rotulo]');
        const pedidoTutorial = new URLSearchParams(location.hash.split('?')[1] || '').has('tutorial');
        let aberto = pedidoTutorial;
        try { aberto ||= localStorage.getItem('lh-robo-tutorial') === 'aberto'; } catch { /* sem armazenamento */ }
        tutorial.open = aberto;
        rotuloTutorial.textContent = aberto ? 'Fechar' : 'Assistir';
        tutorial.addEventListener('toggle', () => {
          rotuloTutorial.textContent = tutorial.open ? 'Fechar' : 'Assistir';
          if (!tutorial.open) video.pause();
          try { localStorage.setItem('lh-robo-tutorial', tutorial.open ? 'aberto' : 'fechado'); } catch { /* sem armazenamento */ }
        });
        if (pedidoTutorial) requestAnimationFrame(() => tutorial.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
  };

  LH.vistas.robo = {
    titulo: 'Robô Turbo 2.0',
    render: () => `
      <div class="robo-topo">
      <button type="button" class="robo-orbe" data-alertas aria-label="Alertas por e-mail" title="Alertas por e-mail">
        ${icone('sino')}<i class="robo-orbe__ponto" aria-hidden="true"></i>
      </button>
      ${LH.cabecalho({
        titulo: 'Robô Turbo 2.0',
        texto: 'Cobre os lances dos concorrentes por centavos, acompanha as fases do pregão e para sozinho no seu preço mínimo de segurança. Nunca dá lance em prejuízo.',
        acoes: `<div class="robo-modo" role="radiogroup" aria-label="Modo da sala de disputa">
                  <button type="button" role="radio" class="robo-modo__op" data-modo="simulada">${icone('play')} Sala simulada</button>
                  <button type="button" role="radio" class="robo-modo__op" data-modo="real">${icone('plugue')} Modo real</button>
                </div>
                <button class="robo-quadro" type="button" data-cofre aria-label="Credenciais dos portais" title="Credenciais dos portais">${icone('cadeado')}</button>
                <button class="robo-quadro robo-quadro--primario" type="button" data-novo aria-label="Novo item" title="Novo item">${icone('mais')}</button>`,
      })}
      </div>
      ${LH.tutorialRobo.html()}
      <p class="nota robo-aviso robo-aviso--real" data-aviso-real hidden>${icone('plugue')} <span><strong>Modo real:</strong> o robô do servidor entra no portal com a <strong>sua credencial do cofre</strong>, abre a sala do pregão e transmite os lances, as fases e o chat ao vivo para esta tela. Por padrão ele <strong>só monitora</strong>; para dar lances de verdade, escolha isso ao conectar e confirme. Os portais não têm API pública: cada um precisa ter a sala mapeada no robô (por enquanto nenhum foi conferido numa sessão real, então a conexão avisa o que falta).</span></p>
      <p class="nota robo-aviso">${icone('escudo')} <span><strong>Prejuízo zero:</strong> o robô nunca dá lance abaixo do preço mínimo nem acima do teto, e o mínimo nunca fica abaixo do custo. A regra é conferida no motor e de novo no banco de dados. Os portais ainda não têm API pública de lances, então a sala abaixo é uma <strong>simulação</strong> com as regras do modo aberto e da LC 123, para testar a estratégia.</span></p>
      <div class="robo-portais" role="group" aria-label="Filtrar por portal">
        <span class="robo-portais__rotulo">${icone('computador')} Portal</span>
        <button type="button" class="chip-portal ativo" data-portal="">Todos</button>
        <span class="robo-portais__chips" data-chips-portais>${chipsPortais()}</span>
        <button type="button" class="link-botao robo-portais__status" data-status-portais>${icone('info')} Status dos portais</button>
      </div>
      <p class="fraco robo-portais__legenda">A <strong>Sala Simulada</strong> funciona com todos os portais. O <strong>modo real</strong> (o robô entrando no portal com a sua credencial) é liberado portal a portal, depois que a sala de disputa é mapeada e conferida numa sessão real.</p>
      <section class="card feed-vivo" id="feed-vivo" aria-live="polite" hidden></section>
      <h2 class="robo-secao">${icone('alvo')} Itens no Robô Turbo 2.0</h2>
      <div class="robo-grade">
        <section class="robo-itens" id="robo-itens" aria-live="polite">${LH.carregando('Carregando itens...')}</section>
        <aside class="card robo-chat" aria-label="Sala de pregão">
          <div class="card__titulo"><h2>${icone('chat')} Sala de pregão</h2><span class="robo-chat__ao-vivo"><i></i> ao vivo</span></div>
          <div class="robo-abas" role="tablist">
            <button type="button" role="tab" class="robo-aba ativo" aria-selected="true" data-painel="ranking">${icone('grafico')} Ranking</button>
            <button type="button" role="tab" class="robo-aba" aria-selected="false" data-painel="feed">${icone('chat')} Lances ao vivo</button>
          </div>
          <div class="robo-foco" id="robo-foco"></div>
          <div class="robo-painel" data-painel-corpo="ranking" id="robo-ranking"></div>
          <div class="robo-painel robo-feed" data-painel-corpo="feed" hidden>
            <div class="robo-feed__filtro" role="group" aria-label="Quais lances mostrar">
              <button type="button" class="chip-portal ativo" data-feed="foco">Só o item selecionado</button>
              <button type="button" class="chip-portal" data-feed="todos">Todos os itens</button>
            </div>
            <ol class="robo-chat__lista" id="robo-chat"></ol>
          </div>
        </aside>
      </div>`,
    montar(raiz) {
      LH.tutorialRobo.ligar(raiz);

      const orbe = raiz.querySelector('.robo-orbe');
      const marcarOrbe = (ligado) => {
        orbe.classList.toggle('robo-orbe--ligado', !!ligado);
        const t = ligado ? 'Alertas por e-mail: ligados' : 'Alertas por e-mail: desligados (clique para ligar)';
        orbe.title = t;
        orbe.setAttribute('aria-label', t);
      };
      LH.repo.alertasRobo?.().then((a) => marcarOrbe(a.email)).catch(() => {});
      const caixa = raiz.querySelector('#robo-itens');
      const chat = raiz.querySelector('#robo-chat');
      const painelRanking = raiz.querySelector('#robo-ranking');
      const vivo = LH.roboAoVivo; // estado global: as disputas seguem rodando fora desta tela
      const abaDe = new Map(); // id -> fase escolhida pelo operador nas abas do card
      let filtro = '';
      let foco = null; // item mostrado no ranking
      let carregado = false;
      const item = (id) => vivo.item(id);

      // --- Feed de lances e mensagens ---
      const msgHtml = (m) => {
        const lance = m.valor != null;
        const pos = m.posicao ? `<span class="robo-pos">${m.posicao}º</span>` : '';
        const corpo = lance
          ? `<p><strong>${moeda(m.valor)}</strong> <span class="fraco">/un</span> · total ${moeda(m.valor * (m.quantidade || 1))}<small>${esc(m.texto)}</small></p>`
          : `<p>${esc(m.texto)}</p>`;
        return `<li class="robo-chat__msg ${m.tipo}${lance ? ' robo-chat__msg--lance' : ''}"><b>${pos}${esc(m.autor)}${lance ? seloPorte(m.porte) : ''}</b><time>${m.hora}</time>${corpo}</li>`;
      };
      let feedTodos = false;
      const noFeed = (m) => feedTodos || !m.itemId || m.itemId === foco;
      const feedVazio = () => `<li class="robo-chat__vazio">${feedTodos || !foco
        ? 'As mensagens oficiais e os lances aparecem aqui quando um robô estiver ativo.'
        : 'Os lances da praça deste item aparecem aqui assim que o robô for iniciado.'}</li>`;
      const desenharFeed = () => {
        const lista = vivo.mensagens().filter(noFeed);
        chat.innerHTML = lista.length ? lista.map(msgHtml).join('') : feedVazio();
        requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
      };
      const falarNaTela = (m) => {
        if (!noFeed(m)) return;
        chat.querySelector('.robo-chat__vazio')?.remove();
        chat.insertAdjacentHTML('beforeend', msgHtml(m));
        while (chat.children.length > 200) chat.firstElementChild.remove();
        chat.scrollTop = chat.scrollHeight;
      };

      // Cabeçalho do painel: item selecionado, status e o botão para simular a praça dele.
      const caixaFoco = raiz.querySelector('#robo-foco');
      const desenharFoco = () => {
        const i = foco && item(foco);
        if (!i) { caixaFoco.innerHTML = ''; return; }
        let [rotulo, classe] = ROTULO[i.status] || ROTULO.idle;
        if (i.status === 'running' && !emLances(i)) [rotulo, classe] = ['Acompanhando', 'robo-status--acompanha'];
        else if (i.status === 'running' && (i.monitorando || i.real?.modo === 'monitorar')) [rotulo, classe] = ['Monitorando', 'robo-status--acompanha'];
        const acao = i.status === 'running'
          ? `<button type="button" class="btn btn--pequeno" data-foco-acao="pausar">${icone('relogio')} Pausar</button>`
          : `<button type="button" class="btn btn--pequeno btn--primario" data-foco-acao="iniciar">${icone(vivo.modo() === 'real' ? 'plugue' : 'play')} ${i.status === 'paused' ? 'Retomar' : vivo.modo() === 'real' ? 'Conectar ao pregão' : 'Simular praça'}</button>`;
        caixaFoco.innerHTML = `
          <div class="robo-foco__topo">${portais().selo(i.plataforma)}<span class="robo-status ${classe}"><i aria-hidden="true"></i>${rotulo}</span></div>
          <b class="robo-foco__nome" title="${esc(i.descricao)}">${esc(i.descricao)}</b>
          <div class="robo-foco__linha"><span>Praça <strong>${moeda(i.melhorLance)}</strong></span><span>Nós <strong>${moeda(i.nossoLance)}</strong></span>${acao}</div>
          ${blocoPrevisao(i.previsao)}`;
      };

      // --- Previsão (camada preditiva): fechamento, chance de vitória e margem ---
      const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
      const blocoPrevisao = (p) => {
        if (!p) return '';
        const chance = p.probabilidadeVitoria;
        const tom = chance >= 60 ? 'boa' : chance >= 35 ? 'media' : 'ruim';
        const fonte = p.fonte.historico === 'historico' ? `${p.fonte.homologacoes} fechamento(s) parecido(s) + praça ao vivo` : 'praça ao vivo (ainda sem histórico parecido)';
        return `<div class="robo-previsao robo-previsao--${tom}" title="Estimativa estatística. Não é garantia de resultado.">
          <div class="robo-previsao__chance"><span>Chance de vitória</span><strong>${pct(chance)}</strong><i style="--p:${Math.max(0, Math.min(100, chance))}%"></i></div>
          <dl class="robo-previsao__dados">
            <div><dt>Fechamento previsto</dt><dd>${moeda(p.previsto)}<small>${moeda(p.minimo)} a ${moeda(p.maximo)}</small></dd></div>
            <div><dt>Margem estimada</dt><dd>${pct(p.margemEstimadaPct)}</dd></div>
            <div><dt>Deságio máx. seguro</dt><dd>${pct(p.tetoSeguroDesagioPct)}</dd></div>
            <div><dt>Inflexão da praça</dt><dd>${p.inflexao ? moeda(p.inflexao.valor) : '—'}</dd></div>
          </dl>
          <p class="robo-previsao__fonte">Confiança ${esc(p.confianca)} · ${esc(fonte)}</p>
        </div>`;
      };

      // --- Ranking da praça (item em foco) ---
      const desenharRanking = () => {
        const i = foco && item(foco);
        if (!i) { painelRanking.innerHTML = '<p class="robo-chat__vazio">Clique num item para ver o ranking da praça.</p>'; return; }
        const r = vivo.ranking(i.id);
        const pref = vivo.preferencia(i.id);
        const qtd = i.quantidade || 1;
        const perfis = new Map((i.previsao?.concorrentes || []).map((c) => [c.autor, c]));
        const seloPerfil = (autor) => {
          const c = perfis.get(autor);
          if (!c) return '';
          const resp = c.respostaMedianaMs != null ? ` · responde em ~${Math.round(c.respostaMedianaMs / 1000)}s` : '';
          const agr = c.agressividadePct != null ? ` · desce ~${pct(c.agressividadePct)} por lance` : '';
          return `<em class="robo-perfil robo-perfil--${c.perfil}" title="${esc(`${c.lances} lance(s)${resp}${agr}`)}">${c.perfil}</em>`;
        };
        const linhas = r.map((x) => {
          const nos = x.autor === 'nos';
          const faixa = pref.faixa.has(x.autor);
          return `<li class="robo-rank${nos ? ' robo-rank--nos' : ''}${x.posicao === 1 ? ' robo-rank--lider' : ''}${faixa ? ' robo-rank--faixa' : ''}">
            <span class="robo-pos">${x.posicao}º</span>
            <span class="robo-rank__nome">${nos ? 'Nós (robô)' : esc(x.autor)}${seloPorte(x.porte)}${nos ? '' : seloPerfil(x.autor)}${faixa ? '<em title="Na faixa de 5% da LC 123: pode cobrir no desempate">≤5%</em>' : ''}</span>
            <span class="robo-rank__valor"><strong>${moeda(x.valor)}</strong><small>total ${moeda(x.valor * qtd)}</small></span>
          </li>`;
        }).join('');
        painelRanking.innerHTML = `
          ${r.length ? `<ol class="robo-rank__lista">${linhas}</ol>` : `<p class="robo-chat__vazio">${vivo.modo() === 'real' ? 'Clique em <b>Conectar ao pregão</b> acima para acompanhar a sala real.' : 'Clique em <b>Simular praça</b> acima para os concorrentes começarem a dar lances.'}</p>`}
          <p class="robo-rank__nota">${icone('balanca')} <span><b>LC 123:</b> ME/EPP até ${LH.robo.MARGEM_LC123}% acima do 1º colocado (quando ele não é ME/EPP) pode cobrir o lance no desempate.${pref.empate ? ` Limite agora: <strong>${moeda(pref.limite)}</strong>.` : ''}</span></p>`;
      };

      // --- Card do item ---
      const abasFases = (i) => {
        const atual = i.fase && ORDEM_FASE[i.fase] != null ? i.fase : (i.fase === 'encerrada' ? 'habilitacao' : null);
        const nAtual = atual ? ORDEM_FASE[atual] : (i.fase === 'encerrada' ? FASES.length : -1);
        const vista = abaDe.get(i.id) || atual || 'aberta';
        const [, nomeVista, textoVista] = FASES[ORDEM_FASE[vista]];
        const tempo = vista === atual && i.fimEm && emLances(i) ? `<span class="robo-fase__tempo" data-fim="${i.fimEm}">${icone('relogio')} <b>${cronometro(i.fimEm)}</b></span>` : '';
        return `<div class="robo-fases">
          <div class="robo-fases__abas" role="tablist" aria-label="Fases do pregão">
            ${FASES.map(([k, nome], n) => {
              const estado = i.fase === 'encerrada' || n < nAtual ? 'feita' : n === nAtual ? 'atual' : 'futura';
              return `<button type="button" role="tab" class="robo-fase robo-fase--${estado}${k === vista ? ' ativo' : ''}" aria-selected="${k === vista}" data-fase="${k}">${estado === 'feita' ? icone('check') : '<i></i>'}<span>${nome}</span></button>`;
            }).join('')}
          </div>
          <p class="robo-fases__texto"><b>${nomeVista}${vista === atual ? ' · agora' : ''}</b> ${textoVista} ${tempo}</p>
        </div>`;
      };

      const alertaLC123 = (i) => {
        if (i.status === 'idle' && !vivo.ranking(i.id).length) return '';
        const pref = vivo.preferencia(i.id);
        if (!pref.empate) return '';
        const b = pref.beneficiada;
        if (b.autor === 'nos') return `<p class="robo-lc123 robo-lc123--bom">${icone('balanca')} Temos preferência da LC 123: podemos cobrir o 1º colocado no desempate.</p>`;
        if (pref.lider.autor !== 'nos') return '';
        return `<p class="robo-lc123">${icone('alerta')} <span><b>${esc(b.autor)} (${PORTE[b.porte]})</b> está a até ${LH.robo.MARGEM_LC123}% do nosso lance (até ${moeda(pref.limite)}) e poderá cobrir no desempate.${i.fugirEmpate ? ' O robô tenta sair da faixa sem passar do piso.' : ' Ative "fugir do empate ficto" no item para o robô tentar sair da faixa.'}</span></p>`;
      };

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
        let [rotulo, classe] = ROTULO[i.status] || ROTULO.idle;
        if (i.status === 'running' && !emLances(i)) [rotulo, classe] = ['Acompanhando', 'robo-status--acompanha'];
        else if (i.status === 'running' && (i.monitorando || i.real?.modo === 'monitorar')) [rotulo, classe] = ['Monitorando', 'robo-status--acompanha'];
        const vencendo = lidera(i);
        const qtd = i.quantidade || 1;
        const folga = i.nossoLance != null && i.piso ? i.nossoLance - i.piso : null;
        // Margem do preço atual (nosso lance, ou o teto antes do 1º lance) sobre o custo.
        const precoAtual = i.nossoLance ?? i.teto;
        const margem = i.custo != null && precoAtual ? ((precoAtual - i.custo) / precoAtual) * 100 : null;
        const r = vivo.ranking(i.id);
        const nossa = r.find((x) => x.autor === 'nos');
        return `
        <article class="card robo-item ${classe}${vencendo ? ' robo-item--lider' : ''}${foco === i.id ? ' robo-item--foco' : ''}" data-item="${esc(i.id)}">
          <header class="robo-item__topo">
            <div>
              <div class="robo-item__selos">${portais().selo(i.plataforma)}${i.itemNumero ? `<span class="selo">Item ${esc(i.itemNumero)}</span>` : ''}<span class="selo" title="Porte da nossa empresa (LC 123)">Nós: ${PORTE[i.nossoPorte || 'demais']}</span>${i.real ? `<span class="selo-real" title="Conectado ao portal de verdade">${icone('plugue')} REAL · ${i.real.modo === 'lances' ? 'dando lances' : 'monitorando'}${i.real.status === 'iniciando' ? ' · conectando' : ''}</span>` : ''}${i.pregaoRef ? `<span class="selo" title="Pregão no portal">Pregão ${esc(i.pregaoRef)}${i.loteRef ? ` · lote ${esc(i.loteRef)}` : ''}</span>` : ''}</div>
              <h3>${esc(i.descricao)}</h3>
            </div>
            <span class="robo-status ${classe}"><i aria-hidden="true"></i>${rotulo}</span>
          </header>
          ${abasFases(i)}
          <dl class="robo-specs">
            <div><dt>Quantidade</dt><dd>${fmt.numero ? fmt.numero(qtd) : qtd} un</dd></div>
            <div><dt>Unitário inicial (teto)</dt><dd>${moeda(i.teto)}</dd></div>
            <div><dt>Total inicial</dt><dd>${moeda(i.teto * qtd)}</dd></div>
            <div><dt>Nossa posição</dt><dd>${nossa ? `${nossa.posicao}º de ${r.length}` : '—'}</dd></div>
          </dl>
          <div class="robo-placar">
            <div><span>Melhor lance da praça</span><strong>${moeda(i.melhorLance)}</strong><em>${i.melhorLance == null ? 'unitário' : `total ${moeda(i.melhorLance * qtd)}`}</em></div>
            <div class="${i.nossoLance == null ? '' : vencendo ? 'robo-placar--vencendo' : 'robo-placar--coberto'}"><span>Nosso lance</span><strong>${moeda(i.nossoLance)}</strong>
              <em>${i.nossoLance == null ? 'ainda sem lance' : `${vencendo ? 'estamos na frente' : 'fomos cobertos'} · total ${moeda(i.nossoLance * qtd)}`}</em></div>
          </div>
          ${i.status === 'stopped_at_floor' ? `<div class="robo-piso-alerta" role="alert">${icone('escudo')}<div><b>Preço mínimo atingido</b><span>${esc(i.alertaPiso || `Cobrir a praça exigiria ficar abaixo do mínimo de segurança de ${moeda(i.piso)}.`)} O robô parou e não dá mais lances neste item. Ajuste em "Piso e teto" ou pare o robô.</span></div></div>` : ''}
          ${i.piso != null && i.piso === i.teto ? `<p class="robo-monitor-seguro">${icone('escudo')} <span><b>Monitoramento seguro:</b> piso igual ao teto, então o robô não desce de preço. Para disputar, ajuste em <b>Piso e teto</b> (ou <b>Item</b>) com o seu custo e o mínimo.</span></p>` : ''}
          ${alertaLC123(i)}
          ${trilho(i)}
          <dl class="robo-limites">
            <div><dt>Preço teto</dt><dd>${moeda(i.teto)}</dd></div>
            <div><dt>Custo</dt><dd>${moeda(i.custo)}</dd></div>
            <div class="robo-limites__margem${margem != null && margem < 5 ? ' robo-limites__margem--baixa' : ''}"><dt>Margem sobre o custo</dt><dd>${margem == null ? '—' : `${margem.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</dd></div>
            <div class="robo-limites__piso"><dt>Mínimo de segurança</dt><dd>${moeda(i.piso)}</dd></div>
            <div><dt>Folga até o piso</dt><dd>${folga == null ? '—' : moeda(folga)}</dd></div>
          </dl>
          <p class="robo-regras">${icone('info')} ${esc(portais().regras(i.plataforma))}</p>
          <div class="robo-item__acoes">
            ${i.status === 'running'
              ? `<button class="btn btn--pequeno" data-acao="pausar">${icone('relogio')} Pausar</button>`
              : `<button class="btn btn--pequeno btn--primario" data-acao="iniciar">${icone(vivo.modo() === 'real' ? 'plugue' : 'play')} ${i.status === 'paused' ? 'Retomar' : vivo.modo() === 'real' ? 'Conectar ao pregão' : 'Iniciar'}</button>`}
            <button class="btn btn--pequeno" data-acao="parar" ${i.status === 'idle' ? 'disabled' : ''}>${icone('fechar')} Parar</button>
            <button class="btn btn--pequeno btn--fantasma" data-acao="limites">${icone('lapis')} Piso e teto</button>
            <button class="btn btn--pequeno btn--fantasma" data-acao="editar" ${i.status === 'idle' ? '' : 'disabled'}>${icone('engrenagem')} Item</button>
            <button class="btn btn--pequeno btn--fantasma" data-acao="excluir" ${i.status === 'running' ? 'disabled' : ''} aria-label="Excluir item">${icone('lixeira')}</button>
          </div>
        </article>`;
      };

      // Liderança primeiro; o resto mantém a ordem de cadastro.
      const ordemBase = () => new Map(vivo.lista().map((x, k) => [x.id, k]));
      const comparar = (base) => (a, b) => (lidera(a) ? 0 : 1) - (lidera(b) ? 0 : 1) || base.get(a.id) - base.get(b.id);

      /** Reordena os cards com animação (FLIP): quem passa a liderar sobe, quem perde desce. */
      const ordenar = () => {
        const cards = [...caixa.querySelectorAll('[data-item]')];
        if (cards.length < 2) return;
        const base = ordemBase();
        const cmp = comparar(base);
        const desejada = [...cards].sort((x, y) => cmp(item(x.dataset.item), item(y.dataset.item)));
        if (desejada.every((c, k) => c === cards[k])) return;
        const antes = new Map(cards.map((c) => [c, c.getBoundingClientRect().top]));
        desejada.forEach((c) => caixa.append(c));
        if (reduzMovimento()) return;
        desejada.forEach((c) => {
          const dy = antes.get(c) - c.getBoundingClientRect().top;
          if (Math.abs(dy) > 1) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' });
        });
      };

      const desenhar = () => {
        // Sala simulada: só itens de teste. Itens ligados a pregões reais (do feed) ficam no modo real.
        const isRealMode = vivo.modo() === 'real';
        const itens = vivo.lista().filter((x) => isRealMode || x.licitacaoId == null);
        if (!foco || !itens.some((x) => x.id === foco)) foco = (itens.find((x) => x.status === 'running') || itens[0])?.id || null;
        const visiveis = itens.filter((i) => !filtro || i.plataforma === filtro).sort(comparar(ordemBase()));
        if (itens.length && !visiveis.length) {
          caixa.innerHTML = `<div class="card">${LH.vazio('computador', `Nenhum item em ${nomePortal(filtro)}`, 'Escolha outro portal ou cadastre um item neste.', `<button class="btn btn--primario" data-novo>${icone('mais')} Novo item</button>`)}</div>`;
        } else {
          caixa.innerHTML = itens.length ? visiveis.map(cartao).join('')
            : `<div class="card">${LH.vazio('alvo', 'Nenhum item no Robô Turbo 2.0', 'Cadastre um item com a quantidade, o preço teto, o seu custo e o preço mínimo de segurança.', `<button class="btn btn--primario" data-novo>${icone('mais')} Novo item</button>`)}</div>`;
        }
        desenharRanking();
        desenharFoco();
        desenharFeed();
      };
      const focar = (id) => {
        if (!id || id === foco) return;
        const antes = foco;
        foco = id;
        if (antes) redesenhar(antes);
        redesenhar(foco);
        desenharFoco();
        desenharFeed();
      };
      const redesenhar = (id) => {
        const el = caixa.querySelector(`[data-item="${CSS.escape(id)}"]`);
        if (el && item(id)) el.outerHTML = cartao(item(id));
        ordenar();
        if (id === foco) { desenharRanking(); desenharFoco(); }
      };

      // Cronômetro da fase aberta / prorrogação.
      const relogio = setInterval(() => {
        raiz.querySelectorAll('[data-fim]').forEach((el) => { el.querySelector('b').textContent = cronometro(Number(el.dataset.fim)); });
      }, 1000);

      // --- Formulário (novo item, edição e edição rápida dos limites) ---
      const campo = (nome, rotulo, valor, extra = '') => `<label class="campo"><span class="campo__rotulo">${rotulo}</span>
        <input name="${nome}" inputmode="decimal" value="${valor == null ? '' : esc(String(valor).replace('.', ','))}" ${extra}></label>`;
      const lerForm = (janela) => {
        const f = janela.querySelector('form');
        const n = (k) => (f[k] && f[k].value.trim() !== '' ? fmt.lerNumero(f[k].value) : null);
        return {
          descricao: f.descricao?.value.trim(), plataforma: f.plataforma?.value, itemNumero: n('itemNumero'),
          quantidade: Math.max(1, Math.round(n('quantidade') ?? 1)), nossoPorte: f.nossoPorte?.value || 'demais', fugirEmpate: !!f.fugirEmpate?.checked,
          teto: n('teto'), custo: n('custo'), piso: n('piso'), decremento: n('decremento') ?? 0.01, intervaloSeg: n('intervalo') ?? 20,
          sniperSeg: n('sniperSeg') ?? 0, margemMinPct: n('margemMinPct'),
        };
      };
      const porteDaEmpresa = async () => {
        try {
          const p = String((await LH.repo.empresaPerfil?.())?.porte || '').toLowerCase();
          return p === 'me' || p === 'epp' ? p : 'demais';
        } catch { return 'demais'; }
      };
      const abrirForm = async (i = null, soLimites = false, { depois = null } = {}) => {
        const porte = i?.nossoPorte || (soLimites ? 'demais' : await porteDaEmpresa());
        const portalInicial = i?.plataforma || filtro || 'comprasnet';
        LH.modal({
          titulo: soLimites ? 'Piso e teto (vale na hora)' : (i?.id ? 'Editar item' : i ? 'Importar do PNCP para o Robô Turbo 2.0' : 'Novo item no Robô Turbo 2.0'),
          html: `<form class="form" onsubmit="return false">
            ${soLimites ? `<p class="fraco">${esc(i.descricao)}</p>` : `<label class="campo"><span class="campo__rotulo">Descrição do item</span>
              <input name="descricao" maxlength="300" required value="${esc(i?.descricao || '')}" placeholder="ex.: Notebook i5 16 GB"></label>
              <div class="form__linha">
                <label class="campo"><span class="campo__rotulo">Portal da disputa</span>
                  <select name="plataforma">${portais().opcoesAgrupadas(portalInicial)}</select></label>
                ${campo('itemNumero', 'Nº do item/lote', i?.itemNumero)}
              </div>
              <p class="fraco robo-form__regras" data-regras>${esc(portais().regras(portalInicial))}</p>
              <p class="fraco robo-form__suporte" data-suporte>${icone('info')} <span>${esc(portais().oQueFunciona(portalInicial))}</span></p>
              <div class="form__linha">
                ${campo('quantidade', 'Quantidade (un)', i?.quantidade ?? 1, 'required')}
                <label class="campo"><span class="campo__rotulo">Porte da nossa empresa</span>
                  <select name="nossoPorte">${LH.opcoes([['me', 'ME (microempresa)'], ['epp', 'EPP (pequeno porte)'], ['demais', 'Demais empresas']], porte)}</select></label>
              </div>`}
            <div class="form__linha">${campo('teto', 'Preço teto unitário (R$)', i?.teto, 'required')}${soLimites ? '' : campo('custo', 'Custo unitário (R$)', i?.custo)}</div>
            ${campo('piso', 'Preço mínimo de segurança, unitário (R$)', i?.piso, 'required')}
            ${soLimites ? '' : `<div class="form__linha">${campo('decremento', 'Cobrir por (R$)', i?.decremento ?? 0.01)}${campo('intervalo', 'Intervalo entre lances (s)', i?.intervaloSeg ?? 20)}</div>
            <div class="form__linha">${campo('sniperSeg', 'Sniper: lance nos últimos (s)', i?.sniperSeg || '', 'placeholder="0 = desligado"')}${campo('margemMinPct', 'Margem mínima sobre o custo (%)', i?.margemMinPct ?? '', 'placeholder="opcional"')}</div>
            <p class="fraco">Sniper: o robô segura o lance e dispara só nos segundos finais da etapa (descontando o tempo de resposta do portal). Em modo aberto, lance no fim pode prorrogar a disputa. A margem mínima cria um piso automático (custo + margem) que o robô nunca fura.</p>
            <label class="campo campo--check"><input type="checkbox" name="fugirEmpate" ${i?.fugirEmpate ? 'checked' : ''}>
              <span>Fugir do empate ficto: se uma ME/EPP ficar até 5% acima do nosso lance, descer só o necessário para sair da faixa (nunca abaixo do piso). Só vale quando a nossa empresa não é ME/EPP.</span></label>
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
                if (i?.id) vivo.atualizarLimites(i.id, { piso: dados.piso, teto: dados.teto });
                const salvo = await LH.repo.salvarRoboItem(dados);
                if (i?.id) {
                  const { id, status, nossoLance, melhorLance, fase, ...campos } = salvo;
                  vivo.atualizar(i.id, campos);
                } else {
                  foco = salvo.id;
                  vivo.adicionar(salvo);
                  requestAnimationFrame(() => caixa.querySelector(`[data-item="${CSS.escape(salvo.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                }
                fechar();
                LH.aviso(soLimites ? 'Limites atualizados. O robô já usa os valores novos.' : 'Item salvo.', 'sucesso');
                depois?.(item(i?.id || salvo.id) || salvo);
              } catch (e) { caixaErro.textContent = e.message; caixaErro.hidden = false; }
            } },
          ],
        });
        // O texto das regras acompanha o portal escolhido.
        const sel = document.querySelector('.modal select[name="plataforma"], dialog select[name="plataforma"]');
        sel?.addEventListener('change', () => {
          const alvo = sel.closest('form')?.querySelector('[data-regras]');
          if (alvo) alvo.textContent = portais().regras(sel.value);
          const sup = sel.closest('form')?.querySelector('[data-suporte] span');
          if (sup) sup.textContent = portais().oQueFunciona(sel.value);
        });
      };

      // --- Modo da sala (simulada x real) ---
      let sincronizarFeed = () => {}; // definido junto com o feed, mais abaixo
      const desenharModo = () => {
        const m = vivo.modo();
        raiz.querySelectorAll('[data-modo]').forEach((b) => {
          b.classList.toggle('ativo', b.dataset.modo === m);
          b.setAttribute('aria-checked', String(b.dataset.modo === m));
        });
        raiz.querySelector('[data-aviso-real]').hidden = m !== 'real';
        sincronizarFeed();
        if (carregado) desenhar(); // os botões mudam de "Iniciar" para "Conectar ao pregão"
      };
      desenharModo();
      LH.ao(raiz, 'click', '[data-modo]', (e, b) => {
        if (!vivo.mudarModo(b.dataset.modo)) LH.aviso('Pare todos os robôs (ativos ou pausados) antes de trocar o modo da sala.', 'alerta');
      });

      // --- Eventos ---
      LH.ao(raiz, 'click', '[data-novo]', () => abrirForm());
      LH.ao(raiz, 'click', '[data-cofre]', () => LH.roboReal?.abrirCofre());
      LH.ao(raiz, 'click', '[data-alertas]', () => abrirAlertas());

      // Alertas preditivos por e-mail (o da conta). Cada pessoa liga para si;
      // quem recebe é quem conectou o robô ao pregão.
      async function abrirAlertas() {
        let atual;
        try { atual = await LH.repo.alertasRobo(); } catch (e) { LH.aviso(e.message, 'perigo'); return; }
        LH.modal({
          titulo: 'Alertas do Robô Turbo 2.0',
          html: `<form class="form" onsubmit="return false">
            <p>Durante a disputa no modo real, o robô avisa quando a <strong>chance de vitória</strong> muda de forma relevante, com o <strong>fechamento previsto</strong> e a <strong>margem estimada</strong>.</p>
            <label class="campo campo--check"><input type="checkbox" name="email" ${atual.email ? 'checked' : ''}>
              <span><strong>Por e-mail</strong> · ${esc(atual.enderecoEmail || 'e-mail da sua conta')}</span></label>
            <p class="fraco">Os alertas são uma estimativa estatística, não garantia de resultado. Chegam só as mudanças mais importantes, para não lotar a caixa de entrada.</p>
            <p class="texto-perigo" data-erro hidden></p>
          </form>`,
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            { rotulo: 'Salvar', classe: 'btn--primario', acao: async (fechar, janela) => {
              const f = janela.querySelector('form');
              const erro = janela.querySelector('[data-erro]');
              try {
                await LH.repo.salvarAlertasRobo({ email: f.email.checked });
                marcarOrbe(f.email.checked);
                LH.aviso(f.email.checked ? 'Alertas por e-mail ligados.' : 'Alertas por e-mail desligados.', 'sucesso');
                fechar();
              } catch (e) { erro.textContent = e.message; erro.hidden = false; }
            } },
          ],
        });
      }

      LH.ao(raiz, 'click', '[data-status-portais]', () => abrirStatusPortais());
      // Situação dos portais vinda do servidor: portal validado sobe para "Pronto" sozinho.
      if (LH.repo?.modo === 'real' && LH.plano?.permite?.('robo')) {
        LH.roboReal?.estadoServidor?.().then((est) => {
          portais().atualizarServidor(est?.portais);
          const caixaChips = raiz.querySelector('[data-chips-portais]');
          if (!caixaChips) return;
          caixaChips.innerHTML = chipsPortais();
          caixaChips.querySelectorAll('[data-portal]').forEach((x) => x.classList.toggle('ativo', x.dataset.portal === filtro));
        }).catch(() => {});
      }
      LH.ao(raiz, 'click', '[data-portal]', (e, b) => {
        filtro = b.dataset.portal;
        raiz.querySelectorAll('[data-portal]').forEach((x) => x.classList.toggle('ativo', x === b));
        desenhar();
        feed?.desenhar();
      });
      LH.ao(raiz, 'click', '[data-painel]', (e, b) => {
        raiz.querySelectorAll('[data-painel]').forEach((x) => { x.classList.toggle('ativo', x === b); x.setAttribute('aria-selected', String(x === b)); });
        raiz.querySelectorAll('[data-painel-corpo]').forEach((p) => { p.hidden = p.dataset.painelCorpo !== b.dataset.painel; });
        if (b.dataset.painel === 'feed') chat.scrollTop = chat.scrollHeight;
      });
      LH.ao(caixa, 'click', '[data-fase]', (e, b) => {
        const id = b.closest('[data-item]').dataset.item;
        abaDe.set(id, b.dataset.fase);
        redesenhar(id);
      });
      // Clicar no card põe o item em foco no ranking.
      caixa.addEventListener('click', (e) => {
        const card = e.target.closest('[data-item]');
        if (!card || e.target.closest('button')) return;
        focar(card.dataset.item);
      });
      LH.ao(raiz, 'click', '[data-feed]', (e, b) => {
        feedTodos = b.dataset.feed === 'todos';
        raiz.querySelectorAll('[data-feed]').forEach((x) => x.classList.toggle('ativo', x === b));
        desenharFeed();
      });
      LH.ao(raiz, 'click', '[data-foco-acao]', (e, b) => {
        const i = foco && item(foco);
        if (!i) return;
        if (b.dataset.focoAcao === 'pausar') vivo.pausar(i.id);
        else { if (i.status !== 'paused') abaDe.delete(i.id); vivo.iniciar(i.id, nomePortal(i.plataforma)); }
      });
      LH.ao(caixa, 'click', '[data-acao]', async (e, botao) => {
        const i = item(botao.closest('[data-item]').dataset.item);
        switch (botao.dataset.acao) {
          case 'iniciar':
            if (i.status !== 'paused') abaDe.delete(i.id);
            focar(i.id);
            vivo.iniciar(i.id, nomePortal(i.plataforma));
            break;
          case 'pausar': vivo.pausar(i.id); break;
          case 'parar': vivo.parar(i.id); break;
          case 'limites': abrirForm(i, true); break;
          case 'editar': abrirForm(i); break;
          case 'excluir':
            if (!(await LH.confirmar('Excluir item', `Excluir "${i.descricao}" do Robô Turbo 2.0?`, 'Excluir', true))) return;
            try { await vivo.remover(i.id); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
            break;
          default:
        }
      });

      // --- Feed global de pregões ao vivo ---
      const CHAVES_ROBO = new Set(portais().lista().map((p) => p.chave));
      const itemDaLicitacao = (l) => vivo.lista().find((x) => x.licitacaoId != null && String(x.licitacaoId) === String(l.id)) || null;
      const doFeed = (l, { comPiso }) => ({
        descricao: `${l.edital ? `Pregão ${l.edital} · ` : ''}${l.objeto}`.slice(0, 300),
        plataforma: CHAVES_ROBO.has(LH.roboFeed.chaveDoPortal(l)) ? LH.roboFeed.chaveDoPortal(l) : 'outros',
        licitacaoId: l.id, pregaoRef: l.edital || l.numero, quantidade: 1, nossoPorte: 'demais',
        teto: l.valor > 0 ? l.valor : null, piso: comPiso && l.valor > 0 ? l.valor : null, custo: null, decremento: 0.01, intervaloSeg: 20,
      });
      const rolarAte = (id) => requestAnimationFrame(() => caixa.querySelector(`[data-item="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      const comecar = (i, { monitorar }) => {
        focar(i.id);
        rolarAte(i.id);
        if (['running', 'paused', 'stopped_at_floor'].includes(i.status) && i.status !== 'paused') return;
        vivo.iniciar(i.id, nomePortal(i.plataforma), monitorar ? { pedido: { pregao: i.pregaoRef || String(i.licitacaoId), lote: i.loteRef || undefined, modo: 'monitorar' } } : {});
      };
      const monitorar = async (l) => {
        const existente = itemDaLicitacao(l);
        if (existente) { comecar(existente, { monitorar: true }); return; }
        if (!(Number(l.valor) > 0)) {
          LH.aviso('Este pregão não informa o valor estimado (sigiloso): informe o teto para o robô acompanhar.', 'info', 6000);
          abrirForm(doFeed(l, { comPiso: false }), false, { depois: (i) => comecar(i, { monitorar: true }) });
          return;
        }
        try {
          const salvo = await LH.repo.salvarRoboItem(doFeed(l, { comPiso: true }));
          foco = salvo.id;
          vivo.adicionar(salvo);
          comecar(vivo.item(salvo.id) || salvo, { monitorar: true });
        } catch (e) { LH.aviso(e.message, 'perigo'); }
      };
      const conectar = (l) => {
        if (vivo.modo() !== 'real' && !vivo.mudarModo('real')) {
          LH.aviso('Pare todos os robôs da sala simulada antes de conectar ao modo real.', 'alerta');
          return;
        }
        const existente = itemDaLicitacao(l);
        const seguir = (i) => comecar(i, { monitorar: false });
        if (existente && existente.piso !== existente.teto) { seguir(existente); return; }
        LH.aviso('Informe o seu custo e o preço mínimo de segurança. Ao salvar, o robô segue para o cofre e a conexão com o portal.', 'info', 7000);
        abrirForm(existente || doFeed(l, { comPiso: false }), false, { depois: seguir });
      };
      let sinalFeed = '';
      let feed = null;
      const caixaFeed = raiz.querySelector('#feed-vivo');
      // O feed de pregões REAIS só existe no Modo real. Na sala simulada fica escondido e
      // parado (sem consultar a base): lá aparecem só os itens e lances fictícios de teste.
      sincronizarFeed = () => {
        const isRealMode = vivo.modo() === 'real';
        caixaFeed.hidden = !isRealMode;
        if (isRealMode && !feed) {
          feed = LH.roboFeed?.ligar(caixaFeed, { filtro: () => filtro, itemDe: itemDaLicitacao, aoMonitorar: monitorar, aoConectar: conectar }) || null;
        } else if (!isRealMode && feed) {
          feed.parar();
          feed = null;
          caixaFeed.innerHTML = '';
        }
      };
      sincronizarFeed();

      // A tela só "ouve" o estado global. Ao sair, deixa de ouvir: os robôs continuam
      // rodando e aparecem no mini player flutuante (js/robo-ao-vivo.js).
      const deixarDeOuvir = vivo.ouvir((tipo, dado) => {
        if (!carregado) return;
        if (tipo === 'item') {
          // Mudou a fase: as abas voltam a seguir a fase atual.
          const i = item(dado);
          if (i && abaDe.has(dado) && abaDe.get(dado) !== i.fase && i.fase && (ORDEM_FASE[abaDe.get(dado)] ?? 0) < (ORDEM_FASE[i.fase] ?? 0)) abaDe.delete(dado);
          redesenhar(dado);
        } else if (tipo === 'lista') desenhar();
        else if (tipo === 'modo') desenharModo();
        if (tipo === 'item' || tipo === 'lista') {
          const sinal = vivo.lista().filter((x) => x.licitacaoId != null).map((x) => `${x.id}:${x.status}`).join('|');
          if (sinal !== sinalFeed) { sinalFeed = sinal; feed?.desenhar(); }
        }
        else if (tipo === 'chat') falarNaTela(dado);
      });
      vivo.carregar()
        .then(() => {
          carregado = true;
          desenhar();
          // Veio do "Importar para o Robô Turbo 2.0" da busca no PNCP: abre o cadastro preenchido.
          if (LH.roboImportar) {
            const pre = LH.roboImportar;
            LH.roboImportar = null;
            abrirForm(pre);
            LH.aviso(pre.teto ? 'Dados do PNCP preenchidos. Informe o custo e o preço mínimo de segurança.' : 'Dados do PNCP preenchidos. O valor estimado é sigiloso: informe o teto, o custo e o mínimo.', 'info', 7000);
          }
        })
        .catch((e) => { caixa.innerHTML = LH.erroHtml(e); });

      return () => { deixarDeOuvir(); clearInterval(relogio); feed?.parar(); };
    },
  };
}());
