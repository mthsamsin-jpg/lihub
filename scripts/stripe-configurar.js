#!/usr/bin/env node
// Cria ou atualiza na Stripe os produtos e preços dos planos do Uso LicitaHub
// (src/pagamentos/planos.js) e o portal do assinante. Pode rodar quantas vezes
// quiser: só cria o que falta ou o que mudou.
//
//   npm run stripe:configurar              chave de teste (sk_test_...)
//   npm run stripe:configurar -- --real    obrigatório com a chave real (sk_live_...)
import { parseArgs } from 'node:util';
import { CICLOS, PLANOS, chavePreco, planosPagos } from '../src/pagamentos/planos.js';
import { EVENTOS_STRIPE, clienteStripe, modoDaChave } from '../src/pagamentos/stripe.js';

const { values: args } = parseArgs({ options: { real: { type: 'boolean', default: false } } });
const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const modo = modoDaChave();
if (!modo) {
  console.error('Defina STRIPE_SECRET_KEY no arquivo .env (painel da Stripe > Desenvolvedores > Chaves de API).');
  process.exit(1);
}
if (modo === 'real' && !args.real) {
  console.error('Esta é a chave REAL (sk_live_...). Para criar os planos no modo real, rode:\n  npm run stripe:configurar -- --real');
  process.exit(1);
}

const stripe = clienteStripe();
console.log(`\nConfigurando a Stripe (${modo === 'real' ? 'MODO REAL' : 'modo de teste, dinheiro de mentira'})...\n`);

try {
  // Com a chave de teste a resposta pode ser a da "Área restrita" (sandbox), que
  // nunca é ativada; por isso a ativação só é conferida no modo real.
  if (modo === 'real' && !(await stripe.accounts.retrieve()).charges_enabled) {
    console.log('  ! A conta ainda não pode receber pagamentos de verdade: termine a ativação no painel da Stripe.\n');
  }

  // Produtos do Uso LicitaHub já existentes (marcados pelo metadado licitahub_plano).
  const produtos = new Map();
  for await (const produto of stripe.products.list({ limit: 100 })) {
    if (produto.metadata?.licitahub_plano) produtos.set(produto.metadata.licitahub_plano, produto);
  }

  const paraOPortal = [];
  for (const id of planosPagos()) {
    const plano = PLANOS[id];
    const nome = `Uso LicitaHub ${plano.nome}`;
    const descricao = `Até ${plano.limites.empresas} empresas e ${plano.limites.analisesMes} leituras de edital por IA por mês.`;

    let produto = produtos.get(id);
    if (!produto) {
      produto = await stripe.products.create({ name: nome, description: descricao, metadata: { licitahub_plano: id } });
      console.log(`  + produto criado: ${nome}`);
    } else if (produto.name !== nome || produto.description !== descricao || !produto.active) {
      produto = await stripe.products.update(produto.id, { name: nome, description: descricao, active: true });
      console.log(`  ~ produto atualizado: ${nome}`);
    }

    const precos = [];
    for (const [ciclo, valor] of Object.entries(plano.precos)) {
      const intervalo = CICLOS[ciclo];
      const chave = chavePreco(id, ciclo);
      const { data: [atual] } = await stripe.prices.list({ lookup_keys: [chave], active: true, limit: 1 });
      const igual = atual && atual.unit_amount === valor && atual.currency === 'brl'
        && atual.recurring?.interval === intervalo && atual.product === produto.id;
      if (igual) {
        console.log(`  = ${plano.nome} ${ciclo}: ${reais(valor)} (já estava certo)`);
        precos.push(atual.id);
        continue;
      }
      const novo = await stripe.prices.create({
        product: produto.id,
        currency: 'brl',
        unit_amount: valor,
        recurring: { interval: intervalo },
        lookup_key: chave,
        transfer_lookup_key: true, // a chave passa para o preço novo
        nickname: `${plano.nome} ${ciclo}`,
        metadata: { plano: id, ciclo },
      });
      if (atual) await stripe.prices.update(atual.id, { active: false });
      console.log(`  + ${plano.nome} ${ciclo}: ${reais(valor)}`
        + (atual ? ` (antes ${reais(atual.unit_amount)}; quem já assina continua no preço antigo)` : ''));
      precos.push(novo.id);
    }
    paraOPortal.push({ product: produto.id, prices: precos });
  }

  // Portal do assinante: trocar cartão, ver faturas, cancelar e (se houver
  // mais de um preço) mudar de plano.
  const variosPrecos = paraOPortal.reduce((total, p) => total + p.prices.length, 0) > 1;
  const features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address', 'tax_id'] },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: variosPrecos
      ? { enabled: true, default_allowed_updates: ['price'], products: paraOPortal, proration_behavior: 'create_prorations' }
      : { enabled: false },
  };
  const { data: [padrao] } = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  if (padrao) await stripe.billingPortal.configurations.update(padrao.id, { features });
  else await stripe.billingPortal.configurations.create({ features });
  console.log(`  = portal do assinante: trocar cartão, ver faturas${variosPrecos ? ', mudar de plano' : ''} e cancelar no fim do período`);

  console.log(`
Pronto. Próximos passos:
  1. Avisos da Stripe (webhook). Com o servidor na internet, em Desenvolvedores > Webhooks,
     adicione o endereço  https://SEU-SERVIDOR/stripe/webhook  com estes eventos:
       ${EVENTOS_STRIPE.join('\n       ')}
     e copie o segredo (whsec_...) para STRIPE_WEBHOOK_SECRET no .env.
     No computador, para testar: stripe listen --forward-to localhost:8787/stripe/webhook
  2. Cartão de teste: 4242 4242 4242 4242, qualquer data futura e qualquer CVC.
  3. Para conferir o caminho todo sozinho (só modo de teste): npm run stripe:verificar
`);
} catch (e) {
  const motivo = e?.type === 'StripeAuthenticationError' ? 'a chave da Stripe foi recusada (confira STRIPE_SECRET_KEY)' : e.message;
  console.error(`\nNão consegui configurar a Stripe: ${motivo}`);
  process.exit(1);
}
