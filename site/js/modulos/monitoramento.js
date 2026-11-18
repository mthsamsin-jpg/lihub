/* =============================================================================
   Uso LicitaHub · Monitoramento
   Monitoramento de Chat (mensagens do pregoeiro, com alertas) e
   Cadastro Comprasnet (o que monitorar, sem guardar senha do gov.br).
   No modo real, a configuração fica no banco (tabela monitoramentos).
   As mensagens do chat ainda são simuladas.
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone } = LH;
  const AVISO_PUBLICO = 'O Uso LicitaHub acompanha só as mensagens públicas da sessão. Não pedimos nem guardamos a sua senha do gov.br.';
  const normalizar = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // --- Monitoramento de Chat ----------------------------------------------------------
  LH.vistas.chat = {
    titulo: 'Monitoramento de Chat',
    local: 'As mensagens do chat ainda são simuladas: a leitura das sessões públicas do Compras.gov.br entra numa próxima etapa. As palavras de alerta já ficam salvas na sua conta.',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Monitoramento de Chat',
        texto: 'Acompanhe as mensagens do pregoeiro em tempo real e receba um alerta quando citarem a sua empresa ou pedirem um anexo.',
        acoes: `<button class="btn" type="button" data-acao="simular">${icone('chat')} Simular mensagem</button>`,
      })}
      <p class="nota" data-reveal style="margin-bottom:18px">${icone('escudo')} ${AVISO_PUBLICO}</p>
      <div class="grade grade--lateral">
        <section class="card spot" data-reveal id="painel-chat"></section>
        <aside class="grade" style="align-content:start">
          <section class="card" data-reveal>
            <div class="card__titulo"><h2>${icone('alvo')} Sessões monitoradas</h2></div>
            <div class="lista" id="sessoes"></div>
          </section>
          <section class="card" data-reveal>
            <div class="card__titulo"><h2>${icone('sino')} Alertas</h2></div>
            <div class="form">
              <label class="chave"><input type="checkbox" id="alerta-pc"> ${icone('computador')} Notificação no computador</label>
              <label class="chave"><input type="checkbox" id="alerta-tg"> ${icone('telegram')} Telegram</label>
              <div class="campo"><span class="campo__rotulo">Palavras que disparam alerta</span>
                <div class="chips" id="palavras">${LH.carregando()}</div>
                <div style="display:flex;gap:8px;margin-top:6px"><input id="nova-palavra" maxlength="60" placeholder="ex.: diligência"><button class="btn btn--pequeno" type="button" data-acao="palavra">${icone('mais')}</button></div>
              </div>
            </div>
          </section>
        </aside>
      </div>`,
    montar(raiz) {
      // Cópia das sessões de exemplo; novas mensagens ficam só nesta visita.
      const sessoes = JSON.parse(JSON.stringify(LH.dados.sessoesChat));
      let atual = sessoes[0].id;
      let cfg = { palavras: [] };
      const alertas = LH.estado.obter('alertasChat'); // preferência deste computador
      const pc = raiz.querySelector('#alerta-pc');
      const tg = raiz.querySelector('#alerta-tg');
      pc.checked = alertas.computador && 'Notification' in window && Notification.permission === 'granted';
      tg.checked = alertas.telegram;

      const temAlerta = (texto) => cfg.palavras.some((p) => p && normalizar(texto).includes(normalizar(p)));
      /** Destaca as palavras de alerta no texto (o texto já sai escapado). */
      const destacar = (texto) => {
        let html = esc(texto);
        for (const p of cfg.palavras) {
          if (!p) continue;
          const alvo = esc(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          html = html.replace(new RegExp(`(${alvo})`, 'gi'), '<mark>$1</mark>');
        }
        return html;
      };

      const desenharSessoes = () => {
        raiz.querySelector('#sessoes').innerHTML = sessoes.map((s) => {
          const l = LH.dados.licitacao(s.licitacaoId);
          const selo = { 'Em disputa': 'selo--sucesso', Suspensa: 'selo--alerta' }[s.status] || '';
          return `
            <button type="button" class="lista__item sessao ${s.id === atual ? 'ativa' : ''}" data-sessao="${s.id}" style="text-align:left;width:100%">
              <span class="lista__icone">${icone('chat')}</span>
              <span class="lista__texto"><strong>${esc(l.objeto)}</strong><span>${esc(l.numero)} · ${esc(l.orgao)}</span></span>
              <span class="selo ${selo}">${esc(s.status)}</span>
            </button>`;
        }).join('');
      };
      const desenharChat = (nova) => {
        const s = sessoes.find((x) => x.id === atual);
        const l = LH.dados.licitacao(s.licitacaoId);
        raiz.querySelector('#painel-chat').innerHTML = `
          <div class="card__titulo">
            <div><h2>${icone('chat')} ${esc(l.numero)}</h2><p class="fraco" style="margin-top:4px">${esc(l.objeto)}</p></div>
            ${s.status === 'Em disputa' ? '<span class="ao-vivo">Ao vivo</span>' : `<span class="selo">${esc(s.status)}</span>`}
          </div>
          <div class="chat" id="mensagens">
            ${s.mensagens.map(([hora, autor, texto], i) => `
              <div class="chat__msg ${temAlerta(texto) ? 'chat__msg--alerta' : ''} ${nova && i === s.mensagens.length - 1 ? 'chat__msg--nova' : ''}">
                <header><strong>${esc(autor)}</strong><span>${esc(hora)}</span></header>
                <p>${destacar(texto)}</p>
              </div>`).join('')}
          </div>`;
        const caixa = raiz.querySelector('#mensagens');
        caixa.scrollTop = caixa.scrollHeight;
      };
      const desenharPalavras = () => {
        raiz.querySelector('#palavras').innerHTML = cfg.palavras.length ? cfg.palavras.map((p, i) =>
          `<span class="chip">${esc(p)}<button type="button" data-tirar-palavra="${i}" aria-label="Tirar ${esc(p)}">×</button></span>`).join('')
          : '<span class="fraco">Nenhuma palavra ainda.</span>';
      };
      const salvarPalavras = async () => {
        try {
          await LH.repo.salvarMonitoramento(cfg);
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        desenharPalavras();
        desenharChat();
      };

      const novaMensagem = () => {
        const s = sessoes.find((x) => x.status === 'Em disputa') || sessoes[0];
        const [autor, texto] = LH.dados.mensagensSimuladas[Math.floor(Math.random() * LH.dados.mensagensSimuladas.length)];
        const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        s.mensagens.push([hora, autor, texto]);
        if (s.id === atual) desenharChat(true);
        if (temAlerta(texto)) {
          const l = LH.dados.licitacao(s.licitacaoId);
          LH.aviso(`Alerta no chat (${l.numero}): ${texto}`, 'alerta', 7000);
          if (pc.checked) LH.notificar(`Chat do pregão ${l.numero}`, texto);
        }
      };

      LH.ao(raiz, 'click', '[data-sessao]', (e, b) => { atual = b.dataset.sessao; desenharSessoes(); desenharChat(); });
      LH.ao(raiz, 'click', '[data-acao]', (e, b) => {
        if (b.dataset.acao === 'simular') novaMensagem();
        if (b.dataset.acao === 'palavra') {
          const campo = raiz.querySelector('#nova-palavra');
          const p = campo.value.trim();
          if (!p) return;
          if (!cfg.palavras.some((x) => normalizar(x) === normalizar(p))) cfg.palavras = [...cfg.palavras, p];
          campo.value = '';
          salvarPalavras();
        }
      });
      LH.ao(raiz, 'click', '[data-tirar-palavra]', (e, b) => {
        cfg.palavras = cfg.palavras.filter((_, i) => i !== Number(b.dataset.tirarPalavra));
        salvarPalavras();
      });
      raiz.querySelector('#nova-palavra').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); raiz.querySelector('[data-acao="palavra"]').click(); }
      });
      pc.addEventListener('change', async () => {
        if (pc.checked) {
          if (!('Notification' in window)) { pc.checked = false; return LH.aviso('Este navegador não mostra notificações.', 'alerta'); }
          pc.checked = (await Notification.requestPermission()) === 'granted';
          if (!pc.checked) LH.aviso('O navegador não deu permissão para notificações.', 'alerta');
          else LH.notificar('Uso LicitaHub', 'Alertas do chat ligados neste computador.');
        }
        LH.estado.salvar('alertasChat', { ...LH.estado.obter('alertasChat'), computador: pc.checked });
      });
      tg.addEventListener('change', () => {
        LH.estado.salvar('alertasChat', { ...LH.estado.obter('alertasChat'), telegram: tg.checked });
        if (tg.checked) {
          LH.modal({
            titulo: 'Alertas no Telegram',
            html: '<p>Na versão final você conecta o Telegram em dois passos: abre o robô do Uso LicitaHub pelo link do painel e envia o código que aparece aqui. A partir daí os alertas chegam no seu celular.</p><p class="fraco">Ainda não está ativo.</p>',
          });
        }
      });

      desenharSessoes();
      desenharChat();
      LH.repo.monitoramento().then((c) => { cfg = c; desenharPalavras(); desenharChat(); })
        .catch((e) => { raiz.querySelector('#palavras').innerHTML = LH.erroHtml(e); });
      // Simula a chegada de mensagens enquanto a tela está aberta.
      const relogio = setInterval(novaMensagem, 20000);
      return () => clearInterval(relogio); // o roteador chama ao sair da tela
    },
  };

  // --- Cadastro Comprasnet -------------------------------------------------------------
  LH.vistas.comprasnet = {
    titulo: 'Cadastro Comprasnet',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Cadastro Comprasnet',
        texto: 'Diga quais pregões do Compras.gov.br (antigo Comprasnet) o Uso LicitaHub deve acompanhar para você.',
      })}
      <p class="nota" data-reveal style="margin-bottom:18px">${icone('cadeado')} ${AVISO_PUBLICO} A integração usa o CNPJ e o número de cada pregão, que são informações públicas.</p>
      <div class="grade grade--lateral">
        <form class="card spot form" id="form-cn" data-reveal autocomplete="off">
          <div class="card__titulo"><h2>${icone('plugue')} Integração</h2><span class="selo selo--sucesso">${icone('check')} Por dados públicos</span></div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">CNPJ do fornecedor</span><input name="cnpj" placeholder="00.000.000/0000-00"></label>
            <label class="campo"><span class="campo__rotulo">Nome como aparece no sistema</span><input name="nome" maxlength="200"></label>
          </div>
          <div class="campo"><span class="campo__rotulo">Pregões monitorados</span>
            <div class="tabela-rolagem"><table class="tabela"><thead><tr><th>UASG</th><th>Número</th><th>Ano</th><th></th></tr></thead><tbody id="pregoes"><tr><td colspan="4">${LH.carregando()}</td></tr></tbody></table></div>
          </div>
          <div class="form__linha" style="align-items:end">
            <label class="campo"><span class="campo__rotulo">UASG</span><input id="uasg" inputmode="numeric" maxlength="6" placeholder="ex.: 160001"></label>
            <label class="campo"><span class="campo__rotulo">Nº do pregão</span><input id="numero" inputmode="numeric" placeholder="ex.: 90012"></label>
            <label class="campo"><span class="campo__rotulo">Ano</span><input id="ano" inputmode="numeric" maxlength="4" value="${new Date().getFullYear()}"></label>
            <button class="btn" type="button" data-acao="pregao">${icone('mais')} Incluir</button>
          </div>
          <button class="btn btn--primario" type="submit" style="justify-self:start">Salvar integração</button>
        </form>
        <aside class="card card--vidro" data-reveal style="align-self:start;padding:22px">
          <h2 style="font-size:1rem;margin-bottom:10px">Como funciona</h2>
          <ol class="suave" style="margin-left:18px;display:grid;gap:8px">
            <li>Você informa o CNPJ e os pregões.</li>
            <li>O Uso LicitaHub acompanha as mensagens públicas da sessão.</li>
            <li>Quando o pregoeiro citar a sua empresa ou pedir anexo, você recebe o alerta.</li>
          </ol>
          <a class="btn btn--bloco" href="#/chat" style="margin-top:16px">${icone('chat')} Abrir o monitoramento</a>
        </aside>
      </div>`,
    montar(raiz) {
      const form = raiz.querySelector('#form-cn');
      let cfg = { cnpj: '', nome: '', pregoes: [], palavras: [] };
      const desenhar = () => {
        raiz.querySelector('#pregoes').innerHTML = cfg.pregoes.length ? cfg.pregoes.map((p, i) => `
          <tr><td>${esc(p.uasg)}</td><td>${esc(p.numero)}</td><td>${esc(p.ano)}</td>
          <td><button class="btn-icone btn-icone--pequeno" type="button" data-tirar="${i}" aria-label="Tirar pregão">${icone('lixeira')}</button></td></tr>`).join('')
          : '<tr><td colspan="4" class="fraco">Nenhum pregão ainda.</td></tr>';
      };
      LH.repo.monitoramento().then((c) => {
        cfg = { ...cfg, ...c, pregoes: c.pregoes || [], palavras: c.palavras || [] };
        form.cnpj.value = LH.cnpj.mascara(cfg.cnpj);
        form.nome.value = cfg.nome || '';
        desenhar();
      }).catch((e) => { raiz.querySelector('#pregoes').innerHTML = `<tr><td colspan="4">${LH.erroHtml(e)}</td></tr>`; });

      form.cnpj.addEventListener('input', () => { form.cnpj.value = LH.cnpj.mascara(form.cnpj.value); });
      LH.ao(raiz, 'click', '[data-acao="pregao"]', () => {
        const uasg = raiz.querySelector('#uasg').value.replace(/\D/g, '');
        const numero = raiz.querySelector('#numero').value.replace(/\D/g, '');
        const ano = raiz.querySelector('#ano').value.replace(/\D/g, '');
        if (uasg.length < 5 || !numero || ano.length !== 4) return LH.aviso('Preencha UASG (5 ou 6 dígitos), número e ano.', 'alerta');
        if (cfg.pregoes.some((p) => p.uasg === uasg && p.numero === numero && p.ano === ano)) return LH.aviso('Este pregão já está na lista.', 'info');
        cfg.pregoes = [...cfg.pregoes, { uasg, numero, ano }];
        raiz.querySelector('#uasg').value = '';
        raiz.querySelector('#numero').value = '';
        desenhar();
        LH.aviso('Pregão incluído. Clique em "Salvar integração" para guardar.', 'info');
      });
      LH.ao(raiz, 'click', '[data-tirar]', (e, b) => {
        cfg.pregoes = cfg.pregoes.filter((_, i) => i !== Number(b.dataset.tirar));
        desenhar();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (form.cnpj.value && !LH.cnpj.valido(form.cnpj.value)) return LH.aviso('CNPJ inválido: confira os números.', 'alerta');
        const botao = form.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          cfg = { ...cfg, cnpj: LH.cnpj.limpar(form.cnpj.value), nome: form.nome.value.trim() };
          await LH.repo.salvarMonitoramento(cfg);
          LH.aviso('Integração salva.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        botao.disabled = false;
      });
    },
  };
})();
