/* =============================================================================
   Uso LicitaHub · Robô de Lances: MODO REAL (navegador)
   - Cofre de credenciais: salva login/senha ou certificado A1 por portal. O
     segredo vai direto para o servidor, que cifra antes de gravar; a tela só
     volta a ver os metadados (login mascarado, nome do certificado).
   - Conectar ao pregão: pede ao servidor para abrir a sala real (worker com
     Playwright) em "só monitorar" ou "robô dá lances" (com confirmação).
   - Ao vivo: cada lance/fase/mensagem gravado pelo worker em auction_live_bids
     chega aqui pelo Supabase Realtime e alimenta o mesmo painel da simulação.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const { esc, icone } = LH;
  const moeda = (v) => (v == null ? '—' : LH.fmt.moeda(v));
  const PORTAIS_COFRE = () => LH.portaisRobo.lista().filter((p) => p.chave !== 'pncp' && p.chave !== 'outros');

  let estadoCache = null;
  const estadoServidor = async (forcar = false) => {
    if (!estadoCache || forcar) estadoCache = await LH.nuvem.api('/api/robo/real/estado');
    return estadoCache;
  };
  const credenciais = async () => (await LH.nuvem.api('/api/portais/credenciais')).credenciais || [];
  const logado = () => LH.repo?.modo === 'real';
  const ultimoModal = () => [...document.querySelectorAll('.modal-fundo')].at(-1);

  const lerArquivoBase64 = (arquivo) => new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => falha(new Error('Não consegui ler o arquivo.'));
    r.readAsDataURL(arquivo);
  });

  // ---------------------------------------------------------------------------
  // Cofre de credenciais
  // ---------------------------------------------------------------------------
  /** Abre o cofre. Resolve true se salvou a credencial do portal pedido. */
  function abrirCofre({ portal = null } = {}) {
    if (!logado()) { LH.aviso('O cofre de credenciais precisa de login (não funciona no modo demonstração).', 'alerta'); return Promise.resolve(false); }
    return new Promise((resolver) => {
      let salvou = false;
      const listaHtml = (lista) => {
        const por = Object.fromEntries(lista.map((c) => [c.portal, c]));
        return PORTAIS_COFRE().map((p) => {
          const c = por[p.chave];
          return `<li class="cofre__linha">${LH.portaisRobo.selo(p.chave)}
            <span class="cofre__estado">${c
              ? `${icone('cadeado')} ${c.tipo === 'certificado' ? `Certificado ${esc(c.certificado_nome || '')}` : `Login ${esc(c.login_mascarado || '')}`}`
              : '<span class="fraco">sem credencial</span>'}</span>
            <span class="cofre__acoes"><button type="button" class="btn btn--pequeno btn--fantasma" data-cofre-editar="${p.chave}">${c ? 'Trocar' : 'Adicionar'}</button>
            ${c ? `<button type="button" class="btn btn--pequeno btn--fantasma" data-cofre-apagar="${p.chave}" aria-label="Apagar credencial">${icone('lixeira')}</button>` : ''}</span></li>`;
        }).join('');
      };
      const formHtml = (chave) => `
        <form class="form cofre__form" data-cofre-form="${chave}" onsubmit="return false">
          <div class="cofre__form-topo">${LH.portaisRobo.selo(chave)}<b>Nova credencial</b></div>
          <div class="robo-modo cofre__tipo" role="radiogroup">
            <button type="button" role="radio" class="robo-modo__op ativo" data-cofre-tipo="senha">${icone('usuario')} Login e senha</button>
            <button type="button" role="radio" class="robo-modo__op" data-cofre-tipo="certificado">${icone('escudo')} Certificado A1</button>
          </div>
          <div data-cofre-campos="senha">
            <label class="campo"><span class="campo__rotulo">Login no portal (CPF, CNPJ ou usuário)</span><input name="login" autocomplete="off"></label>
            <label class="campo"><span class="campo__rotulo">Senha do portal</span><input name="senha" type="password" autocomplete="new-password"></label>
          </div>
          <div data-cofre-campos="certificado" hidden>
            <label class="campo"><span class="campo__rotulo">Arquivo do certificado (.pfx ou .p12, até 64 KB)</span><input name="pfx" type="file" accept=".pfx,.p12,application/x-pkcs12"></label>
            <label class="campo"><span class="campo__rotulo">Senha do certificado</span><input name="senhaCertificado" type="password" autocomplete="new-password"></label>
          </div>
          <p class="texto-perigo" data-cofre-erro hidden></p>
          <div class="cofre__form-acoes"><button type="button" class="btn btn--fantasma" data-cofre-cancelar>Cancelar</button><button type="button" class="btn btn--primario" data-cofre-salvar>${icone('cadeado')} Salvar no cofre</button></div>
        </form>`;

      LH.modal({
        titulo: 'Cofre de credenciais dos portais',
        html: `<div class="cofre">
          <p class="nota cofre__aviso">${icone('cadeado')} <span>A senha e o certificado são <b>cifrados no servidor</b> (AES-256) antes de ir para o banco, ficam ligados à <b>sua conta</b> e nunca voltam para a tela. Só o robô os abre, na hora de entrar no portal. O certificado A1 assina documentos em nome da empresa: guarde aqui só se for usar o modo real.</span></p>
          <ul class="cofre__lista" data-cofre-lista>${LH.carregando('Carregando...')}</ul>
          <div data-cofre-area></div>
        </div>`,
        acoes: [{ rotulo: 'Fechar', classe: 'btn--fantasma' }],
      });
      const caixa = ultimoModal().querySelector('.cofre');
      const lista = caixa.querySelector('[data-cofre-lista]');
      const area = caixa.querySelector('[data-cofre-area]');
      const recarregar = async () => {
        try { lista.innerHTML = listaHtml(await credenciais()); } catch (e) { lista.innerHTML = `<li>${LH.erroHtml(e)}</li>`; }
      };
      const editar = (chave) => {
        area.innerHTML = formHtml(chave);
        area.querySelector('input[name="login"]')?.focus();
      };
      recarregar().then(() => { if (portal) editar(portal); });

      caixa.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.cofreEditar) editar(b.dataset.cofreEditar);
        if (b.dataset.cofreApagar) {
          if (!(await LH.confirmar('Apagar credencial', 'Apagar a credencial deste portal do cofre?', 'Apagar', true))) return;
          try { await LH.nuvem.api(`/api/portais/credenciais/${b.dataset.cofreApagar}`, { metodo: 'DELETE' }); await recarregar(); } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        }
        if (b.hasAttribute('data-cofre-cancelar')) area.innerHTML = '';
        if (b.dataset.cofreTipo) {
          const form = b.closest('form');
          form.querySelectorAll('[data-cofre-tipo]').forEach((x) => x.classList.toggle('ativo', x === b));
          form.querySelectorAll('[data-cofre-campos]').forEach((x) => { x.hidden = x.dataset.cofreCampos !== b.dataset.cofreTipo; });
        }
        if (b.hasAttribute('data-cofre-salvar')) {
          const form = b.closest('form');
          const chave = form.dataset.cofreForm;
          const tipo = form.querySelector('[data-cofre-tipo].ativo').dataset.cofreTipo;
          const erro = form.querySelector('[data-cofre-erro]');
          const f = form.elements;
          erro.hidden = true;
          b.disabled = true;
          try {
            let corpo;
            if (tipo === 'senha') corpo = { tipo, login: f.login.value.trim(), senha: f.senha.value };
            else {
              const arquivo = f.pfx.files[0];
              if (!arquivo) throw new Error('Escolha o arquivo do certificado.');
              if (arquivo.size > 64 * 1024) throw new Error('Certificado grande demais (máx. 64 KB).');
              corpo = { tipo, certificado_base64: await lerArquivoBase64(arquivo), certificado_nome: arquivo.name, senha_certificado: f.senhaCertificado.value };
            }
            await LH.nuvem.api(`/api/portais/credenciais/${chave}`, { metodo: 'PUT', corpo });
            form.reset();
            area.innerHTML = '';
            await recarregar();
            LH.aviso('Credencial salva no cofre.', 'sucesso');
            if (chave === portal) salvou = true;
          } catch (er) { erro.textContent = er.message; erro.hidden = false; } finally { b.disabled = false; }
        }
      });
      // Resolve quando o modal fechar.
      const fundo = caixa.closest('.modal-fundo');
      new MutationObserver((_, obs) => { if (!document.body.contains(fundo)) { obs.disconnect(); resolver(salvou); } }).observe(document.body, { childList: true, subtree: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Conectar um item a um pregão real
  // ---------------------------------------------------------------------------
  function pedirConexao(i, situacaoPortal) {
    return new Promise((resolver) => {
      let escolhido = null;
      const naoMapeado = !situacaoPortal?.validado;
      LH.modal({
        titulo: 'Conectar ao pregão real',
        html: `<form class="form" onsubmit="return false">
          <div class="cofre__form-topo">${LH.portaisRobo.selo(i.plataforma)}<b>${esc(i.descricao)}</b></div>
          ${naoMapeado ? `<p class="nota nota--alerta">${icone('alerta')} <span>A sala de disputa deste portal <b>ainda não foi mapeada</b> no robô (os seletores da página não foram conferidos numa sessão real). A conexão vai parar com o aviso do que falta mapear, e nenhum lance é enviado.</span></p>` : ''}
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Nº do pregão / processo no portal</span><input name="pregao" required maxlength="120" value="${esc(i.pregaoRef || '')}" placeholder="ex.: 90012/2026"></label>
            <label class="campo"><span class="campo__rotulo">Lote / item</span><input name="lote" maxlength="40" value="${esc(i.loteRef || i.itemNumero || '')}"></label>
          </div>
          <fieldset class="robo-conectar__modos">
            <label class="campo--check"><input type="radio" name="modo" value="monitorar" checked><span><b>Só monitorar</b>: o robô acompanha a sala ao vivo (lances, fases, chat) e não envia nada. Recomendado para começar.</span></label>
            <label class="campo--check"><input type="radio" name="modo" value="lances"><span><b>Robô dá lances de verdade</b>: cobre a praça por ${moeda(i.decremento ?? 0.01)}, entre o mínimo de ${moeda(i.piso)} e o teto de ${moeda(i.teto)}.</span></label>
          </fieldset>
          <label class="campo--check robo-conectar__confirma" data-confirma hidden><input type="checkbox" name="confirmo"><span>Entendo que o robô vai <b>enviar lances reais</b> no portal, em nome da empresa, e que posso parar a qualquer momento.</span></label>
          <p class="texto-perigo" data-erro hidden></p>
        </form>`,
        acoes: [
          { rotulo: 'Cancelar', classe: 'btn--fantasma' },
          { rotulo: 'Conectar', classe: 'btn--primario', acao: (fechar, janela) => {
            const f = janela.querySelector('form').elements;
            const erro = janela.querySelector('[data-erro]');
            const modo = f.modo.value;
            if (!f.pregao.value.trim()) { erro.textContent = 'Informe o número do pregão.'; erro.hidden = false; return; }
            if (modo === 'lances' && !f.confirmo.checked) { erro.textContent = 'Confirme que o robô vai enviar lances reais.'; erro.hidden = false; return; }
            escolhido = { pregao: f.pregao.value.trim(), lote: f.lote.value.trim() || undefined, modo, confirmo_lances_reais: modo === 'lances' ? true : undefined };
            fechar();
          } },
        ],
      });
      const form = ultimoModal().querySelector('form');
      form.addEventListener('change', () => { form.querySelector('[data-confirma]').hidden = form.elements.modo.value !== 'lances'; });
      const fundo = form.closest('.modal-fundo');
      new MutationObserver((_, obs) => { if (!document.body.contains(fundo)) { obs.disconnect(); resolver(escolhido); } }).observe(document.body, { childList: true, subtree: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Disputa remota: o mesmo "formato" da Disputa do motor, alimentada pelo Realtime
  // ---------------------------------------------------------------------------
  class DisputaRemota {
    constructor({ sessao, item, h }) {
      Object.assign(this, { sessao, item, h });
      this.status = 'running';
      this.lances = new Map();
      this.nossoLance = null;
      this.vistos = new Set();
      this.canal = null;
    }

    ranking() {
      const todos = [...this.lances.values()];
      if (this.nossoLance != null) todos.push({ autor: 'nos', valor: this.nossoLance, porte: this.item.nossoPorte || 'demais' });
      return LH.robo.ordenarRanking(todos);
    }

    async ligar() {
      const db = LH.nuvem.cliente;
      const id = this.item.id;
      this.canal = db.channel(`robo-real-${this.sessao.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_live_bids', filter: `sessao_id=eq.${this.sessao.id}` }, (p) => this.aplicar(p.new))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'robo_sessoes', filter: `id=eq.${this.sessao.id}` }, (p) => this.sessaoMudou(p.new))
        .subscribe();
      // O que chegou antes da assinatura ficar pronta.
      const { data } = await db.from('auction_live_bids').select('*').eq('sessao_id', this.sessao.id).order('id');
      (data || []).forEach((ev) => this.aplicar(ev));
      this.h.mudar(id, { status: 'running', real: { sessaoId: this.sessao.id, modo: this.sessao.modo, status: this.sessao.status } });
    }

    aplicar(ev) {
      if (!ev || this.vistos.has(ev.id)) return;
      this.vistos.add(ev.id);
      const id = this.item.id;
      const nome = this.item.descricao;
      const valor = ev.valor == null ? null : Number(ev.valor);
      const posicao = (autor) => this.ranking().find((x) => x.autor === autor)?.posicao ?? null;
      if (ev.tipo === 'lance' && valor != null) {
        if (ev.autor === 'nos') {
          this.nossoLance = this.nossoLance == null ? valor : Math.min(this.nossoLance, valor);
          this.h.mudar(id, { nossoLance: this.nossoLance });
          this.h.falar('Robô (nós)', ev.texto || nome, 'robo-chat__msg--nos', { porte: this.item.nossoPorte || 'demais', posicao: posicao('nos'), valor, quantidade: this.item.quantidade || 1, itemId: id });
        } else {
          const atual = this.lances.get(ev.autor);
          if (!atual || valor < atual.valor) this.lances.set(ev.autor, { autor: ev.autor, valor, porte: ev.porte || 'demais' });
          const melhor = Math.min(...[...this.lances.values()].map((x) => x.valor));
          this.h.mudar(id, { melhorLance: melhor });
          this.h.falar(ev.autor || 'Concorrente', nome, '', { porte: ev.porte || 'demais', posicao: posicao(ev.autor), valor, quantidade: this.item.quantidade || 1, itemId: id });
        }
      } else if (ev.tipo === 'fase' && ev.fase) {
        this.h.mudar(id, { fase: ev.fase, fimEm: null });
      } else if (ev.tipo === 'mensagem') {
        this.h.falar(ev.autor || 'Pregoeiro', ev.texto || '', 'robo-chat__msg--oficial', { itemId: id });
      } else if (ev.tipo === 'alerta') {
        const piso = /Preço mínimo atingido/i.test(ev.texto || '');
        if (piso) { this.status = 'stopped_at_floor'; this.h.mudar(id, { status: 'stopped_at_floor', alertaPiso: ev.texto }); LH.aviso(`Preço mínimo atingido · ${nome}`, 'perigo', 7000); }
        this.h.falar(piso ? 'Preço mínimo atingido' : 'Robô (modo real)', ev.texto || '', 'robo-chat__msg--alerta', { itemId: id });
      } else if (ev.tipo === 'status') {
        this.h.falar('Sistema', ev.texto || '', 'robo-chat__msg--sistema', { itemId: id });
      }
    }

    sessaoMudou(s) {
      const id = this.item.id;
      this.sessao = { ...this.sessao, ...s };
      const real = { sessaoId: s.id, modo: s.modo, status: s.status };
      if (s.status === 'pausado') { this.status = 'paused'; this.h.mudar(id, { status: 'paused', real }); }
      else if (s.status === 'conectado' || s.status === 'iniciando') { if (this.status !== 'stopped_at_floor') this.status = 'running'; this.h.mudar(id, { status: this.status, real }); }
      else {
        // encerrada ou erro: desliga o tempo real e libera o item.
        const final = this.status === 'stopped_at_floor' ? 'stopped_at_floor' : 'idle';
        this.status = final;
        this.h.mudar(id, { status: final, real: null });
        if (s.status === 'erro') LH.aviso(`Modo real: ${s.erro || 'a sessão parou com erro.'}`, 'perigo', 9000);
        this.desligar();
        this.h.soltar(id, this);
      }
    }

    acao(nome) { return LH.nuvem.api(`/api/robo/sessoes/${this.sessao.id}/${nome}`, { metodo: 'POST' }).catch((e) => LH.aviso(e.message, 'perigo')); }
    pausar() { this.acao('pausar'); }
    retomar() { this.acao('retomar'); }
    parar() { this.acao('parar'); }
    // O formulário grava os limites no banco logo em seguida: o servidor relê do banco.
    atualizarLimites() { setTimeout(() => this.acao('limites'), 1500); }
    desligar() { if (this.canal) LH.nuvem.cliente.removeChannel(this.canal); this.canal = null; }
  }

  /**
   * Inicia um item no modo real. h = ganchos do estado ao vivo
   * { mudar(id, campos), falar(...), prender(id, disputa), soltar(id, disputa) }.
   */
  async function iniciar(i, h) {
    if (!logado()) { LH.aviso('O modo real precisa de login (não funciona no modo demonstração).', 'alerta', 6000); return; }
    if (i.plataforma === 'pncp') { LH.aviso('O PNCP só publica as compras: edite o item e escolha o portal onde a disputa acontece.', 'alerta', 7000); return; }
    let estado;
    try { estado = await estadoServidor(true); } catch (e) { LH.aviso(e.message, 'perigo'); return; }
    if (!estado.cofre) { LH.aviso('O modo real está desligado no servidor (falta a chave do cofre, CREDENCIAIS_CHAVE).', 'alerta', 8000); return; }
    let lista;
    try { lista = await credenciais(); } catch (e) { LH.aviso(e.message, 'perigo'); return; }
    if (!lista.some((c) => c.portal === i.plataforma)) {
      LH.aviso(`Salve a credencial do ${LH.portaisRobo.de(i.plataforma).nome} no cofre para conectar.`, 'info');
      const salvou = await abrirCofre({ portal: i.plataforma });
      if (!salvou) return;
    }
    if (!estado.navegador) LH.aviso('Atenção: o servidor ainda não tem o navegador do robô (Playwright) instalado. A conexão vai falhar até ele ser instalado.', 'alerta', 8000);
    const pedido = await pedirConexao(i, estado.portais?.[i.plataforma]);
    if (!pedido) return;
    try {
      const { sessao } = await LH.nuvem.api('/api/robo/sessoes', { metodo: 'POST', corpo: { robo_item_id: i.id, ...pedido } });
      h.mudar(i.id, { pregaoRef: pedido.pregao, loteRef: pedido.lote || null, nossoLance: null, melhorLance: null, fase: null, alertaPiso: null });
      const d = new DisputaRemota({ sessao, item: i, h });
      h.prender(i.id, d);
      h.falar('Sistema', `Modo real · ${LH.portaisRobo.de(i.plataforma).nome} · pregão ${pedido.pregao}${pedido.lote ? `, lote ${pedido.lote}` : ''} · ${pedido.modo === 'lances' ? 'robô dando lances' : 'só monitorando'}. Conectando...`, 'robo-chat__msg--sistema', { itemId: i.id });
      await d.ligar();
    } catch (e) {
      LH.aviso(e.message, 'perigo', 8000);
      if (e.codigo === 'sem_credencial') abrirCofre({ portal: i.plataforma });
    }
  }

  LH.roboReal = { abrirCofre, iniciar, estadoServidor };
}());
