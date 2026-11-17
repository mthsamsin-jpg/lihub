// Confere se o Supabase está pronto para o LicitaHub e mostra o que falta.
//
//   npm run verificar                -> chaves, conexão, tabelas, segurança e catálogo
//   npm run verificar -- --completo  -> também cria um usuário de teste temporário
//                                       (apagado no fim) para testar o cadastro e
//                                       as permissões de quem está logado
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config.js';

const TABELAS = [
  'organizacoes', 'perfis', 'membros', 'empresas', 'licitacoes', 'licitacao_itens',
  'favoritos', 'kanban_etapas', 'crm_cards', 'analises_edital', 'consentimentos', 'sync_execucoes',
  'assinaturas', 'documentos', 'propostas', 'radares', 'eventos', 'monitoramentos',
];
const TABELA_INEXISTENTE = new Set(['PGRST205', '42P01']);
const SEM_PERMISSAO = '42501';
const semSessao = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

const { values: opcoes } = parseArgs({ options: { completo: { type: 'boolean', default: false } } });

let problemas = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const falha = (msg) => { problemas += 1; console.log(`  ✖ ${msg}`); };
const nota = (msg) => console.log(`  • ${msg}`);

function encerrar() {
  console.log(problemas
    ? `\n${problemas} problema(s). Corrija os itens com ✖ e rode de novo: npm run verificar\n`
    : '\nTudo certo com o Supabase.\n');
  process.exit(problemas ? 1 : 0);
}

/** Descobre se a chave é pública ou secreta (formatos novo e antigo). */
function lerChave(chave) {
  if (chave.startsWith('sb_publishable_')) return { tipo: 'publica' };
  if (chave.startsWith('sb_secret_')) return { tipo: 'secreta' };
  try {
    const p = JSON.parse(Buffer.from(chave.split('.')[1], 'base64url').toString('utf8'));
    const tipos = { anon: 'publica', service_role: 'secreta' };
    return { tipo: tipos[p.role] ?? 'desconhecida', ref: p.ref };
  } catch {
    return { tipo: 'desconhecida' };
  }
}

/** Conta linhas sem trazer dados (HEAD esconde "tabela não existe", então usa GET). */
function contar(cliente, tabela) {
  return cliente.from(tabela).select('*', { count: 'exact' }).limit(0);
}

