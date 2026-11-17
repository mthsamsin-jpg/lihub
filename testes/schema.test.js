// Testa supabase/schema.sql num PostgreSQL local (PGlite), sem precisar de
// conta no Supabase. Rode com: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const raiz = new URL('../', import.meta.url);
let db;
const ids = {};

// Executa uma consulta como um usuário logado (papel "authenticated").
async function como(userId, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await tx.exec('set local role authenticated');
    return tx.query(sql, params);
  });
}

async function criarUsuario(email, meta) {
  const r = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify(meta)],
  );
  return r.rows[0].id;
}

async function orgDe(userId) {
  const r = await db.query(`select organizacao_padrao_id as id from public.perfis where id = $1`, [userId]);
  return r.rows[0].id;
}

before(async () => {
  db = await PGlite.create({ extensions: { unaccent } });
  await db.exec(await readFile(new URL('testes/supabase-simulado.sql', raiz), 'utf8'));
  // Tabela de "outro sistema" no mesmo projeto: o esquema não pode mexer nela.
  await db.exec(`create table public.outro_sistema (id int primary key);
                 grant select, insert on public.outro_sistema to anon;`);
  const schema = await readFile(new URL('supabase/schema.sql', raiz), 'utf8');
  await db.exec(schema);
  await db.exec(schema); // precisa poder rodar duas vezes (idempotente)

  ids.a = await criarUsuario('ana@exemplo.com', {
    nome: 'Ana', empresa: 'Consultoria Ana',
    versao_termos: '2026-11', versao_privacidade: '2026-11', aceita_marketing: false,
  });
  ids.b = await criarUsuario('beto@exemplo.com', { nome: 'Beto' });
  ids.orgA = await orgDe(ids.a);
  ids.orgB = await orgDe(ids.b);
});

test('cadastro cria perfil, organização, papel de dono, etapas e consentimentos', async () => {
  const perfil = await db.query(`select nome from public.perfis where id = $1`, [ids.a]);
  assert.equal(perfil.rows[0].nome, 'Ana');

  const org = await db.query(`select nome, plano from public.organizacoes where id = $1`, [ids.orgA]);
  assert.deepEqual(org.rows[0], { nome: 'Consultoria Ana', plano: 'gratuito' });

  const papel = await db.query(`select papel from public.membros where user_id = $1`, [ids.a]);
  assert.equal(papel.rows[0].papel, 'dono');

  const etapas = await db.query(`select count(*)::int as n from public.kanban_etapas where organizacao_id = $1`, [ids.orgA]);
  assert.equal(etapas.rows[0].n, 7);

  const cons = await db.query(
    `select tipo, aceito from public.consentimentos where user_id = $1 order by tipo`, [ids.a]);
  assert.deepEqual(cons.rows, [
    { tipo: 'comunicacoes_marketing', aceito: false },
    { tipo: 'politica_privacidade', aceito: true },
    { tipo: 'termos_uso', aceito: true },
  ]);

  const nomeB = await db.query(`select o.nome from public.organizacoes o where o.id = $1`, [ids.orgB]);
  assert.equal(nomeB.rows[0].nome, 'Minha organização');
});

test('validação de CNPJ numérico e alfanumérico', async () => {
  const r = await db.query(`select
      public.cnpj_valido('11.222.333/0001-81') as numerico,
      public.cnpj_valido('12.ABC.345/01DE-35') as alfanumerico,
      public.cnpj_valido('11.222.333/0001-80') as dv_errado,
      public.cnpj_valido('00000000000000')     as repetido,
      public.cnpj_valido('123')                as curto`);
  assert.deepEqual(r.rows[0], {
    numerico: true, alfanumerico: true, dv_errado: false, repetido: false, curto: false,
  });
});

