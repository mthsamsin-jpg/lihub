/* =============================================================================
   Uso LicitaHub · plano.js
   Paywall no navegador (o servidor e o banco conferem de novo:
   src/pagamentos/acesso.js e a função public.robo_liberado).
     free  sem Prospecção e sem Robô Turbo 2.0
     pro   R$ 97 por ciclo de 30 dias: tudo, menos o Robô Turbo 2.0
     max   R$ 197 por ciclo de 30 dias: tudo; o ROBÔ só nos primeiros dias de cada ciclo
   Assinatura no cartão com renovação automática. Cada cobrança aprovada abre um
   ciclo novo e reabre a janela do robô (dias configuráveis no servidor).
   Conta isenta (organizacoes.isento) = acesso total, sem cobrança e sem janela.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const NIVEIS = ['free', 'pro', 'max'];
  const PRECOS = { pro: 97, max: 197 };
  const NOMES = { free: 'Free', pro: 'Pro', max: 'Max' };
  // Rota -> nível exigido.
  const ROTAS = { buscar: 'pro', radar: 'pro', petronect: 'pro', favoritas: 'pro', robo: 'max' };

  const nivelDoPlano = (p) => (p === 'max' ? 'max' : ['starter', 'prime', 'pro'].includes(p) ? 'pro' : 'free');
  const ciclo = () => ({ cicloDias: 30, roboDias: 7, ...(window.LH_CONFIG?.assinatura || {}) });
  const dataCurta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

  LH.plano = {
    PRECOS,
    NOMES,
    ROTAS,
    ciclo,
    /** Nível de quem está usando. A demonstração mostra tudo. */
    nivel() {
      if (LH.repo?.modo !== 'real') return 'max';
      const org = LH.nuvem?.ctx?.organizacao;
      if (!org) return 'free';
      if (org.isento === true) return 'max';
      if (org.plano_ate && new Date(org.plano_ate) <= new Date()) return 'free'; // ciclo pago terminou
      return nivelDoPlano(org.plano);
    },
    isento: () => LH.repo?.modo === 'real' && LH.nuvem?.ctx?.organizacao?.isento === true,
    nomeAtual() { return LH.plano.isento() ? 'Isento' : NOMES[nivelDoPlano(LH.nuvem?.ctx?.organizacao?.plano)]; },
    exigido: (rota) => ROTAS[rota] ?? null,

    /**
     * Janela do robô no ciclo atual (mesma regra de src/pagamentos/ciclo.js).
     * { liberado, motivo: 'isento'|'janela'|'janela_encerrada'|'plano', ate?, volta? }
     */
    robo() {
      if (LH.repo?.modo !== 'real') return { liberado: true, motivo: 'demo' };
      const org = LH.nuvem?.ctx?.organizacao;
      if (org?.isento === true) return { liberado: true, motivo: 'isento' };
      const agora = new Date();
      if (org?.plano !== 'max' || !org?.plano_ate || new Date(org.plano_ate) <= agora) return { liberado: false, motivo: 'plano' };
      const dentro = (!org.robo_de || new Date(org.robo_de) <= agora) && new Date(org.robo_ate ?? org.plano_ate) > agora;
      return dentro
        ? { liberado: true, motivo: 'janela', ate: org.robo_ate ?? org.plano_ate }
        : { liberado: false, motivo: 'janela_encerrada', volta: org.plano_ate };
    },

    permite(rota) {
      const e = ROTAS[rota];
      if (!e) return true;
      if (NIVEIS.indexOf(LH.plano.nivel()) < NIVEIS.indexOf(e)) return false;
      return rota === 'robo' ? LH.plano.robo().liberado : true;
    },

    /** Conteúdo da tela bloqueada (aparece no lugar do módulo). */
    telaBloqueada(rota, titulo) {
      const e = ROTAS[rota];
      const robo = e === 'max';
      const r = robo ? LH.plano.robo() : null;
      // Max com a janela do robô encerrada: a plataforma segue liberada; o robô volta na renovação.
      if (r?.motivo === 'janela_encerrada') {
        const { roboDias } = ciclo();
        const cancelando = LH.nuvem?.ctx?.assinatura?.cancelar_no_fim === true;
        return `
        ${LH.cabecalho({ titulo, texto: `Robô liberado nos ${roboDias} primeiros dias de cada ciclo.` })}
        <section class="card spot paywall" data-reveal>
          <div class="paywall__icone">${LH.icone('relogio')}</div>
          <h2>O período do robô deste ciclo terminou</h2>
          <p class="suave">No plano Max, o Robô Turbo 2.0 fica liberado nos <strong>${roboDias} primeiros dias</strong> de cada ciclo. O resto da plataforma continua liberado até <strong>${LH.esc(dataCurta(r.volta))}</strong>.</p>
          <p class="suave">${cancelando
            ? 'Sua assinatura está cancelada: o robô não volta. Assine de novo para um ciclo novo.'
            : `O robô volta sozinho na renovação automática, em <strong>${LH.esc(dataCurta(r.volta))}</strong>.`}</p>
          <a class="btn btn--grande" href="#/perfil">${LH.icone('usuario')} Ver minha assinatura</a>
        </section>
        ${LH.tutorialRobo ? `<div style="margin-top:18px">${LH.tutorialRobo.html()}</div>` : ''}`;
      }
      return `
        ${LH.cabecalho({ titulo, texto: robo ? 'Recurso do plano Max.' : 'Recurso do plano Pro.' })}
        <section class="card spot paywall" data-reveal>
          <div class="paywall__icone">${LH.icone('cadeado')}</div>
          <h2>${robo ? 'O Robô Turbo 2.0 é do plano Max' : `${LH.esc(titulo)} faz parte do plano Pro`}</h2>
          <p class="suave">${robo
            ? `Dispute pregões com lances automáticos, sniper e previsões de fechamento. Assine o Max (R$ ${PRECOS.max}/mês no cartão): robô nos ${ciclo().roboDias} primeiros dias de cada ciclo e toda a plataforma o mês inteiro.`
            : `Busque licitações em todo o Brasil, use o Radar, o Petronect e salve as suas favoritas. Assine o Pro (R$ ${PRECOS.pro}/mês) ou o Max (R$ ${PRECOS.max}/mês, com o Robô Turbo 2.0).`}</p>
          <button type="button" class="btn btn--primario btn--grande" data-upgrade="${e}">${LH.icone('raio')} Fazer upgrade</button>
        </section>
        ${robo && LH.tutorialRobo ? `<div style="margin-top:18px">${LH.tutorialRobo.html()}</div>` : ''}`;
    },

    /** Modal convidando para o upgrade. exigido: 'pro' | 'max'. */
    pedirUpgrade(exigido = 'pro') {
      const robo = exigido === 'max';
      // Já é Max e só a janela do robô fechou: não há upgrade a fazer (a tela do robô já
      // explica quando ele volta). Não navega daqui: quem chama pode ser o próprio roteador.
      if (robo && LH.plano.robo().motivo === 'janela_encerrada') return;
      const { cicloDias, roboDias } = ciclo();
      LH.modal({
        titulo: robo ? 'Libere o Robô Turbo 2.0' : 'Libere a Prospecção',
        html: `
          <p>${robo
            ? 'O <strong>Robô Turbo 2.0</strong> faz parte do plano <strong>Max</strong>.'
            : 'Busca, Radar, Petronect e Favoritas fazem parte do plano <strong>Pro</strong>.'}</p>
          <div class="paywall__planos">
            ${robo ? '' : `<div class="paywall__plano"><strong>Pro</strong><span>R$ ${PRECOS.pro}/mês</span><small>Prospecção completa e todo o resto, menos o robô</small></div>`}
            <div class="paywall__plano paywall__plano--destaque"><strong>Max</strong><span>R$ ${PRECOS.max}/mês</span><small>Tudo + Robô Turbo 2.0 nos ${roboDias} primeiros dias de cada ciclo</small></div>
          </div>
          <p class="fraco">Assinatura no <strong>cartão de crédito</strong> pelo Mercado Pago, renovada automaticamente a cada ${cicloDias} dias. Cancele quando quiser, sem multa.</p>
          <p class="fraco">Seu plano atual: ${LH.esc(LH.plano.nomeAtual())}.</p>`,
        acoes: [
          { rotulo: 'Agora não' },
          ...(robo ? [] : [{ rotulo: 'Assinar Pro', classe: '', acao: (f) => { f(); LH.ir('perfil?assinar=starter'); } }]),
          { rotulo: 'Assinar Max', classe: 'btn--primario', acao: (f) => { f(); LH.ir('perfil?assinar=max'); } },
        ],
      });
    },

    /** Cadeado no menu nos itens que o plano atual não libera. */
    marcarMenu() {
      document.querySelectorAll('#menu [data-rota]').forEach((a) => {
        const bloqueado = !LH.plano.permite(a.dataset.rota);
        a.classList.toggle('menu__link--bloqueado', bloqueado);
        let cad = a.querySelector('.menu__cadeado');
        const janela = a.dataset.rota === 'robo' && LH.plano.robo().motivo === 'janela_encerrada';
        const dica = janela ? 'Período do robô encerrado neste ciclo' : `Plano ${NOMES[ROTAS[a.dataset.rota]]}`;
        if (bloqueado && !cad) {
          cad = document.createElement('span');
          cad.className = 'menu__cadeado';
          a.append(cad);
        }
        if (bloqueado) {
          cad.title = dica;
          cad.innerHTML = `${LH.icone(janela ? 'relogio' : 'cadeado')}<span class="sr-only">(${LH.esc(dica)})</span>`;
        } else if (cad) cad.remove();
      });
    },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-upgrade]');
    if (b) LH.plano.pedirUpgrade(b.dataset.upgrade);
  });

  // A janela do robô pode fechar com o app aberto: confere a cada minuto e, se mudou,
  // atualiza o menu e tira a pessoa da tela do robô.
  let ultimo = null;
  setInterval(() => {
    if (LH.repo?.modo !== 'real' || !LH.nuvem?.ctx) return;
    const agora = LH.plano.robo().liberado;
    if (ultimo !== null && agora !== ultimo) {
      LH.plano.marcarMenu();
      if (/^#\/robo\b/.test(location.hash)) location.reload();
    }
    ultimo = agora;
  }, 60_000);
})();
