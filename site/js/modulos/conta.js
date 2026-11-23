/* =============================================================================
   Uso LicitaHub · Conta
   Sua empresa, Meu Perfil (dados da conta e assinatura) e Ajuda
   (perguntas frequentes, tutoriais, suporte e textos legais).
   No modo real: empresas e perfil no Supabase; assinatura pelo Mercado Pago.
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;

  const SUPORTE = LH.SUPORTE; // contatos e textos legais ficam em js/legal.js

  const campo = (nome, rotulo, valor, extra = '') =>
    `<label class="campo"><span class="campo__rotulo">${rotulo}</span><input name="${nome}" value="${esc(valor || '')}" ${extra}></label>`;

  // --- Sua empresa -------------------------------------------------------------------
  LH.vistas.empresa = {
    titulo: 'Sua empresa',
    render: () => {
      const e = LH.repo.empresaPerfil();
      const lista = LH.repo.modo === 'real' ? LH.repo.empresas() : [];
      return `
      ${LH.cabecalho({
        titulo: 'Sua empresa',
        texto: 'Dados cadastrais, CNPJ e configurações fiscais. Eles preenchem sozinhos as propostas e as declarações.',
        acoes: lista.length > 1 ? `<label class="campo" style="grid-auto-flow:column;align-items:center;gap:8px"><span class="campo__rotulo">Empresa</span>
          <select id="empresa-atual">${LH.opcoes(lista.map((m) => [m.id, m.fantasia || m.razao]), LH.repo.empresaAtualId())}</select></label>` : '',
      })}
      ${LH.repo.modo === 'real' && !e.id ? `<p class="nota" data-reveal style="margin-bottom:18px">${icone('info')} Você ainda não cadastrou a sua empresa. Preencha e salve: ela passa a valer no CRM, nas propostas e nas declarações.</p>` : ''}
      <form class="grade" id="form-sua-empresa" autocomplete="off" novalidate>
        <section class="card spot form" data-reveal>
          <div class="card__titulo"><h2>${icone('predio')} Dados cadastrais</h2></div>
          <div class="form__linha">
            ${campo('razao', 'Razão social', e.razao, 'required maxlength="200"')}
            ${campo('fantasia', 'Nome fantasia', e.fantasia)}
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">CNPJ</span><input name="cnpj" value="${esc(LH.cnpj.mascara(e.cnpj))}" inputmode="numeric" placeholder="00.000.000/0000-00">
              <span class="campo__erro" id="erro-cnpj-emp" hidden>CNPJ inválido: confira os números.</span></label>
            ${campo('ie', 'Inscrição estadual', e.ie)}
            ${campo('im', 'Inscrição municipal', e.im)}
          </div>
        </section>
        <section class="card spot form" data-reveal>
          <div class="card__titulo"><h2>${icone('moeda')} Configurações fiscais</h2></div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Regime tributário</span>
              <select name="regime">${LH.opcoes(['Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real'], e.regime || 'Simples Nacional')}</select></label>
            <label class="campo"><span class="campo__rotulo">Porte</span>
              <select name="porte">${LH.opcoes([['MEI', 'Microempreendedor individual (MEI)'], ['ME', 'Microempresa (ME)'], ['EPP', 'Empresa de pequeno porte (EPP)'], ['Demais', 'Demais']], e.porte)}</select></label>
          </div>
        </section>
        <section class="card spot form" data-reveal>
          <div class="card__titulo"><h2>${icone('local')} Endereço e contato</h2></div>
          <div class="form__linha">
            ${campo('cep', 'CEP', e.cep, 'inputmode="numeric"')}
            ${campo('endereco', 'Endereço', e.endereco)}
          </div>
          <div class="form__linha">
            ${campo('cidade', 'Cidade', e.cidade)}
            <label class="campo"><span class="campo__rotulo">UF</span><select name="uf">${LH.opcoes(LH.dados.UFS, e.uf || 'SP')}</select></label>
            ${campo('email', 'E-mail', e.email, 'type="email"')}
            ${campo('telefone', 'Telefone', e.telefone, 'type="tel"')}
          </div>
        </section>
        <section class="card spot form" data-reveal>
          <div class="card__titulo"><h2>${icone('usuario')} Representante legal e banco</h2></div>
          <div class="form__linha">
            ${campo('representante', 'Nome do representante', e.representante)}
            ${campo('cpfRepresentante', 'CPF', e.cpfRepresentante, 'inputmode="numeric"')}
            ${campo('cargo', 'Cargo', e.cargo)}
          </div>
          <div class="form__linha">
            ${campo('banco', 'Banco', e.banco)}
            ${campo('agencia', 'Agência', e.agencia)}
            ${campo('conta', 'Conta', e.conta)}
          </div>
          <div class="card__rodape"><button class="btn btn--primario" type="submit">${icone('check')} Salvar dados da empresa</button></div>
        </section>
      </form>`;
    },
    montar(raiz) {
      const form = raiz.querySelector('#form-sua-empresa');
      const erro = raiz.querySelector('#erro-cnpj-emp');
      const atual = LH.repo.empresaPerfil();
      raiz.querySelector('#empresa-atual')?.addEventListener('change', (e) => { LH.repo.escolherEmpresa(e.target.value); LH.ir('empresa'); });
      form.cnpj.addEventListener('input', () => { form.cnpj.value = LH.cnpj.mascara(form.cnpj.value); erro.hidden = true; form.cnpj.classList.remove('invalido'); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.razao.value.trim()) return form.razao.focus();
        const real = LH.repo.modo === 'real';
        if ((real || form.cnpj.value) && !LH.cnpj.valido(form.cnpj.value)) {
          erro.hidden = false;
          form.cnpj.classList.add('invalido');
          return form.cnpj.focus();
        }
        const dados = Object.fromEntries(new FormData(form));
        const botao = form.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          await LH.repo.salvarEmpresa(real ? { ...dados, id: atual.id } : { ...dados, cnpj: LH.cnpj.limpar(dados.cnpj), razao: dados.razao.trim().toUpperCase(), perfil: true });
          LH.atualizarUsuario?.();
          LH.aviso('Dados da empresa salvos.', 'sucesso');
          if (real && !atual.id) LH.ir('empresa');
        } catch (erro2) {
          LH.aviso(erro2.message, 'perigo');
        }
        botao.disabled = false;
      });
    },
  };

  // --- Meu Perfil: dados da conta e assinatura -----------------------------------------
  const NOMES_PLANO = { gratuito: 'Free', starter: 'Pro', prime: 'Pro', pro: 'Pro', max: 'Max' };

  const fimData = (iso) => (iso ? fmt.data(LH.datas.paraIso(new Date(iso))) : '');

  function situacaoAssinatura(org, a) {
    if (org.plano === 'gratuito' || !org.plano_ate) return { texto: 'Plano Free', classe: '' };
    if (new Date(org.plano_ate) <= new Date()) return { texto: 'Ciclo pago terminou', classe: 'selo--alerta' };
    if (a?.cancelar_no_fim) return { texto: `Cancelada · acesso até ${fimData(org.plano_ate)}`, classe: 'selo--alerta' };
    if (['rejected', 'cancelled'].includes(a?.status_pagamento)) return { texto: 'Cobrança recusada: confira o cartão', classe: 'selo--alerta' };
    if (a?.forma === 'recorrente' && a.status === 'authorized') return { texto: `Cartão · renova em ${fimData(org.plano_ate)}`, classe: 'selo--sucesso' };
    return { texto: `Liberado até ${fimData(org.plano_ate)}`, classe: 'selo--sucesso' };
  }

  /** Linha do tempo do ciclo: plataforma até o fim, robô (Max) só nos primeiros dias. */
  function cicloHtml(org) {
    if (LH.plano.isento() || org.plano === 'gratuito' || !org.plano_ate || new Date(org.plano_ate) <= new Date()) return '';
    const r = LH.plano.robo();
    const robo = org.plano !== 'max' ? ''
      : r.liberado
        ? `<div class="uso__linha"><span>Robô Turbo 2.0</span><span class="selo selo--sucesso">liberado até ${esc(fimData(r.ate))}</span></div>`
        : `<div class="uso__linha"><span>Robô Turbo 2.0</span><span class="selo">volta em ${esc(fimData(org.plano_ate))}</span></div>`;
    return `<div class="uso">
      <div class="uso__linha"><span>Plataforma</span><span>até ${esc(fimData(org.plano_ate))}</span></div>
      ${robo}
    </div>`;
  }

  LH.vistas.perfil = {
    titulo: 'Dados da conta e assinatura',
    trilha: 'Meu Perfil',
    render: () => {
      const c = LH.repo.conta();
      const org = c.organizacao;
      const sit = situacaoAssinatura(org, c.assinatura);
      const isento = LH.plano.isento();
      const nivel = LH.plano.nivel();
      const pago = !isento && nivel !== 'free';
      const empresas = LH.repo.empresas().length;
      const podeGerenciar = ['dono', 'admin'].includes(c.papel);
      return `
      ${LH.cabecalho({ titulo: 'Dados da conta e assinatura', texto: 'Seus dados de acesso, o seu plano e os seus direitos sobre os dados (LGPD).' })}
      <div class="grade grade--lateral">
        <div class="grade" style="align-content:start">
          <form class="card spot form" id="form-perfil" data-reveal>
            <div class="card__titulo"><h2>${icone('usuario')} Dados da conta</h2></div>
            <div class="form__linha">
              ${campo('nome', 'Nome', c.nome, 'required maxlength="120"')}
              <label class="campo"><span class="campo__rotulo">E-mail</span><input value="${esc(c.email)}" disabled></label>
              ${campo('telefone', 'Telefone', c.telefone, 'type="tel" maxlength="30"')}
            </div>
            <label class="marcar"><input type="checkbox" name="marketing" id="marketing"> Quero receber novidades e dicas por e-mail (opcional)</label>
            <div class="card__rodape">
              <button class="btn btn--primario" type="submit">Salvar</button>
              <button class="btn" type="button" data-acao="senha">${icone('cadeado')} Trocar senha</button>
              ${LH.repo.modo === 'real' ? `<button class="btn btn--fantasma" type="button" data-acao="sair">${icone('sair')} Sair da conta</button>` : ''}
            </div>
          </form>
          <section class="card zona-perigo" data-reveal>
            <div class="card__titulo"><h2>${icone('escudo')} Seus dados (LGPD)</h2></div>
            <p class="suave">Você pode baixar uma cópia dos seus dados ou excluir a conta a qualquer momento.</p>
            <div class="card__rodape">
              <button class="btn" type="button" data-acao="exportar">${icone('baixar')} Baixar meus dados</button>
              <button class="btn btn--perigo" type="button" data-acao="excluir">${icone('lixeira')} Excluir minha conta</button>
            </div>
          </section>
        </div>
        <aside class="card--vidro plano-atual" data-reveal style="align-self:start;padding:24px;border-radius:var(--raio)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <strong style="font-size:1.1rem">Plano ${isento ? 'Isento' : NOMES_PLANO[org.plano] || 'Free'}</strong>
            <span class="selo ${isento ? 'selo--sucesso' : sit.classe}">${esc(isento ? 'Acesso total, sem cobrança' : sit.texto)}</span>
          </div>
          <div class="plano-atual__preco"><strong>R$ ${pago ? LH.plano.PRECOS[nivel] : 0}</strong><span class="suave">/mês</span></div>
          ${cicloHtml(org)}
          ${isento ? '<p class="nota">Sua conta é isenta: todos os recursos liberados (Prospecção e Robô Turbo 2.0), para sempre e sem cobrança.</p>' : ''}
          <div class="uso">
            <div class="uso__linha"><span>Empresas</span><span>${empresas} de ${org.limite_empresas}</span></div>
            <div class="barra"><div class="barra__preenchimento" style="width:${Math.min(100, (empresas / Math.max(1, org.limite_empresas)) * 100)}%"></div></div>
          </div>
          <div class="uso">
            <div class="uso__linha"><span>Leituras de edital por IA (este mês)</span><span id="uso-ia">…</span></div>
            <div class="barra"><div class="barra__preenchimento" id="barra-ia" style="width:0"></div></div>
          </div>
          ${!isento && nivel !== 'max' ? ['starter', 'max'].filter((p) => !(nivel === 'pro' && p === 'starter')).map((p) => {
            const max = p === 'max';
            return `<div class="assinar-plano${max ? ' assinar-plano--destaque' : ''}" data-plano-bloco="${p}">
              <strong>${max ? 'Max' : 'Pro'} · R$ ${LH.plano.PRECOS[max ? 'max' : 'pro']}/mês</strong>
              <p class="fraco">${max ? `Tudo do Pro + Robô Turbo 2.0 nos ${LH.plano.ciclo().roboDias} primeiros dias de cada ciclo, até 20 empresas e 60 leituras por IA por mês.` : 'Prospecção completa (Busca, Radar, Petronect, Favoritas), até 10 empresas e 30 leituras de edital por IA por mês.'}</p>
              <button class="btn ${max ? 'btn--primario' : ''} btn--bloco" type="button" data-acao="assinar" data-plano="${p}" data-forma="recorrente">${icone('raio')} Assinar com cartão de crédito</button>
            </div>`;
          }).join('') : ''}
          ${pago && nivel === 'pro' ? `<p class="fraco">Ao assinar o Max, um ciclo novo de ${LH.plano.ciclo().cicloDias} dias começa na hora da cobrança, com o robô liberado.</p>` : ''}
          ${pago && c.assinatura?.forma === 'recorrente' && c.assinatura?.status === 'authorized' && !c.assinatura?.cancelar_no_fim ? `<button class="btn btn--bloco" type="button" data-acao="cancelar">${icone('fechar')} Cancelar assinatura</button>` : ''}
          ${!podeGerenciar ? '<p class="nota">Só o dono ou um administrador da organização pode cuidar da assinatura.</p>' : ''}
          <p class="fraco">Pagamento seguro pelo Mercado Pago, no cartão de crédito, com renovação automática a cada ${LH.plano.ciclo().cicloDias} dias. Cancele quando quiser: o acesso segue até o fim do ciclo pago.</p>
        </aside>
      </div>`;
    },
    async montar(raiz, params) {
      const form = raiz.querySelector('#form-perfil');

      // Volta da página de pagamento: espera o aviso do Mercado Pago liberar o plano (o Pix pode levar alguns segundos).
      if (params.assinatura === 'sucesso') {
        history.replaceState(null, '', '#/perfil');
        LH.aviso('Cartão cadastrado! Aguardando a confirmação da cobrança pelo Mercado Pago...', 'sucesso', 6000);
        // Espera o ciclo novo aparecer (vale para quem era Free e para quem trocou Pro -> Max).
        const antes = LH.nuvem?.ctx?.organizacao?.plano_ate ?? null;
        for (let i = 0; i < 24 && (LH.nuvem?.ctx?.organizacao?.plano_ate ?? null) === antes; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          await LH.repo.recarregar().catch(() => {});
        }
        LH.ir('perfil');
        return;
      }

      // Veio da apresentação ou do convite de upgrade: destaca o plano escolhido.
      if (params.assinar) {
        history.replaceState(null, '', '#/perfil');
        const botao = raiz.querySelector(`[data-acao="assinar"][data-plano="${params.assinar === 'max' ? 'max' : 'starter'}"]`) || raiz.querySelector('[data-acao="assinar"]');
        if (botao) {
          botao.classList.add('destacar');
          botao.focus({ preventScroll: true });
          botao.scrollIntoView({ behavior: 'smooth', block: 'center' });
          LH.aviso('Último passo: escolha Pix, crédito ou débito para liberar o plano.', 'info', 8000);
        } else {
          LH.aviso(LH.plano.isento() ? 'Sua conta é isenta: tudo já está liberado.' : 'Você já tem o plano Max.', 'sucesso');
        }
      }

      LH.repo.marketing().then((m) => { raiz.querySelector('#marketing').checked = m; }).catch(() => {});
      LH.repo.usoIa().then(({ usadas, limite }) => {
        raiz.querySelector('#uso-ia').textContent = `${usadas} de ${limite}`;
        raiz.querySelector('#barra-ia').style.width = `${Math.min(100, (usadas / Math.max(1, limite)) * 100)}%`;
      }).catch(() => { raiz.querySelector('#uso-ia').textContent = '—'; });

      raiz.querySelector('#marketing').addEventListener('change', async (e) => {
        try {
          await LH.repo.definirMarketing(e.target.checked);
          LH.aviso(e.target.checked ? 'Você vai receber as novidades.' : 'Pronto: não enviaremos novidades.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        try {
          await LH.repo.salvarConta({ nome: form.nome.value, telefone: form.telefone.value });
          LH.atualizarUsuario?.();
          LH.aviso('Dados da conta salvos.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });

      LH.ao(raiz, 'click', '[data-acao]', async (e, b) => {
        const acao = b.dataset.acao;
        try {
          if (acao === 'senha') {
            if (LH.repo.modo === 'demo') return LH.aviso('Na demonstração não há senha para trocar.', 'info');
            LH.acesso.novaSenha();
          }
          if (acao === 'sair') await LH.nuvem.sair();
          if (acao === 'assinar') {
            b.disabled = true;
            window.location.href = await LH.repo.assinar(b.dataset.plano || 'starter', b.dataset.forma || 'recorrente');
          }
          if (acao === 'cancelar') {
            const ok = await LH.confirmar('Cancelar crédito automático', 'As próximas cobranças no cartão param. Você continua com acesso até o fim dos dias já pagos.', 'Cancelar cobrança', true);
            if (!ok) return;
            await LH.repo.cancelarAssinatura();
            await LH.repo.recarregar().catch(() => {});
            LH.aviso('Cobrança automática cancelada.', 'sucesso');
            LH.ir('perfil');
          }
          if (acao === 'exportar') {
            const dados = await LH.repo.exportar();
            const arquivo = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
            const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(arquivo), download: 'meus-dados-licitahub.json' });
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            LH.aviso('Cópia dos seus dados baixada.', 'sucesso');
          }
          if (acao === 'excluir') {
            const ok = await LH.confirmar('Excluir minha conta', 'A sua conta e os dados dela serão apagados para sempre. Se você for o único dono da organização, ela também será apagada, com empresas, CRM e análises. Esta ação não pode ser desfeita.', 'Excluir para sempre', true);
            if (!ok) return;
            await LH.repo.excluirConta();
            LH.aviso('Conta excluída. Sentiremos a sua falta.', 'sucesso', 6000);
            if (LH.repo.modo === 'demo') LH.ir('home');
          }
        } catch (erro) {
          b.disabled = false;
          LH.aviso(erro.message, 'perigo');
        }
      });
    },
  };

  // --- Ajuda -------------------------------------------------------------------------
  const FAQ = [
    ['Como funciona o pagamento?', 'Pelo Mercado Pago, no cartão de crédito, com renovação automática a cada 30 dias. Cada cobrança aprovada abre um ciclo novo.'],
    ['Por quanto tempo uso o Robô Turbo 2.0?', 'No plano Max, o robô fica liberado nos 7 primeiros dias de cada ciclo. Depois disso, o resto da plataforma continua liberado até o fim do ciclo, e o robô volta na renovação.'],
    ['Como cancelo a assinatura?', 'Em Meu Perfil, no botão Cancelar assinatura. A cobrança automática para, não há multa e o acesso segue até o fim do ciclo já pago.'],
    ['E se a cobrança do cartão for recusada?', 'O Mercado Pago tenta de novo nos dias seguintes. Se não houver pagamento, o acesso termina no fim do ciclo já pago. Confira o cartão no Mercado Pago.'],
    ['A IA substitui a leitura do edital?', 'Não. Ela adianta o trabalho e aponta riscos e divergências, mas pode errar. Confira sempre o edital original antes de enviar a proposta.'],
    ['De onde vêm as licitações?', 'Do PNCP (Portal Nacional de Contratações Públicas), atualizadas automaticamente várias vezes ao dia.'],
    ['Quantas empresas posso cadastrar?', 'No Free, até 3. No Pro, até 10. No Max, até 20.'],
    ['Vocês pedem a minha senha do gov.br?', 'Não. O monitoramento do chat usa só as informações públicas da sessão. Nunca peça nem passe a sua senha.'],
    ['Meus dados estão seguros?', 'Sim. Cada organização só vê os próprios dados, os acessos são protegidos e você pode baixar ou apagar seus dados a qualquer momento (LGPD).'],
    ['Posso emitir nota fiscal pelo Uso LicitaHub?', 'Ainda não. A cobrança da assinatura é feita pelo Mercado Pago; a nota fiscal do serviço é emitida à parte.'],
  ];
  const TUTORIAIS = ['Primeiros passos no Uso LicitaHub', 'Lendo um edital com a IA', 'Montando a proposta em 5 minutos', 'Organizando o CRM do licitante'];

  LH.vistas.ajuda = {
    titulo: 'Ajuda',
    render: () => `
      ${LH.cabecalho({ titulo: 'Ajuda', texto: 'Central de suporte, perguntas frequentes e tutoriais.' })}
      <section class="card spot" data-reveal>
        <label class="campo"><span class="campo__rotulo">Como podemos ajudar?</span><input type="search" id="busca-ajuda" placeholder="ex.: cancelar, teste grátis, IA"></label>
        <div id="faq" style="margin-top:16px">
          ${FAQ.map(([p, r]) => `<details class="sanfona" data-texto="${esc(`${p} ${r}`.toLowerCase())}"><summary>${esc(p)}${icone('setaBaixo')}</summary><div class="sanfona__corpo">${esc(r)}</div></details>`).join('')}
        </div>
        <p class="fraco" id="faq-vazio" hidden style="margin-top:12px">Nada encontrado. Fale com o suporte abaixo.</p>
      </section>
      <div class="secao__titulo" style="margin-top:22px"><h2>Tutoriais</h2></div>
      <div class="grade grade--4">
        <a class="card spot tutorial tutorial--disponivel" data-reveal href="#/robo?tutorial=1" style="text-align:left;color:inherit;text-decoration:none"><span class="tutorial__capa" style="background:center/cover url('video/robo-turbo-tutorial.jpg')">${icone('play')}</span><strong>Como usar o Robô Turbo 2.0 na prática</strong><span class="fraco">Vídeo · 3 min</span></a>
        ${TUTORIAIS.map((t) => `<button type="button" class="card spot tutorial" data-reveal data-tutorial style="text-align:left;color:inherit"><span class="tutorial__capa">${icone('play')}</span><strong>${esc(t)}</strong><span class="fraco">Vídeo · 3 min</span></button>`).join('')}
      </div>
      <div class="grade grade--3" style="margin-top:22px">
        <article class="card spot" data-reveal><div class="card__titulo"><h2>${icone('email')} E-mail</h2></div><p><a href="mailto:${esc(SUPORTE.email)}">${esc(SUPORTE.email)}</a></p><p class="fraco">${esc(SUPORTE.horario)}</p></article>
        <article class="card spot" data-reveal><div class="card__titulo"><h2>${icone('whatsapp')} WhatsApp</h2></div><p>${esc(SUPORTE.whatsapp)}</p><p class="fraco">${esc(SUPORTE.horario)}</p></article>
        <article class="card spot" data-reveal><div class="card__titulo"><h2>${icone('escudo')} Documentos legais</h2></div>
          <div class="chips"><button class="btn btn--pequeno" type="button" data-legal="termos">Termos de uso</button><button class="btn btn--pequeno" type="button" data-legal="privacidade">Privacidade</button><button class="btn btn--pequeno" type="button" data-legal="lgpd">LGPD</button></div></article>
      </div>`,
    montar(raiz) {
      const busca = raiz.querySelector('#busca-ajuda');
      busca.addEventListener('input', () => {
        const q = busca.value.trim().toLowerCase();
        let visiveis = 0;
        raiz.querySelectorAll('#faq .sanfona').forEach((d) => {
          const ok = !q || d.dataset.texto.includes(q);
          d.hidden = !ok;
          if (ok) visiveis++;
          d.open = Boolean(q) && ok;
        });
        raiz.querySelector('#faq-vazio').hidden = visiveis > 0;
      });
      LH.ao(raiz, 'click', '[data-tutorial]', () => LH.aviso('Os vídeos tutoriais entram na versão final.', 'info'));
    },
  };
})();
