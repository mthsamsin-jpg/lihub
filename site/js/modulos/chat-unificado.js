/* =============================================================================
   Uso LicitaHub · Chat Unificado Multiportal (caixa de entrada)
   Todas as mensagens das salas de disputa num lugar só, de qualquer portal:
   - sessões do Robô Turbo 2.0 em modo real (BLL, BNC, BBMNET, Compras.gov.br...);
   - leitura pública dos pregões cadastrados (Compras.gov.br, quando validada).
   Destaca o que importa (citou a sua empresa, convocação, anexo, prazo,
   suspensão), avisa no computador e manda para o webhook (Discord/Slack).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone, fmt } = LH;
  const PORTAIS = { comprasnet: 'Compras.gov.br', bll: 'BLL', bnc: 'BNC', pcp: 'Portal de Compras Públicas', bbmnet: 'BBMNET', licitanet: 'Licitanet' };
  const GATILHOS = {
    mencao_cnpj: ['Citou o seu CNPJ', 'perigo'], mencao_nome: ['Citou a sua empresa', 'perigo'], convocacao: ['Convocação', 'alerta'],
    anexo: ['Anexo/documento', 'alerta'], prazo: ['Prazo', 'info'], suspensao: ['Suspensão/reabertura', 'alerta'],
    resultado: ['Resultado', 'info'], palavra: ['Palavra de alerta', 'info'],
  };
  const hora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const chaveSala = (m) => `${m.portal}|${m.compra_ref}`;

  LH.chatUnificado = {
    render: () => `
      ${LH.cabecalho({
        titulo: 'Monitoramento de Chat',
        texto: 'Caixa de entrada única das salas de disputa de todos os portais. O que cita a sua empresa, convoca, pede anexo ou dá prazo aparece em destaque.',
        acoes: `<a class="btn" href="#/comprasnet">${icone('mais')} Cadastrar pregões</a>`,
      })}
      <p class="nota" data-reveal style="margin-bottom:18px">${icone('escudo')} As mensagens chegam pela leitura pública dos pregões cadastrados e pelas salas que o Robô Turbo 2.0 acompanha com a sua conta. Não pedimos a senha do gov.br.</p>
      <div class="grade grade--lateral chat-unificado">
        <section class="card spot" data-reveal>
          <div class="card__titulo">
            <h2>${icone('chat')} Caixa de entrada <span class="selo" id="nao-lidas"></span></h2>
            <span class="chips">
              <label class="chave"><input type="checkbox" id="so-relevantes" checked> Só o que importa</label>
              <select id="filtro-portal" aria-label="Portal"><option value="">Todos os portais</option>${Object.entries(PORTAIS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
              <button class="btn btn--pequeno" type="button" data-acao="ler-tudo">${icone('check')} Marcar tudo como lido</button>
            </span>
          </div>
          <div class="chat-caixa" id="caixa" aria-live="polite">${LH.carregando('Carregando as mensagens...')}</div>
        </section>
        <aside class="grade" style="align-content:start">
          <section class="card" data-reveal>
            <div class="card__titulo"><h2>${icone('sino')} Alertas</h2></div>
            <form class="form" id="form-alertas" autocomplete="off">
              <label class="chave"><input type="checkbox" id="alerta-pc"> ${icone('computador')} Notificação neste computador</label>
              <label class="campo"><span class="campo__rotulo">Webhook (Discord, Slack ou outro)</span>
                <input name="webhook" type="url" placeholder="https://discord.com/api/webhooks/..."></label>
              <label class="campo"><span class="campo__rotulo">Outros nomes da empresa (separe por vírgula)</span>
                <input name="nomes" placeholder="ex.: nome fantasia, sigla"></label>
              <p class="fraco">O CNPJ, a razão social e o nome fantasia das empresas cadastradas já entram sozinhos. As palavras de alerta ficam no <a href="#/comprasnet">Cadastro Comprasnet</a>.</p>
              <button class="btn btn--primario" type="submit">Salvar alertas</button>
            </form>
          </section>
          <section class="card" data-reveal>
            <div class="card__titulo"><h2>${icone('plugue')} Portais</h2></div>
            <ul class="lista-portais" id="portais"><li class="fraco">Carregando...</li></ul>
          </section>
        </aside>
      </div>`,

    montar(raiz) {
      const caixa = raiz.querySelector('#caixa');
      const soRelevantes = raiz.querySelector('#so-relevantes');
      const filtroPortal = raiz.querySelector('#filtro-portal');
      const pc = raiz.querySelector('#alerta-pc');
      const form = raiz.querySelector('#form-alertas');
      let mensagens = [];
      let cfg = {};
      pc.checked = LH.estado.obter('alertasChat')?.computador && 'Notification' in window && Notification.permission === 'granted';

      const selos = (m) => (m.gatilhos || []).map((g) => GATILHOS[g]).filter(Boolean)
        .map(([t, c]) => `<span class="selo selo--${c}">${esc(t)}</span>`).join('');
      const marcar = (texto) => {
        const termos = [cfg.cnpj, cfg.nome, ...(cfg.nomes_alerta || []), ...(cfg.palavras || [])].filter((t) => t && String(t).length >= 3);
        return LH.termos.destacar(texto, termos.map((t) => LH.termos.grupos(t)[0] || []).filter((g) => g.length));
      };
      const desenhar = () => {
        const lista = mensagens.filter((m) => (!soRelevantes.checked || m.relevante) && (!filtroPortal.value || m.portal === filtroPortal.value));
        const naoLidas = mensagens.filter((m) => m.relevante && !m.lida).length;
        raiz.querySelector('#nao-lidas').textContent = naoLidas ? `${naoLidas} não lida(s)` : '';
        if (!lista.length) {
          caixa.innerHTML = LH.vazio('chat', soRelevantes.checked ? 'Nada importante por enquanto' : 'Nenhuma mensagem ainda',
            'Cadastre os pregões no Cadastro Comprasnet ou conecte o Robô Turbo 2.0 a uma sala (modo monitorar).');
          return;
        }
        // Agrupa por sala (portal + pregão), a mais recente primeiro.
        const salas = new Map();
        for (const m of lista) { if (!salas.has(chaveSala(m))) salas.set(chaveSala(m), []); salas.get(chaveSala(m)).push(m); }
        caixa.innerHTML = [...salas.values()].map((ms) => `
          <article class="chat-sala">
            <header class="chat-sala__topo"><strong>${esc(PORTAIS[ms[0].portal] || ms[0].portal)}</strong> · pregão ${esc(ms[0].compra_ref)}</header>
            ${ms.map((m) => `
              <div class="chat__msg ${m.relevante ? 'chat__msg--alerta' : ''} ${m.lida ? '' : 'chat__msg--nao-lida'}" data-msg="${m.id}">
                <header><strong>${esc(m.autor || 'Pregoeiro')}</strong><span>${hora(m.enviada_em)}${m.fonte === 'robo' ? ' · via robô' : ''}</span></header>
                <p>${marcar(m.texto)}</p>
                ${m.gatilhos?.length ? `<div class="chips">${selos(m)}</div>` : ''}
                ${m.relevante && !m.lida ? `<button type="button" class="link-botao" data-lida="${m.id}">${icone('check')} Marcar como lida</button>` : ''}
              </div>`).join('')}
          </article>`).join('');
      };
      const carregar = async () => {
        try {
          mensagens = await LH.repo.chatMensagens({ limite: 400 });
          desenhar();
        } catch (e) { caixa.innerHTML = LH.erroHtml(e); }
      };

      // Configuração dos alertas.
      LH.repo.monitoramento().then((c) => {
        cfg = c || {};
        form.webhook.value = cfg.webhook_url || '';
        form.nomes.value = (cfg.nomes_alerta || []).join(', ');
        desenhar();
      }).catch(() => {});
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          cfg = { ...cfg, webhook_url: form.webhook.value.trim(), nomes_alerta: form.nomes.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) };
          await LH.repo.salvarMonitoramento(cfg);
          LH.aviso('Alertas salvos.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      pc.addEventListener('change', async () => {
        if (pc.checked) {
          if (!('Notification' in window)) { pc.checked = false; return LH.aviso('Este navegador não mostra notificações.', 'alerta'); }
          pc.checked = (await Notification.requestPermission()) === 'granted';
          if (!pc.checked) LH.aviso('O navegador não deu permissão para notificações.', 'alerta');
        }
        LH.estado.salvar('alertasChat', { ...LH.estado.obter('alertasChat'), computador: pc.checked });
      });

      // Situação dos conectores por portal.
      LH.repo.chatSituacao().then((s) => {
        const ul = raiz.querySelector('#portais');
        if (!s?.conectores) { ul.innerHTML = '<li class="fraco">Indisponível agora.</li>'; return; }
        ul.innerHTML = s.conectores.map((c) => {
          const ativo = c.publico && (c.validado || s.permitirNaoValidados);
          return `<li><strong>${esc(c.nome)}</strong>
            <span class="selo ${ativo ? 'selo--sucesso' : ''}">${c.publico ? (ativo ? 'Leitura pública ligada' : 'Leitura pública em validação') : 'Pela sala do robô'}</span>
            ${c.motivo ? `<br><span class="fraco">${esc(c.motivo)}</span>` : ''}</li>`;
        }).join('');
      });

      LH.ao(raiz, 'click', '[data-lida]', async (e, b) => {
        const id = Number(b.dataset.lida);
        try { await LH.repo.marcarChatLido([id]); const m = mensagens.find((x) => x.id === id); if (m) m.lida = true; desenhar(); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-acao="ler-tudo"]', async () => {
        const ids = mensagens.filter((m) => !m.lida).map((m) => m.id);
        try { await LH.repo.marcarChatLido(ids); mensagens.forEach((m) => { m.lida = true; }); desenhar(); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      soRelevantes.addEventListener('change', desenhar);
      filtroPortal.addEventListener('change', desenhar);

      carregar();
      // Tempo real: mensagem nova entra no topo e, se for relevante, avisa.
      const cancelar = LH.repo.assinarChat((m) => {
        if (mensagens.some((x) => x.id === m.id)) return;
        mensagens.unshift(m);
        desenhar();
        if (m.relevante) {
          const titulo = `Chat ${PORTAIS[m.portal] || m.portal} · pregão ${m.compra_ref}`;
          LH.aviso(`${titulo}: ${m.texto}`, 'alerta', 8000);
          if (pc.checked) LH.notificar(titulo, m.texto);
        }
      });
      return cancelar; // o roteador chama ao sair da tela
    },
  };
}());