test('empresas: cada organização só enxerga as próprias (RLS)', async () => {
  const ins = await como(ids.a,
    `insert into public.empresas (organizacao_id, cnpj, razao_social, porte, uf)
     values ($1, '11.222.333/0001-81', 'Azul Suprimentos Ltda', 'EPP', 'SP') returning id, cnpj`,
    [ids.orgA]);
  ids.empresaA = ins.rows[0].id;
  assert.equal(ins.rows[0].cnpj, '11222333000181', 'CNPJ gravado sem pontuação');

  const vistoPorB = await como(ids.b, `select id from public.empresas`);
  assert.equal(vistoPorB.rows.length, 0);

  await assert.rejects(
    como(ids.b, `insert into public.empresas (organizacao_id, cnpj, razao_social)
                 values ($1, '12ABC34501DE35', 'Intrusa')`, [ids.orgA]),
    /row-level security/);

  await assert.rejects(
    como(ids.a, `insert into public.empresas (organizacao_id, cnpj, razao_social)
                 values ($1, '11222333000180', 'CNPJ inválido')`, [ids.orgA]),
    /check constraint/);
});

test('limite de empresas do plano e colunas protegidas', async () => {
  await como(ids.a, `insert into public.empresas (organizacao_id, cnpj, razao_social)
                     values ($1, '12ABC34501DE35', 'Empresa 2')`, [ids.orgA]);
  await como(ids.a, `insert into public.empresas (organizacao_id, cnpj, razao_social)
                     values ($1, '00000000000191', 'Empresa 3')`, [ids.orgA]);
  await assert.rejects(
    como(ids.a, `insert into public.empresas (organizacao_id, cnpj, razao_social)
                 values ($1, '06990590000123', 'Empresa 4')`, [ids.orgA]),
    /Limite de 3 empresa/);

  // o cliente não pode aumentar o próprio limite nem mudar de plano
  await assert.rejects(
    como(ids.a, `update public.organizacoes set limite_empresas = 999 where id = $1`, [ids.orgA]),
    /permission denied/);
  const ok = await como(ids.a, `update public.organizacoes set nome = 'Ana Licitações' where id = $1 returning nome`, [ids.orgA]);
  assert.equal(ok.rows[0].nome, 'Ana Licitações');
});

