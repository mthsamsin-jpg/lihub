/* =============================================================================
   Uso LicitaHub · suporte.js
   Botão do WhatsApp (canto da tela) com assuntos prontos: cada um abre o
   WhatsApp do suporte com a mensagem já organizada, para o cliente só completar.
   A saudação automática fica no próprio app WhatsApp Business (docs/WHATSAPP.md).
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // [título, campos para o cliente completar]. Usados também nas respostas rápidas do app.
  const ASSUNTOS = [
    ['Proposta comercial e declarações', ['Nº da proposta', 'O que tentei fazer', 'O que apareceu']],
    ['Busca, radar e favoritos', ['Palavras e filtros usados', 'Link ou nº da licitação', 'Minha dúvida']],
    ['Leitura de edital com IA', ['Link ou nº da licitação', 'O que veio errado ou faltou']],
    ['Robô Turbo 2.0', ['Portal', 'Nº do pregão e lote', 'Horário', 'O que o robô mostrou']],
    ['Assinatura, pagamento e nota', ['Data e valor da cobrança', 'Forma de pagamento', 'Minha dúvida']],
    ['Cancelamento', ['Motivo (opcional)', 'Minha dúvida']],
    ['Erro ou travamento no sistema', ['O que eu estava fazendo', 'Mensagem de erro', 'Computador ou celular / navegador']],
    ['Cadastro, login e senha', ['O que aparece ao entrar', 'Minha dúvida']],
    ['Sugestão de melhoria', ['Minha sugestão', 'Em qual tela']],
    ['Planos e contratação', ['O que minha empresa vende', 'Estados em que participo', 'Minha dúvida']],
    ['Outro assunto', ['Minha dúvida']],
  ];
  const s = () => LH.SUPORTE || {};

  /** Mensagem pronta. Só leva dados da conta de quem está logado (a pessoa vê antes de enviar). */
  function mensagem(titulo, campos, ctx = {}) {
    const linhas = ['Olá, equipe Uso LicitaHub!', '', `*Assunto:* ${titulo}`];
    if (ctx.email) linhas.push(`*Conta:* ${ctx.email}`);
    if (ctx.plano) linhas.push(`*Plano:* ${ctx.plano}`);
    if (ctx.tela) linhas.push(`*Tela:* ${ctx.tela}`);
    linhas.push('', ...campos.map((c) => `*${c}:* `));
    return linhas.join('\n');
  }
  const link = (texto) => `https://wa.me/${s().whatsappNumero}?text=${encodeURIComponent(texto)}`;
  const contexto = () => {
    const email = LH.nuvem?.usuario?.email || '';
    let plano = '';
    try { plano = email ? LH.plano?.nomeAtual?.() || '' : ''; } catch { /* sem plano */ }
    const rota = /^#\/[\w/-]+/.exec(location.hash)?.[0]; // sem ?id=... nem dados da tela
    return { email, plano, tela: email && rota ? rota.slice(1) : '' };
  };

  const ICONE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.2-1.4A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.5-.3z"/></svg>';

  function montar() {
    if (!s().whatsappNumero || document.querySelector('.zap')) return;
    const caixa = document.createElement('div');
    caixa.className = 'zap nao-imprimir';
    caixa.innerHTML = `
      <div class="zap__painel" id="zap-painel" role="dialog" aria-label="Suporte pelo WhatsApp" hidden>
        <div class="zap__topo"><strong>Fale com o suporte</strong><button type="button" class="zap__fechar" aria-label="Fechar">×</button></div>
        <p class="zap__texto">Escolha o assunto: o WhatsApp abre com a mensagem pronta, é só completar e enviar.</p>
        <ul class="zap__lista">${ASSUNTOS.map(([t], i) => `<li><a href="#" data-zap="${i}" target="_blank" rel="noopener">${LH.esc ? LH.esc(t) : t}</a></li>`).join('')}</ul>
        <p class="zap__rodape">${s().whatsapp} · ${s().horario || ''}<br>Nunca pedimos senha por WhatsApp.</p>
      </div>
      <button type="button" class="zap__botao" aria-label="Suporte pelo WhatsApp" aria-expanded="false" aria-controls="zap-painel">${ICONE}</button>`;
    document.body.append(caixa);
    const painel = caixa.querySelector('.zap__painel');
    const botao = caixa.querySelector('.zap__botao');
    const abrir = (sim) => {
      painel.hidden = !sim;
      botao.setAttribute('aria-expanded', String(sim));
      if (sim) painel.querySelector('a')?.focus();
    };
    botao.addEventListener('click', () => abrir(painel.hidden));
    caixa.querySelector('.zap__fechar').addEventListener('click', () => { abrir(false); botao.focus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !painel.hidden) { abrir(false); botao.focus(); } });
    document.addEventListener('click', (e) => { if (!painel.hidden && !caixa.contains(e.target)) abrir(false); });
    // O link é montado no clique: leva a tela e a conta do momento.
    caixa.addEventListener('click', (e) => {
      const a = e.target.closest('[data-zap]');
      if (!a) return;
      const [t, campos] = ASSUNTOS[Number(a.dataset.zap)];
      a.href = link(mensagem(t, campos, contexto()));
      abrir(false);
    });
    LH.abrirSuporte = () => abrir(true);
  }

  LH.suporteWhatsapp = { ASSUNTOS, mensagem, link };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
