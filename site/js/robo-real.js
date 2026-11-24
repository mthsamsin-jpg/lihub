/* =============================================================================
   Uso LicitaHub · Robô Turbo 2.0: MODO REAL (navegador)
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

  // Situação da credencial (mesmos nomes de worker/fases.js).
  const SITUACAO = {
    nao_testada: { rotulo: 'Login não testado', cor: 'fila' },
    aguardando_validacao: { rotulo: 'Conta em validação no portal', cor: 'andamento' },
    credencial_ok: { rotulo: 'Login OK', cor: 'ok' },
    bloqueada: { rotulo: 'Login recusado', cor: 'perigo' },
  };
  const seloSituacao = (c) => {
    const s = SITUACAO[c?.situacao] || SITUACAO.nao_testada;
    const quando = c?.situacao_em ? ` · ${new Date(c.situacao_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : '';
    return `<span class="etapa-portal etapa-portal--${s.cor}" title="${esc((c?.situacao_detalhe || s.rotulo) + quando)}">${esc(s.rotulo)}</span>`;
  };
  /** O login deste portal já pode ser testado (etapa do servidor "login" ou além)? */
  const loginTestavel = (chave) => ['login', 'leitura', 'lances'].includes(estadoCache?.portais?.[chave]?.etapa) || !!estadoCache?.portais?.[chave]?.validado;

  /**
   * As 3 fases do modo real para um portal + credencial.
   * { fases: [{ nome, estado: 'feito'|'agora'|'travado', texto }], monitorar: bool, lances: bool, motivo }
   */
  function fasesDoPortal(chave, cred) {
    const etapa = estadoCache?.portais?.[chave]?.validado ? 'lances' : (estadoCache?.portais?.[chave]?.etapa || 'mapeamento');
    const nivel = ['mapeamento', 'login', 'leitura', 'lances'].indexOf(etapa);
    const sit = cred?.situacao || (cred ? 'nao_testada' : 'sem_credencial');
    const contaOk = sit === 'credencial_ok';
    const contaTravada = sit === 'aguardando_validacao' || sit === 'bloqueada';
    const fases = [
      { nome: '1. Teste de login (sem pregão)', estado: contaOk ? 'feito' : 'agora',
        texto: !cred ? 'Salve a credencial no cofre.' : contaOk ? 'O robô entrou no portal com a sua credencial.'
          : sit === 'aguardando_validacao' ? 'Sua conta ainda está em validação no portal.' : sit === 'bloqueada' ? 'O último login foi recusado: confira a senha.'
          : nivel >= 1 ? 'Use "Testar login" no cofre.' : 'O login deste portal ainda está sendo mapeado.' },
      { nome: '2. Acompanhamento ao vivo (só monitorar)', estado: nivel >= 2 ? (contaTravada ? 'travado' : 'feito') : 'travado',
        texto: nivel >= 2 ? 'Sala mapeada: o robô lê lances, fases e chat sem enviar nada.' : 'A sala de disputa é mapeada num pregão real, só observando.' },
      { nome: '3. Lances reais (com cautela)', estado: nivel >= 3 && contaOk ? 'feito' : 'travado',
        texto: nivel >= 3 ? (contaOk ? 'Liberado. Comece por um item de valor baixo e acompanhe.' : 'Teste o login antes de dar lances reais.') : 'Só depois de a leitura da sala ser conferida.' },
    ];
    const monitorar = nivel >= 2 && !contaTravada && !!cred;
    const lances = nivel >= 3 && contaOk;
    return { fases, monitorar, lances, situacao: sit, etapa };
  }
  const fasesHtml = (f) => `<ol class="fases-real">${f.fases.map((x) => `<li class="fases-real__item fases-real__item--${x.estado}">
    <span class="fases-real__marca" aria-hidden="true">${x.estado === 'feito' ? icone('check') : x.estado === 'agora' ? icone('raio') : icone('cadeado')}</span>
    <span><b>${esc(x.nome)}</b><small>${esc(x.texto)}</small></span></li>`).join('')}</ol>`;
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
          const testavel = c && loginTestavel(p.chave);
          const pendente = c?.situacao === 'aguardando_validacao';
          return `<li class="cofre__linha">${LH.portaisRobo.selo(p.chave)}
            <span class="cofre__estado">${c
              ? `${icone('cadeado')} ${c.tipo === 'certificado' ? `Certificado ${esc(c.certificado_nome || '')}` : `Login ${esc(c.login_mascarado || '')}`} ${seloSituacao(c)}`
              : '<span class="fraco">sem credencial</span>'}
              ${c?.situacao_detalhe && c.situacao !== 'credencial_ok' ? `<small class="cofre__detalhe">${esc(c.situacao_detalhe)}</small>` : ''}
              ${c && !testavel ? '<small class="cofre__detalhe">Guardada. O login deste portal ainda está sendo mapeado no robô.</small>' : ''}</span>
            <span class="cofre__acoes">
            ${testavel ? `<button type="button" class="btn btn--pequeno" data-cofre-testar="${p.chave}" title="Entra no portal com esta credencial e sai (sem pregão e sem lance)">${icone('plugue')} Testar login</button>` : ''}
            ${c ? `<button type="button" class="btn btn--pequeno btn--fantasma" data-cofre-pendente="${p.chave}" data-valor="${pendente ? 'nao_testada' : 'aguardando_validacao'}">${pendente ? 'Conta aprovada' : 'Conta em análise'}</button>` : ''}
            <button type="button" class="btn btn--pequeno btn--fantasma" data-cofre-editar="${p.chave}">${c ? 'Trocar' : 'Adicionar'}</button>
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
        try {
          await estadoServidor().catch(() => null);
          lista.innerHTML = listaHtml(await credenciais());
        } catch (e) { lista.innerHTML = `<li>${LH.erroHtml(e)}</li>`; }
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
        // FASE 1: teste de login (o servidor entra no portal e sai; nada de pregão nem lance).
        if (b.dataset.cofreTestar) {
          const chave = b.dataset.cofreTestar;
          const nome = LH.portaisRobo.de(chave).nome;
          b.disabled = true;
          b.innerHTML = `${icone('relogio')} Testando...`;
          try {
            const r = await LH.nuvem.api(`/api/portais/credenciais/${chave}/testar`, { metodo: 'POST', limiteMs: 120_000 });
            LH.aviso(r.ok ? `Login no ${nome} OK: o robô entrou com a sua credencial.` : `${nome}: ${r.detalhe}`, r.ok ? 'sucesso' : 'alerta', 9000);
          } catch (erro) { LH.aviso(erro.message, 'perigo', 8000); }
          await recarregar();
        }
        if (b.dataset.cofrePendente) {
          try {
            await LH.nuvem.api(`/api/portais/credenciais/${b.dataset.cofrePendente}/situacao`, { metodo: 'POST', corpo: { situacao: b.dataset.valor } });
            LH.aviso(b.dataset.valor === 'aguardando_validacao'
              ? 'Anotado: enquanto a conta estiver em análise, o robô não tenta entrar neste portal. Use a Sala Simulada.'
              : 'Anotado. Agora use "Testar login" para confirmar que a conta foi ativada.', 'info', 8000);
            await recarregar();
          } catch (erro) { LH.aviso(erro.message, 'perigo'); }
        }
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
  function pedirConexao(i, cred) {
    return new Promise((resolver) => {
      let escolhido = null;
      const f = fasesDoPortal(i.plataforma, cred);
      LH.modal({
        titulo: 'Conectar ao pregão real',
        html: `<form class="form" onsubmit="return false">
          <div class="cofre__form-topo">${LH.portaisRobo.selo(i.plataforma)}<b>${esc(i.descricao)}</b></div>
          ${fasesHtml(f)}
          ${f.monitorar ? '' : `<p class="nota nota--alerta">${icone('alerta')} <span>${f.situacao === 'aguardando_validacao' ? 'Sua conta neste portal ainda está em validação. Quando o portal aprovar, use <b>Testar login</b> no cofre.'
            : f.situacao === 'bloqueada' ? 'O último login foi recusado. Confira a senha no cofre e use <b>Testar login</b>.'
            : 'O acompanhamento ao vivo deste portal ainda não foi liberado: a sala de disputa está sendo mapeada. Enquanto isso, teste o login no cofre e use a <b>Sala Simulada</b>.'} Nenhum lance é enviado.</span></p>`}
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Nº do pregão / processo no portal</span><input name="pregao" required maxlength="120" value="${esc(i.pregaoRef || '')}" placeholder="ex.: 90012/2026"></label>
            <label class="campo"><span class="campo__rotulo">Lote / item</span><input name="lote" maxlength="40" value="${esc(i.loteRef || i.itemNumero || '')}"></label>
          </div>
          <fieldset class="robo-conectar__modos">
            <label class="campo--check"><input type="radio" name="modo" value="monitorar" checked><span><b>Só monitorar</b>: o robô acompanha a sala ao vivo (lances, fases, chat) e não envia nada. Recomendado para começar.</span></label>
            <label class="campo--check${f.lances ? '' : ' campo--travado'}"><input type="radio" name="modo" value="lances" ${f.lances ? '' : 'disabled'}><span><b>Robô dá lances de verdade</b>: cobre a praça por ${moeda(i.decremento ?? 0.01)}, entre o mínimo de ${moeda(i.piso)} e o teto de ${moeda(i.teto)}.${f.lances ? ' Nas primeiras disputas, só itens de valor baixo.' : ' <i>(travado até a fase 3)</i>'}</span></label>
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
            if (!fasesDoPortal(i.plataforma, cred).monitorar) { erro.textContent = 'Este portal ainda não pode ser conectado: veja as fases acima.'; erro.hidden = false; return; }
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
  async function iniciar(i, h, pedidoPronto = null) {
    if (!logado()) { LH.aviso('O modo real precisa de login (não funciona no modo demonstração).', 'alerta', 6000); return; }
    if (i.plataforma === 'pncp') { LH.aviso('O PNCP só publica as compras: edite o item e escolha o portal onde a disputa acontece.', 'alerta', 7000); return; }
    let estado;
    try { estado = await estadoServidor(true); } catch (e) { LH.aviso(e.message, 'perigo'); return; }
    LH.portaisRobo.atualizarServidor(estado.portais);
    if (i.plataforma === 'outros') { LH.aviso('"Outro portal" só funciona na Sala Simulada: escolha o portal da disputa para usar o modo real.', 'alerta', 7000); return; }
    if (!estado.cofre) { LH.aviso('O modo real está desligado no servidor (falta a chave do cofre, CREDENCIAIS_CHAVE).', 'alerta', 8000); return; }
    let lista;
    try { lista = await credenciais(); } catch (e) { LH.aviso(e.message, 'perigo'); return; }
    if (!lista.some((c) => c.portal === i.plataforma)) {
      LH.aviso(`Salve a credencial do ${LH.portaisRobo.de(i.plataforma).nome} no cofre para conectar.`, 'info');
      const salvou = await abrirCofre({ portal: i.plataforma });
      if (!salvou) return;
    }
    if (!estado.navegador) LH.aviso('Atenção: o servidor ainda não tem o navegador do robô (Playwright) instalado. A conexão vai falhar até ele ser instalado.', 'alerta', 8000);
    const cred = (await credenciais().catch(() => lista)).find((c) => c.portal === i.plataforma) || null;
    const fases = fasesDoPortal(i.plataforma, cred);
    // Atalho do feed ("monitorar"): sem a fase liberada, avisa e não chama o servidor.
    if (pedidoPronto && (!fases.monitorar || (pedidoPronto.modo === 'lances' && !fases.lances))) {
      LH.aviso(`${LH.portaisRobo.de(i.plataforma).nome}: ${fases.fases.find((x) => x.estado !== 'feito')?.texto || 'fase ainda não liberada.'}`, 'alerta', 8000);
      return;
    }
    const pedido = pedidoPronto || await pedirConexao(i, cred);
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
      if (['sem_credencial', 'conta_pendente', 'credencial_bloqueada', 'login_nao_testado'].includes(e.codigo)) abrirCofre({ portal: i.plataforma });
    }
  }

  LH.roboReal = { abrirCofre, iniciar, estadoServidor };
}());