test('catálogo PNCP: leitura para todos, gravação só pelo sincronizador', async () => {
  await db.query(`insert into public.licitacoes
      (fonte, numero_controle_pncp, orgao_cnpj, orgao_razao_social, uf, municipio, ano_compra,
       sequencial_compra, modalidade_id, modalidade_nome, objeto, valor_estimado,
       data_publicacao, data_encerramento_proposta)
    values
      ('pncp', '46395000000139-1-000010/2026', '46395000000139', 'MUNICÍPIO DE SÃO PAULO', 'SP',
       'São Paulo', 2026, 10, 6, 'Pregão - Eletrônico',
       'MANUTENÇÃO PREVENTIVA E CORRETIVA DE APARELHOS DE AR-CONDICIONADO', 150000,
       now() - interval '2 days', now() + interval '10 days'),
      ('pncp', '01612092000123-1-000099/2026', '01612092000123', 'ESTADO DO RIO DE JANEIRO', 'RJ',
       'Rio de Janeiro', 2026, 99, 8, 'Dispensa',
       'Aquisição de notebooks para a secretaria de educação', 80000,
       now() - interval '1 day', now() + interval '5 days')`);

  const busca = await como(ids.b,
    `select objeto, link_pncp, total from public.buscar_licitacoes(p_termo => 'manutencao ar condicionado')`);
  assert.equal(busca.rows.length, 1, 'busca sem acento encontra texto com acento');
  assert.equal(busca.rows[0].link_pncp, 'https://pncp.gov.br/app/editais/46395000000139/2026/10');
  assert.equal(Number(busca.rows[0].total), 1);

  const filtro = await como(ids.b,
    `select uf from public.buscar_licitacoes(p_ufs => array['RJ'], p_modalidades => array[8])`);
  assert.deepEqual(filtro.rows, [{ uf: 'RJ' }]);

  // Busca regional: município sem acento e em minúsculas encontra o cadastrado.
  const municipio = await como(ids.b,
    `select municipio from public.buscar_licitacoes(p_municipios => array['sao paulo'])`);
  assert.deepEqual(municipio.rows.map((r) => r.municipio), ['São Paulo']);
  const nenhum = await como(ids.b,
    `select municipio from public.buscar_licitacoes(p_municipios => array['Ananindeua'])`);
  assert.equal(nenhum.rows.length, 0);

  // Radar: contagem por município, com termo sem acento e filtro de UF.
  const radar = await como(ids.b, `select uf, municipio, total from public.radar_contagem(p_termo => 'notebooks or manutencao')`);
  assert.deepEqual(radar.rows.map((r) => [r.uf, r.municipio, Number(r.total)]).sort(),
    [['RJ', 'Rio de Janeiro', 1], ['SP', 'São Paulo', 1]]);
  const radarSp = await como(ids.b, `select municipio from public.radar_contagem(p_ufs => array['SP'], p_municipios => array['sao paulo', 'Campinas'])`);
  assert.deepEqual(radarSp.rows, [{ municipio: 'São Paulo' }]);
  const futuro = await como(ids.b, `select count(*)::int as n from public.radar_contagem(p_abertura_de => (current_date + 400))`);
  assert.equal(futuro.rows[0].n, 0, 'filtro de data de abertura');

  await assert.rejects(
    como(ids.a, `insert into public.licitacoes (fonte, numero_controle_pncp, objeto)
                 values ('pncp', 'falsa-1', 'Tentativa de gravar no catálogo')`),
    /row-level security/);

  const manual = await como(ids.a,
    `insert into public.licitacoes (fonte, organizacao_id, objeto, uf)
     values ('manual', $1, 'Cotação privada da prefeitura vizinha', 'SP') returning id`, [ids.orgA]);
  ids.licManualA = manual.rows[0].id;

  const vistoPorB = await como(ids.b, `select id from public.licitacoes where id = $1`, [ids.licManualA]);
  assert.equal(vistoPorB.rows.length, 0, 'licitação manual é privada da organização');
});

test('CRM: cards consistentes com a organização', async () => {
  const lic = await db.query(`select id from public.licitacoes where numero_controle_pncp = '46395000000139-1-000010/2026'`);
  ids.licPncp = lic.rows[0].id;
  const etapaA = await db.query(
    `select id from public.kanban_etapas where organizacao_id = $1 and posicao = 1`, [ids.orgA]);
  const etapaB = await db.query(
    `select id from public.kanban_etapas where organizacao_id = $1 and posicao = 1`, [ids.orgB]);

  await como(ids.a,
    `insert into public.crm_cards (organizacao_id, empresa_id, licitacao_id, etapa_id, responsavel_id)
     values ($1, $2, $3, $4, $5)`,
    [ids.orgA, ids.empresaA, ids.licPncp, etapaA.rows[0].id, ids.a]);

  const quadro = await como(ids.a, `select empresa_razao_social, etapa_nome, objeto from public.vw_crm_cards`);
  assert.equal(quadro.rows.length, 1);
  assert.equal(quadro.rows[0].etapa_nome, 'Triagem');

  // etapa de outra organização: barrado pela chave estrangeira composta
  await assert.rejects(
    como(ids.a,
      `insert into public.crm_cards (organizacao_id, empresa_id, licitacao_id, etapa_id)
       values ($1, $2, $3, $4)`,
      [ids.orgA, ids.empresaA, ids.licManualA, etapaB.rows[0].id]),
    /foreign key/);

  // responsável que não é membro da organização
  await assert.rejects(
    como(ids.a,
      `insert into public.crm_cards (organizacao_id, empresa_id, licitacao_id, etapa_id, responsavel_id)
       values ($1, $2, $3, $4, $5)`,
      [ids.orgA, ids.empresaA, ids.licManualA, etapaA.rows[0].id, ids.b]),
    /responsável precisa ser membro/);

  const vistoPorB = await como(ids.b, `select id from public.vw_crm_cards`);
  assert.equal(vistoPorB.rows.length, 0);
});

