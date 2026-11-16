/* =============================================================================
   LicitaHub · Conta
   Sua empresa, Meu Perfil (dados da conta e assinatura) e Ajuda
   (perguntas frequentes, tutoriais, suporte e textos legais).
   No modo real: empresas e perfil no Supabase; assinatura pela Stripe.
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;

  const SUPORTE = LH.SUPORTE; // contatos e textos legais ficam em js/legal.js
  const PLANO = { nome: 'Completo', preco: 97, diasTeste: 7 };

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
  const NOMES_PLANO = { gratuito: 'Gratuito', starter: 'Completo', prime: 'Completo', pro: 'Completo' };

  function situacaoAssinatura(org, a) {
    if (!a?.status || ['canceled', 'incomplete_expired'].includes(a.status)) return { texto: org.plano === 'gratuito' ? 'Plano gratuito' : 'Sem assinatura', classe: '' };
    const fim = (iso) => (iso ? fmt.data(LH.datas.paraIso(new Date(iso))) : '');
    if (a.cancelar_no_fim) return { texto: `Cancela em ${fim(a.periodo_fim)}`, classe: 'selo--alerta' };
    if (a.status === 'trialing') return { texto: `Teste grátis até ${fim(a.teste_fim) || fmt.data(a.teste_fim)}`, classe: 'selo--info' };
    if (a.status === 'active') return { texto: `Ativa · renova em ${fim(a.periodo_fim)}`, classe: 'selo--sucesso' };
    if (a.status === 'past_due') return { texto: 'Pagamento atrasado: atualize o cartão', classe: 'selo--perigo' };
    return { texto: a.status, classe: '' };
  }

  LH.vistas.perfil = {
    titulo: 'Dados da conta e assinatura',
    trilha: 'Meu Perfil',
    render: () => {
      const c = LH.repo.conta();
      const org = c.organizacao;
      const sit = situacaoAssinatura(org, c.assinatura);
      const pago = org.plano !== 'gratuito';
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
            <strong style="font-size:1.1rem">Plano ${NOMES_PLANO[org.plano] || 'Gratuito'}</strong>
            <span class="selo ${sit.classe}">${esc(sit.texto)}</span>
          </div>
          <div class="plano-atual__preco"><strong>R$ ${pago ? PLANO.preco : 0}</strong><span class="suave">/mês</span></div>
          <div class="uso">
            <div class="uso__linha"><span>Empresas</span><span>${empresas} de ${org.limite_empresas}</span></div>
            <div class="barra"><div class="barra__preenchimento" style="width:${Math.min(100, (empresas / Math.max(1, org.limite_empresas)) * 100)}%"></div></div>
          </div>
          <div class="uso">
            <div class="uso__linha"><span>Leituras de edital por IA (este mês)</span><span id="uso-ia">…</span></div>
            <div class="barra"><div class="barra__preenchimento" id="barra-ia" style="width:0"></div></div>
          </div>
          ${!pago ? `<button class="btn btn--primario btn--bloco btn--grande" type="button" data-acao="assinar">${icone('raio')} Assinar o Completo · ${PLANO.diasTeste} dias grátis</button>
            <p class="fraco">R$ ${PLANO.preco}/mês depois do teste: até 10 empresas e 30 leituras de edital por IA por mês.</p>` : ''}
          ${c.assinatura?.stripe_cliente_id || LH.repo.modo === 'demo' ? `<button class="btn btn--bloco" type="button" data-acao="portal">${icone('engrenagem')} Gerenciar assinatura</button>` : ''}
          ${!podeGerenciar ? '<p class="nota">Só o dono ou um administrador da organização pode cuidar da assinatura.</p>' : ''}
          <p class="fraco">Pagamento seguro pela Stripe. Cobrança mensal no cartão; cancele quando quiser e use até o fim do período pago.</p>
        </aside>
      </div>`;
    },
    async montar(raiz, params) {
      const form = raiz.querySelector('#form-perfil');

      // Volta da página de pagamento: espera o aviso da Stripe liberar o plano.
      if (params.assinatura === 'sucesso') {
        history.replaceState(null, '', '#/perfil');
        LH.aviso('Pagamento recebido! Liberando o seu plano...', 'sucesso', 6000);
        for (let i = 0; i < 12 && LH.repo.conta().organizacao.plano === 'gratuito'; i++) {
          await new Promise((r) => setTimeout(r, 2500));
          await LH.repo.recarregar().catch(() => {});
        }
        LH.ir('perfil');
        return;
      }

      // Veio da apresentação por "Garantir meus 7 dias grátis": destaca o botão de assinar.
      if (params.assinar) {
        history.replaceState(null, '', '#/perfil');
        const botao = raiz.querySelector('[data-acao="assinar"]');
        if (botao) {
          botao.classList.add('destacar');
          botao.focus({ preventScroll: true });
          botao.scrollIntoView({ behavior: 'smooth', block: 'center' });
          LH.aviso('Último passo: clique em "Assinar o Completo" para começar os seus 7 dias grátis.', 'info', 8000);
        } else {
          LH.aviso('Você já tem o plano Completo.', 'sucesso');
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
          if (acao === 'assinar' || acao === 'portal') {
            b.disabled = true;
            const url = acao === 'assinar' ? await LH.repo.assinar() : await LH.repo.portal();
            window.location.href = url;
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
    ['Como funciona o teste grátis?', 'Ao assinar o plano Completo você usa 7 dias sem pagar nada. Se cancelar antes do fim do teste, não há cobrança.'],
    ['Como cancelo a assinatura?', 'Em Meu Perfil > Gerenciar assinatura. O cancelamento vale no fim do período já pago e não tem multa.'],
    ['A IA substitui a leitura do edital?', 'Não. Ela adianta o trabalho e aponta riscos e divergências, mas pode errar. Confira sempre o edital original antes de enviar a proposta.'],
    ['De onde vêm as licitações?', 'Do PNCP (Portal Nacional de Contratações Públicas), atualizadas automaticamente várias vezes ao dia.'],
    ['Quantas empresas posso cadastrar?', 'No plano Completo, até 10 empresas. No gratuito, até 3.'],
    ['Vocês pedem a minha senha do gov.br?', 'Não. O monitoramento do chat usa só as informações públicas da sessão. Nunca peça nem passe a sua senha.'],
    ['Meus dados estão seguros?', 'Sim. Cada organização só vê os próprios dados, os acessos são protegidos e você pode baixar ou apagar seus dados a qualquer momento (LGPD).'],
    ['Posso emitir nota fiscal pelo LicitaHub?', 'Ainda não. A cobrança da assinatura é feita pela Stripe; a nota fiscal do serviço é emitida à parte.'],
  ];
  const TUTORIAIS = ['Primeiros passos no LicitaHub', 'Lendo um edital com a IA', 'Montando a proposta em 5 minutos', 'Organizando o CRM do licitante'];

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
