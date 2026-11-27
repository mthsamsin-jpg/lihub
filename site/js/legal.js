/* =============================================================================
   Uso LicitaHub · legal.js
   Contatos do suporte e textos legais (termos, privacidade, LGPD), usados pela
   página de apresentação (index.html) e pelo painel (app.html).
   Textos-modelo: revisar com um advogado antes de publicar.
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // Preencha com os dados reais antes de publicar o site.
  LH.SUPORTE = {
    email: 'suporte@seudominio.com.br',
    whatsapp: '(48) 99145-4256',
    whatsappNumero: '5548991454256',
    horario: 'Segunda a sexta, das 9h às 18h',
    cnpj: '00.000.000/0001-00',
  };

  const LEGAL = {
    termos: ['Termos de uso', `
      <p>O Uso LicitaHub é uma ferramenta de gestão e análise de licitações públicas. Ele organiza informações públicas, usa inteligência artificial para ajudar na leitura de editais e ajuda a montar documentos.</p>
      <p><strong>O Uso LicitaHub não garante vitória em licitações.</strong> A IA pode errar: confira sempre o edital original. A responsabilidade final pelas propostas, declarações e documentos enviados é do usuário.</p>
      <p>Assinatura: plano Pro (R$ 97 por ciclo de 30 dias) ou Max (R$ 197 por ciclo de 30 dias), cobrados no cartão de crédito pelo Mercado Pago, com renovação automática a cada ciclo. No plano Max, o Robô Turbo 2.0 fica disponível nos 7 primeiros dias de cada ciclo; os demais recursos, durante o ciclo inteiro. O cancelamento pode ser feito a qualquer momento, sem multa: a cobrança automática para e o acesso segue até o fim do ciclo já pago. Se uma cobrança for recusada, o acesso termina no fim do ciclo pago.</p>`],
    privacidade: ['Política de privacidade', `
      <p>Coletamos os dados do cadastro (nome, e-mail, telefone), os dados da empresa e o uso da plataforma, para prestar o serviço, cobrar a assinatura e dar suporte.</p>
      <p>Compartilhamos só o necessário com quem nos ajuda a prestar o serviço: hospedagem do banco de dados, processamento de pagamentos (Mercado Pago) e o provedor de IA que lê os editais.</p>
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
