/* =============================================================================
   Uso LicitaHub · plano.js
   Paywall no navegador (o servidor confere de novo: src/pagamentos/acesso.js).
     free  sem Prospecção e sem Robô Turbo 2.0
     pro   R$ 97 a cada 15 dias: tudo, menos o Robô Turbo 2.0
     max   R$ 197 a cada 15 dias: tudo
   Conta isenta (organizacoes.isento) = acesso total, sem cobrança.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  const NIVEIS = ['free', 'pro', 'max'];
  const PRECOS = { pro: 97, max: 197 };
  const NOMES = { free: 'Free', pro: 'Pro', max: 'Max' };
  // Rota -> nível exigido.
  const ROTAS = { buscar: 'pro', radar: 'pro', petronect: 'pro', favoritas: 'pro', robo: 'max' };

  const nivelDoPlano = (p) => (p === 'max' ? 'max' : ['starter', 'prime', 'pro'].includes(p) ? 'pro' : 'free');

  LH.plano = {
    PRECOS,
    NOMES,
    ROTAS,
    /** Nível de quem está usando. A demonstração mostra tudo. */
    nivel() {
      if (LH.repo?.modo !== 'real') return 'max';
      const org = LH.nuvem?.ctx?.organizacao;
      if (!org) return 'free';
      if (org.isento === true) return 'max';
      if (org.plano_ate && new Date(org.plano_ate) <= new Date()) return 'free'; // 15 dias pagos venceram
      return nivelDoPlano(org.plano);
    },
    isento: () => LH.repo?.modo === 'real' && LH.nuvem?.ctx?.organizacao?.isento === true,
    nomeAtual() { return LH.plano.isento() ? 'Isento' : NOMES[nivelDoPlano(LH.nuvem?.ctx?.organizacao?.plano)]; },
    exigido: (rota) => ROTAS[rota] ?? null,
    permite(rota) {
      const e = ROTAS[rota];
      return !e || NIVEIS.indexOf(LH.plano.nivel()) >= NIVEIS.indexOf(e);
    },

    /** Conteúdo da tela bloqueada (aparece no lugar do módulo). */
    telaBloqueada(rota, titulo) {
      const e = ROTAS[rota];
      const robo = e === 'max';
      return `
        ${LH.cabecalho({ titulo, texto: robo ? 'Recurso do plano Max.' : 'Recurso do plano Pro.' })}
        <section class="card spot paywall" data-reveal>
          <div class="paywall__icone">${LH.icone('cadeado')}</div>
          <h2>${robo ? 'O Robô Turbo 2.0 é do plano Max' : `${LH.esc(titulo)} faz parte do plano Pro`}</h2>
          <p class="suave">${robo
            ? 'Dispute pregões com lances automáticos, sniper e previsões de fechamento. Assine o Max (R$ 197 a cada 15 dias) e libere tudo da plataforma.'
            : 'Busque licitações em todo o Brasil, use o Radar, o Petronect e salve as suas favoritas. Assine o Pro (R$ 97) ou o Max (R$ 197, com o Robô Turbo 2.0).'}</p>
          <button type="button" class="btn btn--primario btn--grande" data-upgrade="${e}">${LH.icone('raio')} Fazer upgrade</button>
        </section>
        ${robo && LH.tutorialRobo ? `<div style="margin-top:18px">${LH.tutorialRobo.html()}</div>` : ''}`;
    },

    /** Modal convidando para o upgrade. exigido: 'pro' | 'max'. */
    pedirUpgrade(exigido = 'pro') {
      const robo = exigido === 'max';
      LH.modal({
        titulo: robo ? 'Libere o Robô Turbo 2.0' : 'Libere a Prospecção',
        html: `
          <p>${robo
            ? 'O <strong>Robô Turbo 2.0</strong> faz parte do plano <strong>Max</strong>.'
            : 'Busca, Radar, Petronect e Favoritas fazem parte do plano <strong>Pro</strong>.'}</p>
          <div class="paywall__planos">
            ${robo ? '' : `<div class="paywall__plano"><strong>Pro</strong><span>R$ ${PRECOS.pro}/15 dias</span><small>Prospecção completa e todo o resto, menos o robô</small></div>`}
            <div class="paywall__plano paywall__plano--destaque"><strong>Max</strong><span>R$ ${PRECOS.max}/15 dias</span><small>Tudo, incluindo o Robô Turbo 2.0</small></div>
          </div>
          <p class="fraco">Pague pelo <strong>Mercado Pago</strong>: Pix, cartão de crédito ou débito (cada pagamento libera 15 dias).</p>
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
        if (bloqueado && !cad) {
          cad = document.createElement('span');
          cad.className = 'menu__cadeado';
          cad.title = `Plano ${NOMES[ROTAS[a.dataset.rota]]}`;
          cad.innerHTML = `${LH.icone('cadeado')}<span class="sr-only">(plano ${NOMES[ROTAS[a.dataset.rota]]})</span>`;
          a.append(cad);
        } else if (!bloqueado && cad) cad.remove();
      });
    },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-upgrade]');
    if (b) LH.plano.pedirUpgrade(b.dataset.upgrade);
  });
})();