test('análises de IA: usuário não grava diretamente (só o servidor)', async () => {
  await assert.rejects(
    como(ids.a, `insert into public.analises_edital (organizacao_id, origem) values ($1, 'texto')`, [ids.orgA]),
    /permission denied/);
  await db.query(`insert into public.analises_edital (organizacao_id, origem, status) values ($1, 'texto', 'concluida')`, [ids.orgA]);
  const a = await como(ids.a, `select count(*)::int as n from public.analises_edital`);
  const b = await como(ids.b, `select count(*)::int as n from public.analises_edital`);
  assert.equal(a.rows[0].n, 1);
  assert.equal(b.rows[0].n, 0);
});

test('Storage: PDF só entra na pasta da própria organização', async () => {
  await como(ids.a, `insert into storage.objects (bucket_id, name) values ('editais', $1)`, [`${ids.orgA}/edital.pdf`]);
  await assert.rejects(
    como(ids.a, `insert into storage.objects (bucket_id, name) values ('editais', $1)`, [`${ids.orgB}/edital.pdf`]),
    /row-level security/);
  await assert.rejects(
    como(ids.a, `insert into storage.objects (bucket_id, name) values ('editais', 'sem-pasta.pdf')`),
    /row-level security/);
});

test('observações: cada usuário vê e edita só as próprias', async () => {
  const salvar = (u, texto) => como(u, `insert into public.licitacao_observacoes (licitacao_id, texto) values ($1, $2)
    on conflict (user_id, licitacao_id) do update set texto = excluded.texto`, [ids.licPncp, texto]);
  await salvar(ids.a, 'Ligar para o pregoeiro');
  await salvar(ids.a, 'Ligar amanhã');
  await salvar(ids.b, 'Nota do Beto');
  const daAna = await como(ids.a, `select texto from public.licitacao_observacoes`);
  assert.deepEqual(daAna.rows.map((r) => r.texto), ['Ligar amanhã']);
  await como(ids.b, `delete from public.licitacao_observacoes`);
  const aindaDaAna = await como(ids.a, `select texto from public.licitacao_observacoes`);
  assert.equal(aindaDaAna.rows.length, 1, 'o Beto não apaga a observação da Ana');
  await assert.rejects(salvar(ids.b, '   '), /check constraint/);
  await assert.rejects(
    como(ids.b, `insert into public.licitacao_observacoes (licitacao_id, texto) values ($1, 'x')`, [ids.licManualA]),
    /row-level security/);
});

test('favoritos, consentimentos e exportação de dados (LGPD)', async () => {
  await como(ids.b, `insert into public.favoritos (licitacao_id) values ($1)`, [ids.licPncp]);
  await assert.rejects(
    como(ids.b, `insert into public.favoritos (licitacao_id) values ($1)`, [ids.licManualA]),
    /row-level security/);

  await como(ids.b, `insert into public.consentimentos (tipo, versao, aceito) values ('processamento_ia', '2026-11', true)`);
  await assert.rejects(
    como(ids.b, `update public.consentimentos set aceito = false`),
    /permission denied/);

  const exp = await como(ids.b, `select public.exportar_meus_dados() as dados`);
  const dados = exp.rows[0].dados;
  assert.equal(dados.perfil.nome, 'Beto');
  assert.equal(dados.favoritos.length, 1);
  assert.equal(dados.consentimentos.length, 1);
  assert.equal(dados.organizacoes[0].papel, 'dono');
});

