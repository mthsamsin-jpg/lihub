/* =============================================================================
   Uso LicitaHub · landing.js
   Página de apresentação (index.html): ícones, animações ao rolar, brilho que
   segue o mouse (de nucleo.js), menu do celular, textos legais e o atalho
   "Ir para o painel" para quem já entrou. Os botões de ação levam ao painel
   (app.html), que abre o cadastro ou o login.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // Ícones SVG nos lugares marcados com data-icone
  document.querySelectorAll('[data-icone]').forEach((el) => { el.innerHTML = LH.icone(el.dataset.icone); });

  // Entrada suave dos blocos ao rolar e contagem dos números
  LH.revelar(document);

  // Menu do celular
  const nav = document.getElementById('nav');
  const botaoMenu = nav.querySelector('.nav-pub__menu');
  const alternarMenu = (abrir = !nav.classList.contains('aberta')) => {
    nav.classList.toggle('aberta', abrir);
    botaoMenu.setAttribute('aria-expanded', String(abrir));
    botaoMenu.setAttribute('aria-label', abrir ? 'Fechar menu' : 'Abrir menu');
    botaoMenu.querySelector('.ic').innerHTML = LH.icone(abrir ? 'fechar' : 'menu');
  };
  botaoMenu.addEventListener('click', () => alternarMenu());
  nav.addEventListener('click', (e) => { if (e.target.closest('a') && nav.classList.contains('aberta')) alternarMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') alternarMenu(false); });

  // Sombra na barra depois que a página rola
  const aoRolar = () => nav.classList.toggle('rolou', window.scrollY > 8);
  window.addEventListener('scroll', aoRolar, { passive: true });
  aoRolar();

  // Quem já entrou no painel (sessão do Supabase guardada) vê "Ir para o painel"
  try {
    if (Object.keys(localStorage).some((chave) => /^sb-.+-auth-token$/.test(chave))) document.body.classList.add('logado');
  } catch { /* sem armazenamento: mostra Entrar / Começar agora */ }

  // Textos legais, suporte, CNPJ e ano
  document.addEventListener('click', (e) => {
    const legal = e.target.closest('[data-legal]');
    if (!legal) return;
    e.preventDefault();
    LH.abrirLegal(legal.dataset.legal);
  });
  document.getElementById('link-suporte').href = `mailto:${LH.SUPORTE.email}`;
  document.getElementById('cnpj').textContent = LH.SUPORTE.cnpj;
  document.getElementById('ano').textContent = String(new Date().getFullYear());
})();
