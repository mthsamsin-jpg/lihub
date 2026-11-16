/* =============================================================================
   LicitaHub · legal.js
   Contatos do suporte e textos legais (termos, privacidade, LGPD), usados pela
   página de apresentação (index.html) e pelo painel (app.html).
   Textos-modelo: revisar com um advogado antes de publicar.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // Preencha com os dados reais antes de publicar o site.
  LH.SUPORTE = {
    email: 'suporte@seudominio.com.br',
    whatsapp: '(00) 00000-0000',
    horario: 'Segunda a sexta, das 9h às 18h',
    cnpj: '00.000.000/0001-00',
  };

  const LEGAL = {
    termos: ['Termos de uso', `
      <p>O LicitaHub é uma ferramenta de gestão e análise de licitações públicas. Ele organiza informações públicas, usa inteligência artificial para ajudar na leitura de editais e ajuda a montar documentos.</p>
      <p><strong>O LicitaHub não garante vitória em licitações.</strong> A IA pode errar: confira sempre o edital original. A responsabilidade final pelas propostas, declarações e documentos enviados é do usuário.</p>
      <p>Assinatura: plano Completo de R$ 97 por mês, com 30 dias grátis na primeira assinatura. Você pode cancelar quando quiser e continua com acesso até o fim do período já pago.</p>`],
    privacidade: ['Política de privacidade', `
      <p>Coletamos os dados do cadastro (nome, e-mail, telefone), os dados da empresa e o uso da plataforma, para prestar o serviço, cobrar a assinatura e dar suporte.</p>
      <p>Compartilhamos só o necessário com quem nos ajuda a prestar o serviço: hospedagem do banco de dados, processamento de pagamentos (Stripe) e o provedor de IA que lê os editais.</p>
      <p>Para falar com o encarregado de dados (DPO): ${LH.SUPORTE.email}.</p>`],
    lgpd: ['Seus direitos (LGPD)', `
      <p>Pela Lei Geral de Proteção de Dados (Lei nº 13.709/2018, art. 18), você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização ou eliminação, portabilidade, informação sobre com quem compartilhamos e revogação do consentimento.</p>
      <p>Em <a href="app.html#/perfil">Meu Perfil</a> você baixa uma cópia dos seus dados ou exclui a conta sozinho, a qualquer momento.</p>`],
  };

  LH.abrirLegal = (tipo) => {
    const [titulo, html] = LEGAL[tipo] || LEGAL.termos;
    LH.modal({ titulo, html: `${html}<p class="fraco">Texto-modelo: revisar com um advogado antes de publicar.</p>` });
  };
})();
