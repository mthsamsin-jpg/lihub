// Tira os e-mails de cadastro e de senha do spam: faz o Supabase enviar pelo
// Resend com o domínio usolicitahub.com.br (SPF/DKIM/DMARC já publicados no DNS),
// com remetente próprio e modelos em português.
//
//   npm run email:configurar              -> só confere (Resend e Supabase) e mostra o que vai mudar
//   npm run email:configurar -- --aplicar -> aplica no Supabase
//
// Precisa no .env:
//   RESEND_API_KEY          chave do Resend (resend.com > API Keys; permissão "Sending access" basta)
//   SUPABASE_ACCESS_TOKEN   token pessoal do Supabase (supabase.com/dashboard/account/tokens)
//   EMAIL_REMETENTE         opcional (padrão: nao-responda@usolicitahub.com.br)
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';

const DOMINIO = 'usolicitahub.com.br';
const REMETENTE = process.env.EMAIL_REMETENTE?.trim() || `nao-responda@${DOMINIO}`;
const NOME = 'Uso LicitaHub';
// Os modelos apontam o link para {{ .SiteURL }}/app.html (mesmo domínio do remetente):
// o site confirma o código (site/js/nuvem.js). Por isso o Site URL precisa ser o do site.

const { values: opcoes } = parseArgs({ options: { aplicar: { type: 'boolean', default: false } } });
const ok = (m) => console.log(`  ✔ ${m}`);
const falha = (m) => console.log(`  ✖ ${m}`);
const nota = (m) => console.log(`  • ${m}`);

function sair(msg) { console.log(`\n${msg}\n`); process.exit(1); }

const refDoProjeto = (url) => /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url || '')?.[1] || null;

async function lerJson(resposta) {
  const texto = await resposta.text();
  try { return JSON.parse(texto); } catch { return { mensagem: texto.slice(0, 300) }; }
}

async function conferirResend(chave) {
  console.log('\nResend (quem entrega os e-mails)');
  const r = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${chave}` } });
  if (r.status === 401 || r.status === 403) {
    // Chave só de envio não lista domínios: segue, mas sem conferir a verificação.
    nota('A chave não tem permissão para listar domínios (chave só de envio). Confira em resend.com/domains se o domínio está "Verified".');
    return true;
  }
  const j = await lerJson(r);
  if (!r.ok) { falha(`O Resend respondeu ${r.status}: ${j.message || j.mensagem || ''}`); return false; }
  const dominio = (j.data || []).find((d) => d.name === DOMINIO);
  if (!dominio) { falha(`O domínio ${DOMINIO} não está cadastrado nesta conta do Resend.`); return false; }
  if (dominio.status !== 'verified') { falha(`O domínio ${DOMINIO} está "${dominio.status}" no Resend (precisa estar "verified").`); return false; }
  ok(`Domínio ${DOMINIO} verificado no Resend (região ${dominio.region || '?'}).`);
  return true;
}

async function main() {
  const chaveResend = process.env.RESEND_API_KEY?.trim();
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const ref = refDoProjeto(config.supabase.url);
  if (!chaveResend || !token) {
    sair(`Faltam chaves no .env:${!chaveResend ? '\n  RESEND_API_KEY=        (resend.com > API Keys > Create, permissão "Sending access")' : ''}${!token ? '\n  SUPABASE_ACCESS_TOKEN= (supabase.com/dashboard/account/tokens > Generate new token)' : ''}\nDepois rode de novo: npm run email:configurar`);
  }
  if (!ref) sair('SUPABASE_URL não está no formato https://<projeto>.supabase.co');

  if (!(await conferirResend(chaveResend))) sair('Resolva o domínio no Resend primeiro (o DNS do registro.br já tem os registros; clique em "Verify" no Resend).');

  console.log('\nSupabase (Authentication > Emails)');
  const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const cabecalhos = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const atual = await fetch(api, { headers: cabecalhos });
  const cfg = await lerJson(atual);
  if (!atual.ok) sair(`Não consegui ler a configuração do Supabase (${atual.status}): ${cfg.message || cfg.mensagem || ''}. Confira o SUPABASE_ACCESS_TOKEN.`);
  if (cfg.smtp_host) nota(`Hoje: SMTP próprio ${cfg.smtp_host}, remetente ${cfg.smtp_admin_email || '?'}.`);
  else falha('Hoje: e-mail EMBUTIDO do Supabase (remetente genérico, sem o seu domínio). É isso que cai no spam.');

  const [confirmacao, recuperacao] = await Promise.all([
    readFile(new URL('../supabase/emails/confirmacao.html', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/emails/recuperacao.html', import.meta.url), 'utf8'),
  ]);
  const novo = {
    smtp_host: 'smtp.resend.com',
    smtp_port: '465',
    smtp_user: 'resend',
    smtp_pass: chaveResend,
    smtp_admin_email: REMETENTE,
    smtp_sender_name: NOME,
    mailer_subjects_confirmation: 'Confirme seu e-mail no Uso LicitaHub',
    mailer_templates_confirmation_content: confirmacao,
    mailer_subjects_recovery: 'Criar uma senha nova no Uso LicitaHub',
    mailer_templates_recovery_content: recuperacao,
    // Com SMTP próprio o limite deixa de ser o do e-mail embutido (poucos por hora).
    rate_limit_email_sent: Math.max(Number(cfg.rate_limit_email_sent) || 0, 100),
  };
  nota(`Vai usar: smtp.resend.com:465, remetente "${NOME} <${REMETENTE}>", modelos em português (supabase/emails/), até ${novo.rate_limit_email_sent} e-mails/hora.`);

  if (!opcoes.aplicar) {
    console.log('\nNada foi alterado. Para aplicar: npm run email:configurar -- --aplicar\n');
    return;
  }
  const r = await fetch(api, { method: 'PATCH', headers: cabecalhos, body: JSON.stringify(novo) });
  const j = await lerJson(r);
  if (!r.ok) sair(`O Supabase recusou a configuração (${r.status}): ${j.message || j.mensagem || ''}`);
  ok('SMTP do Resend, remetente e modelos aplicados no Supabase.');
  console.log('\nTeste: faça um cadastro novo (ou "Esqueci a senha") e confira a caixa de entrada.\n'
    + 'Se ainda for para o spam numa conta, marque "Não é spam" uma vez: o provedor aprende o remetente.\n');
}

main().catch((e) => sair(`Erro: ${e.message}`));