test('organização precisa de um dono; RPC cria nova organização', async () => {
  const nova = await como(ids.b, `select public.criar_organizacao('Beto Consultoria', '06.990.590/0001-23') as id`);
  ids.orgB2 = nova.rows[0].id;
  const etapas = await db.query(`select count(*)::int as n from public.kanban_etapas where organizacao_id = $1`, [ids.orgB2]);
  assert.equal(etapas.rows[0].n, 7);

  await assert.rejects(
    como(ids.b, `update public.membros set papel = 'membro' where organizacao_id = $1 and user_id = $2`, [ids.orgB2, ids.b]),
    /pelo menos um dono/);
  await assert.rejects(
    como(ids.b, `insert into public.membros (organizacao_id, user_id, papel) values ($1, $2, 'dono')`, [ids.orgA, ids.b]),
    /permission denied/);
});

test('limpeza do catálogo preserva o que está em uso', async () => {
  await db.query(`insert into public.licitacoes (fonte, numero_controle_pncp, objeto, data_encerramento_proposta)
                  values ('pncp', 'antiga-1', 'Licitação encerrada há muito tempo', now() - interval '200 days')`);
  await db.query(`update public.licitacoes set data_encerramento_proposta = now() - interval '200 days' where id = $1`, [ids.licPncp]);
  await db.exec(`set role service_role`);
  const r = await db.query(`select public.limpar_licitacoes_antigas(90) as apagadas`);
  await db.exec(`reset role`);
  assert.equal(r.rows[0].apagadas, 1, 'só a antiga sem uso foi apagada');
  const aindaExiste = await db.query(`select 1 from public.licitacoes where id = $1`, [ids.licPncp]);
  assert.equal(aindaExiste.rows.length, 1, 'a que está no CRM e nos favoritos continua');

  await assert.rejects(
    como(ids.a, `select public.limpar_licitacoes_antigas(1)`),
    /permission denied/);
});

test('excluir conta apaga a organização em que a pessoa estava sozinha (LGPD)', async () => {
  await db.query(`delete from auth.users where id = $1`, [ids.a]);
  const org = await db.query(`select 1 from public.organizacoes where id = $1`, [ids.orgA]);
  assert.equal(org.rows.length, 0);
  const empresas = await db.query(`select 1 from public.empresas where organizacao_id = $1`, [ids.orgA]);
  assert.equal(empresas.rows.length, 0);
  const manual = await db.query(`select 1 from public.licitacoes where id = $1`, [ids.licManualA]);
  assert.equal(manual.rows.length, 0, 'licitação manual da organização também sai');
  const outra = await db.query(`select 1 from public.organizacoes where id = $1`, [ids.orgB]);
  assert.equal(outra.rows.length, 1, 'outras contas não são afetadas');
});

test('não mexe nas tabelas de outro sistema no mesmo projeto', async () => {
  const r = await db.query(`select
      has_table_privilege('anon', 'public.outro_sistema', 'select') as outro_sistema,
      has_table_privilege('anon', 'public.licitacoes', 'select') as licitacoes`);
  assert.deepEqual(r.rows[0], { outro_sistema: true, licitacoes: false });
});

test('funciona mesmo sem as permissões automáticas do Supabase', async () => {
  const db2 = await PGlite.create({ extensions: { unaccent } });
  try {
    await db2.exec(await readFile(new URL('testes/supabase-simulado.sql', raiz), 'utf8'));
    await db2.exec(`
      alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
      alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
      alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
      alter default privileges revoke execute on functions from public;`);
    await db2.exec(await readFile(new URL('supabase/schema.sql', raiz), 'utf8'));
    const r = await db2.query(`select
        has_table_privilege('service_role', 'public.licitacoes', 'insert')
          and has_table_privilege('service_role', 'public.licitacoes', 'update') as sincronizador_grava,
        has_table_privilege('authenticated', 'public.licitacoes', 'select') as usuario_le,
        has_table_privilege('anon', 'public.licitacoes', 'select') as visitante_le,
        has_function_privilege('authenticated', 'public.eh_membro(uuid)', 'execute') as regras_rls,
        has_function_privilege('authenticated',
          'public.buscar_licitacoes(text, text[], int[], numeric, numeric, timestamptz, boolean, text, int, int, text[])',
          'execute') as busca,
        has_table_privilege('authenticated', 'public.vw_crm_cards', 'select') as visao_crm,
        has_table_privilege('authenticated', 'public.assinaturas', 'select') as assinatura_le,
        has_table_privilege('authenticated', 'public.assinaturas', 'update') as assinatura_grava,
        has_table_privilege('service_role', 'public.assinaturas', 'update') as servidor_grava_assinatura`);
    assert.deepEqual(r.rows[0], {
      sincronizador_grava: true, usuario_le: true, visitante_le: false,
      regras_rls: true, busca: true, visao_crm: true,
      assinatura_le: true, assinatura_grava: false, servidor_grava_assinatura: true,
    });
  } finally {
    await db2.close();
  }
});