async function verificarChaves() {
  const { url, chavePublica, chaveSecreta } = config.supabase;
  const faltando = [
    !url && 'SUPABASE_URL',
    !chavePublica && 'SUPABASE_PUBLISHABLE_KEY',
    !chaveSecreta && 'SUPABASE_SECRET_KEY',
  ].filter(Boolean);
  if (faltando.length) {
    falha(`Preencha no arquivo .env: ${faltando.join(', ')}`);
    encerrar();
  }

  let ref;
  try {
    const endereco = new URL(url);
    if (endereco.protocol !== 'https:') throw new Error('sem https');
    ref = endereco.hostname.split('.')[0];
  } catch {
    falha('SUPABASE_URL inválida. Use o "Project URL", ex.: https://abcdefgh.supabase.co');
    encerrar();
  }

  const publica = lerChave(chavePublica);
  const secreta = lerChave(chaveSecreta);
  if (publica.tipo === 'secreta') falha('Em SUPABASE_PUBLISHABLE_KEY está a chave SECRETA. Troque pela pública: a secreta nunca pode ir para o site.');
  else if (publica.tipo !== 'publica') falha('SUPABASE_PUBLISHABLE_KEY não parece uma chave pública do Supabase.');
  if (secreta.tipo === 'publica') falha('Em SUPABASE_SECRET_KEY está a chave pública. Cole a secreta (service_role).');
  else if (secreta.tipo !== 'secreta') falha('SUPABASE_SECRET_KEY não parece uma chave secreta do Supabase.');
  for (const [nome, chave] of [['pública', publica], ['secreta', secreta]]) {
    if (chave.ref && chave.ref !== ref) falha(`A chave ${nome} é de outro projeto (${chave.ref}), não de ${ref}.`);
  }
  if (problemas) encerrar();
  ok(`Chaves pública e secreta do projeto ${ref}`);

  try {
    const r = await fetch(new URL('/auth/v1/health', url), {
      headers: { apikey: chavePublica }, signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      falha(`O Supabase respondeu ${r.status}. Se o projeto estiver pausado, reative no painel (Restore project).`);
      encerrar();
    }
  } catch (e) {
    falha(`Não consegui conectar ao Supabase (${e.cause?.code ?? e.name}). Confira a internet e a SUPABASE_URL.`);
    encerrar();
  }
  ok('Conexão com o Supabase');
}

/**
 * Links dos e-mails (confirmação e nova senha): pede ao Supabase para voltar ao
 * SITE_URL com um token falso (não cria nem confirma nada) e vê para onde ele manda.
 * Se o endereço não estiver em "Redirect URLs", o Supabase usa a "Site URL" no lugar.
 */
async function verificarLinksEmail() {
  const site = config.site.url;
  if (/localhost|127\.0\.0\.1/.test(site)) {
    nota(`SITE_URL é ${site} (computador). No Render ela deve ser https://usolicitahub.com.br.`);
  }
  const destino = `${site}/app.html`;
  const teste = new URL('/auth/v1/verify', config.supabase.url);
  teste.search = new URLSearchParams({ token: 'teste-invalido', type: 'signup', redirect_to: destino });
  try {
    const r = await fetch(teste, { headers: { apikey: config.supabase.chavePublica }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const foiPara = r.headers.get('location') || '';
    if (foiPara.startsWith(destino)) return ok(`Links dos e-mails voltam para ${site}`);
    const base = foiPara.split('#')[0].split('?')[0] || '(nenhum)';
    falha(`Os links dos e-mails estão indo para ${base} em vez de ${site}. No Supabase: Authentication > URL Configuration > `
      + `Site URL = ${site} e, em Redirect URLs, adicione ${site}/**`);
  } catch (e) {
    nota(`Não consegui testar os links dos e-mails (${e.cause?.code ?? e.name}).`);
  }
}

async function verificarEstrutura(admin, visitante) {
  const faltam = [];
  const semPermissao = [];
  for (const tabela of TABELAS) {
    const { error } = await contar(admin, tabela);
    if (!error) continue;
    if (TABELA_INEXISTENTE.has(error.code)) faltam.push(tabela);
    else if (error.code === SEM_PERMISSAO) semPermissao.push(tabela);
    else falha(`Tabela ${tabela}: ${error.message}`);
  }
  if (faltam.length === TABELAS.length) {
    falha('O banco ainda não tem as tabelas do LicitaHub.');
    nota('Rode o arquivo supabase/schema.sql no SQL Editor do Supabase e depois: npm run verificar');
    encerrar();
  }
  if (faltam.length) falha(`Faltam tabelas: ${faltam.join(', ')}. Rode o supabase/schema.sql de novo.`);
  if (semPermissao.length) falha(`O sistema não tem permissão em: ${semPermissao.join(', ')}. Rode o supabase/schema.sql de novo.`);
  if (!faltam.length && !semPermissao.length) ok(`As ${TABELAS.length} tabelas do LicitaHub`);

  // Colunas adicionadas depois da primeira versão do schema.sql
  if (!faltam.includes('empresas')) {
    const { error: semColuna } = await admin.from('empresas').select('dados').limit(0);
    if (semColuna) falha('Falta a coluna "dados" na tabela empresas (versão nova do schema). Rode o supabase/schema.sql de novo.');
  }

  const busca = await admin.rpc('buscar_licitacoes', { p_limite: 1 });
  if (busca.error) falha(`Função de busca de licitações: ${busca.error.message}`);
  else ok('Função de busca de licitações');

  for (const [pasta, descricao] of [['editais', 'PDFs de editais'], ['documentos', 'documentos das empresas']]) {
    const { data: balde, error: erroBalde } = await admin.storage.getBucket(pasta);
    if (erroBalde || !balde) falha(`Falta o armazenamento de ${descricao} ("${pasta}"). Rode o supabase/schema.sql de novo.`);
    else if (balde.public) falha(`O armazenamento "${pasta}" está PÚBLICO. Ele precisa ser privado.`);
    else ok(`Armazenamento privado de ${descricao} ("${pasta}")`);
  }

  const anonimo = await visitante.from('licitacoes').select('id').limit(1);
  if (anonimo.error?.code === SEM_PERMISSAO) ok('Visitante sem login não acessa os dados');
  else if (!anonimo.error) falha('Visitante sem login tem acesso à tabela de licitações. Rode o supabase/schema.sql de novo.');
  else nota(`Teste do visitante sem login: ${anonimo.error.message}`);
}

/** Cria um usuário temporário, testa cadastro e permissões, e apaga tudo. */
async function verificarCadastro(admin) {
  const email = `verificacao-${randomBytes(4).toString('hex')}@example.com`;
  const senha = randomBytes(24).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: {
      nome: 'Verificação LicitaHub', empresa: 'Organização de teste',
      versao_termos: 'verificacao', versao_privacidade: 'verificacao', aceita_marketing: false,
    },
  });
  if (error) {
    falha(`Cadastro de usuário falhou: ${error.message}`);
    return;
  }

  const id = data.user.id;
  let org = null;
  try {
    const { data: perfil } = await admin.from('perfis').select('organizacao_padrao_id').eq('id', id).maybeSingle();
    org = perfil?.organizacao_padrao_id ?? null;
    const membro = org
      ? (await admin.from('membros').select('papel').eq('organizacao_id', org).eq('user_id', id).maybeSingle()).data
      : null;
    const etapas = org ? (await contar(admin, 'kanban_etapas').eq('organizacao_id', org)).count : 0;
    const consentimentos = (await contar(admin, 'consentimentos').eq('user_id', id)).count;
    if (org && membro?.papel === 'dono' && etapas === 7 && consentimentos === 3) {
      ok('Cadastro cria perfil, organização, dono, 7 etapas do Kanban e consentimentos');
    } else {
      falha(`Cadastro incompleto (perfil: ${perfil ? 'sim' : 'não'}, papel: ${membro?.papel ?? '-'}, etapas: ${etapas}, consentimentos: ${consentimentos})`);
    }

    const usuario = createClient(config.supabase.url, config.supabase.chavePublica, semSessao);
    const login = await usuario.auth.signInWithPassword({ email, password: senha });
    if (login.error) {
      falha(`Login do usuário de teste falhou: ${login.error.message}`);
      return;
    }
    const busca = await usuario.rpc('buscar_licitacoes', { p_limite: 1 });
    const orgs = await usuario.from('organizacoes').select('id');
    const interno = await usuario.from('sync_execucoes').select('id').limit(1);
    if (busca.error) falha(`Usuário logado não consegue buscar licitações: ${busca.error.message}`);
    else if (orgs.error || orgs.data.length !== 1 || orgs.data[0].id !== org) falha('Usuário logado deveria ver só a própria organização');
    else if (!interno.error) falha('Usuário logado consegue ver dados internos (sync_execucoes)');
    else ok('Usuário logado busca licitações, vê só a própria organização e não vê dados internos');
    await usuario.auth.signOut();
  } finally {
    const { error: erroExclusao } = await admin.auth.admin.deleteUser(id);
    if (erroExclusao) {
      falha(`Não consegui apagar o usuário de teste ${email}: ${erroExclusao.message}. Apague em Authentication > Users.`);
    } else if (org) {
      const sobrou = (await contar(admin, 'organizacoes').eq('id', org)).count;
      if (sobrou === 0) ok('Excluir a conta apaga a organização e os dados dela (LGPD)');
      else falha('A organização do usuário de teste não foi apagada junto com a conta.');
    }
  }
}

async function mostrarCatalogo(admin) {
  const { count } = await contar(admin, 'licitacoes');
  nota(`Licitações no banco: ${(count ?? 0).toLocaleString('pt-BR')}`);
  const { data: ultima, error } = await admin
    .from('sync_execucoes')
    .select('modo, status, gravados, iniciado_em')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    nota(`Não consegui ler o histórico de sincronizações: ${error.message}`);
  } else if (ultima) {
    const quando = new Date(ultima.iniciado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    nota(`Última sincronização com o PNCP: ${quando} (${ultima.modo}, ${ultima.status}, ${ultima.gravados} gravadas)`);
  } else {
    nota('Nenhuma sincronização com o PNCP ainda. Para a primeira carga: npm run sync');
  }
}

console.log('\nVerificando o Supabase do LicitaHub...\n');
await verificarChaves();
const admin = createClient(config.supabase.url, config.supabase.chaveSecreta, semSessao);
const visitante = createClient(config.supabase.url, config.supabase.chavePublica, semSessao);
await verificarEstrutura(admin, visitante);
await verificarLinksEmail();
if (opcoes.completo) await verificarCadastro(admin);
else nota('Para testar também o cadastro de usuários: npm run verificar -- --completo');
await mostrarCatalogo(admin);
encerrar();