test('assinaturas: cada organização vê só a sua, e só o servidor muda o plano', async () => {
  const c = await criarUsuario('carla@exemplo.com', { nome: 'Carla', empresa: 'Empresa Carla' });
  const orgC = await orgDe(c);
  await db.query(`insert into public.assinaturas (organizacao_id, stripe_cliente_id, plano, ciclo, status)
                  values ($1, 'cus_teste_b', 'starter', 'mensal', 'active')`, [ids.orgB]);

  const propria = await como(ids.b, `select plano, status from public.assinaturas`);
  assert.deepEqual(propria.rows, [{ plano: 'starter', status: 'active' }]);
  const alheia = await como(c, `select count(*)::int as n from public.assinaturas`);
  assert.equal(alheia.rows[0].n, 0);

  await assert.rejects(como(ids.b, `update public.assinaturas set plano = 'pro'`), /permission denied/);
  await assert.rejects(
    como(c, `insert into public.assinaturas (organizacao_id, plano, status) values ($1, 'pro', 'active')`, [orgC]),
    /permission denied/,
  );
  await assert.rejects(
    como(ids.b, `update public.organizacoes set plano = 'pro', limite_empresas = 999 where id = $1`, [ids.orgB]),
    /permission denied/,
    'ninguém se dá um plano pago pelo navegador',
  );
});

test('documentos, propostas, radares, eventos e monitoramento: cada organização só vê os seus', async () => {
  const d = await criarUsuario('davi@exemplo.com', { nome: 'Davi', empresa: 'Empresa Davi' });
  const e = await criarUsuario('eva@exemplo.com', { nome: 'Eva', empresa: 'Empresa Eva' });
  const orgD = await orgDe(d);
  const orgE = await orgDe(e);
  const emp = await como(d, `insert into public.empresas (organizacao_id, cnpj, razao_social)
                             values ($1, '11.222.333/0001-81', 'Davi Ltda') returning id`, [orgD]);
  const empresaD = emp.rows[0].id;

  await como(d, `insert into public.documentos (organizacao_id, empresa_id, nome, tipo, validade)
                 values ($1, $2, 'CND FGTS', 'Fiscal', current_date + 10)`, [orgD, empresaD]);
  await como(d, `insert into public.propostas (organizacao_id, empresa_id, numero, itens, total)
                 values ($1, $2, 'PROP-2026-001', '[{"descricao":"Papel","quantidade":10,"unitario":25}]', 250)`, [orgD, empresaD]);
  await como(d, `insert into public.radares (organizacao_id, nome, palavras) values ($1, 'Limpeza', '{limpeza}')`, [orgD]);
  await como(d, `insert into public.eventos (organizacao_id, data, hora, titulo, tipo)
                 values ($1, current_date, '09:00', 'Sessão pública', 'sessao')`, [orgD]);
  await como(d, `insert into public.monitoramentos (organizacao_id, cnpj, palavras) values ($1, '11222333000181', '{convoca}')`, [orgD]);

  for (const tabela of ['documentos', 'propostas', 'radares', 'eventos', 'monitoramentos']) {
    const propria = await como(d, `select count(*)::int as n from public.${tabela}`);
    assert.equal(propria.rows[0].n, 1, `${tabela}: a dona vê o seu`);
    const alheia = await como(e, `select count(*)::int as n from public.${tabela}`);
    assert.equal(alheia.rows[0].n, 0, `${tabela}: outra organização não vê`);
    await assert.rejects(
      como(e, `insert into public.${tabela} (organizacao_id) select $1`, [orgD]),
      /row-level security|null value|violates/, `${tabela}: não grava na organização dos outros`);
  }

  // Documento só pode apontar para empresa da mesma organização
  await assert.rejects(
    como(e, `insert into public.documentos (organizacao_id, empresa_id, nome) values ($1, $2, 'X')`, [orgE, empresaD]),
    /foreign key|row-level security/);
  // Monitoramento não aceita CNPJ inválido
  await assert.rejects(
    como(e, `insert into public.monitoramentos (organizacao_id, cnpj) values ($1, '11222333000180')`, [orgE]),
    /check constraint/);
  // Apagar a empresa apaga os documentos dela e só solta as propostas
  await como(d, `delete from public.empresas where id = $1`, [empresaD]);
  const restou = await db.query(`select (select count(*)::int from public.documentos where organizacao_id = $1) as docs,
                                        (select count(*)::int from public.propostas where organizacao_id = $1 and empresa_id is null) as propostas`, [orgD]);
  assert.deepEqual(restou.rows[0], { docs: 0, propostas: 1 });

  // Pasta de documentos: só a da própria organização
  await como(d, `insert into storage.objects (bucket_id, name) values ('documentos', $1)`, [`${orgD}/x/certidao.pdf`]);
  await assert.rejects(
    como(e, `insert into storage.objects (bucket_id, name) values ('documentos', $1)`, [`${orgD}/x/intrusa.pdf`]),
    /row-level security/);
});

test('limpeza do projeto do agendamentos: só roda lá e tira tudo do LicitaHub', async () => {
  const limpeza = await readFile(new URL('supabase/limpar-projeto-agendamentos.sql', raiz), 'utf8');
  const simulado = await readFile(new URL('testes/supabase-simulado.sql', raiz), 'utf8');
  const schema = await readFile(new URL('supabase/schema.sql', raiz), 'utf8');

  // No projeto do LicitaHub (sem a tabela agendamentos): para sem apagar nada.
  await assert.rejects(db.exec(limpeza), /PARADO: este não é o projeto/);
  const ainda = await db.query(`select count(*)::int as n from public.organizacoes`);
  assert.ok(ainda.rows[0].n > 0, 'nada foi apagado no projeto do LicitaHub');

  // No projeto do agendamentos: tira o LicitaHub e mantém o resto.
  const outro = await PGlite.create({ extensions: { unaccent } });
  try {
    await outro.exec(simulado);
    await outro.exec(`create table public.agendamentos (id int primary key, quando timestamptz);
                      insert into public.agendamentos values (1, now());`);
    await outro.exec(schema);
    const [, conferencia] = await outro.exec(limpeza);
    assert.deepEqual(conferencia.rows, [{ tabelas_do_licitahub: 0, gatilhos_do_licitahub: 0 }]);
    const agenda = await outro.query(`select count(*)::int as n from public.agendamentos`);
    assert.equal(agenda.rows[0].n, 1, 'o sistema de agendamentos continua intacto');
    const sobras = await outro.query(`select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                                      where s.nspname = 'public' and p.proname in ('eh_membro', 'buscar_licitacoes', 'ao_criar_usuario')`);
    assert.equal(sobras.rows[0].n, 0);
    const pasta = await outro.query(`select count(*)::int as n from storage.buckets where id = 'editais'`);
    assert.equal(pasta.rows[0].n, 0);

    // Com dados do LicitaHub: para sem apagar.
    await outro.exec(schema);
    await outro.exec(`insert into public.organizacoes (nome) values ('Org real')`);
    await assert.rejects(outro.exec(limpeza), /PARADO: as tabelas do LicitaHub/);
  } finally {
    await outro.close();
  }
});
