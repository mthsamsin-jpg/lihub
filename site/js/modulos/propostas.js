/* =============================================================================
   Uso LicitaHub · Propostas e declarações
   Gerador de proposta (Criar proposta / Minhas propostas; no modo real, tabela
   propostas) e Gerador de declarações (modelos da Lei nº 14.133/2021).
   ============================================================================= */
window.LH = window.LH || {};
LH.vistas = LH.vistas || {};

(function () {
  const { esc, icone, fmt } = LH;
  const regras = LH.propostasRegras;
  const { declaracoesPadrao, declaracoesDe, totalLinha, totalProposta } = regras;
  // Preço unitário pode ter mais de 2 casas (até 6): mostra o que foi digitado.
  const fmtUnitario = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const fmtQtd = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 });
  const quebravel = (v) => v.replace(/\u00a0/g, ' '); // permite quebrar só depois do "R$"
  const NUMERO_PENDENTE = 'Número gerado ao salvar ou baixar';
  const STATUS = ['Rascunho', 'Enviada', 'Em análise', 'Aceita', 'Recusada'];
  const AVISO_RESPONSABILIDADE = `<p class="nota nota--alerta nao-imprimir">${icone('alerta')} Revise a proposta e o edital antes de enviar. O Uso LicitaHub ajuda a montar o documento, mas a responsabilidade final pela proposta é sua.</p>`;

  const empresa = () => LH.repo.empresaPerfil();
  const numeroCurto = (n) => String(n ?? '').split(' ').pop();
  /** Licitação da proposta: o resumo salvo junto, ou a que está em memória. */
  const licitacaoDe = (p) => p.licitacao || LH.licitacaoEmCache(p.licitacaoId) || null;

  // --- Criar proposta ------------------------------------------------------------
  // Cabeçalho da licitação (preenchido sozinho e editável), empresa proponente,
  // itens com Item / Qtd / Unid. / Descrição / Marca / Valor unitário, totais em
  // tempo real e exportação em PDF (impressão) ou Word (.doc).
  const UNIDADES = ['UN', 'SV', 'CX', 'PCT', 'KG', 'G', 'L', 'ML', 'M', 'M²', 'M³', 'RL', 'FD', 'GL', 'PÇ', 'PAR', 'JG', 'KIT', 'RESMA', 'DZ', 'HORA', 'DIÁRIA', 'MÊS', 'ANO'];
  const CAMPOS_LIC = ['orgao', 'uf', 'municipio', 'modalidade', 'numero', 'processo', 'objeto', 'publicacao', 'abertura', 'hora', 'limite', 'horaLimite', 'idPncp'];

  /** Licitação da tela -> cabeçalho da proposta. */
  const cabecalhoDe = (l) => (l ? {
    orgao: l.orgao || '', uf: l.uf && l.uf !== '—' ? l.uf : '', municipio: l.municipio || '', modalidade: l.modalidade || '',
    numero: l.edital || numeroCurto(l.numero) || '', processo: l.processo || '', objeto: l.objeto || '',
    publicacao: l.publicada || '', abertura: l.brasilia?.data || l.abertura || '', hora: l.brasilia?.hora || l.hora || '',
    // O PNCP informa o fim do recebimento das propostas, que costuma ser a abertura da sessão.
    limite: l.brasilia?.data || l.abertura || '', horaLimite: l.brasilia?.hora || l.hora || '', idPncp: l.numeroControle || l.numero || '',
  } : null);

  /** Empresa da proposta: a cópia salva nela ou a escolhida no cadastro (nunca outra). */
  const empresaDe = (p) => regras.empresaDe(p, LH.repo.empresas?.() || []);

  function linhaItem(item = {}, i = 0) {
    const unit = item.unitario ? numeroTexto(item.unitario) : '';
    return `
      <tr>
        <td class="col-item"><input name="item" inputmode="numeric" value="${esc(item.numero ?? i + 1)}" aria-label="Número do item"></td>
        <td class="col-qtd"><input name="quantidade" inputmode="decimal" value="${esc(numeroTexto(item.quantidade ?? 1))}" aria-label="Quantidade"></td>
        <td class="col-un"><input name="unidade" list="unidades-proposta" value="${esc(item.unidade || 'UN')}" aria-label="Unidade"></td>
        <td class="col-desc"><textarea name="descricao" rows="2" placeholder="Descrição / especificação conforme o edital" required aria-label="Descrição">${esc(item.descricao || '')}</textarea>
          <button type="button" class="link-botao item-preco" data-preco title="Preços homologados de itens parecidos no PNCP">${icone('moeda')} Preço de referência</button></td>
        <td class="col-marca"><input name="marca" value="${esc(item.marca || '')}" placeholder="Marca/modelo" aria-label="Marca"></td>
        <td class="col-valor"><input name="unitario" inputmode="decimal" value="${esc(unit)}" placeholder="0,00" aria-label="Valor unitário"></td>
        <td class="numero col-total" data-total>—</td>
        <td><button class="btn-icone btn-icone--pequeno" type="button" data-remover aria-label="Remover item">${icone('lixeira')}</button></td>
      </tr>`;
  }

  const textoDeclaracao = (texto, p) => String(texto || '')
    .replaceAll('{validade}', String(p.validade || 60))
    .replaceAll('{pagamento}', p.pagamento ? ` (${p.pagamento})` : '');

  /** Dados bancários da proposta: os do cadastro ou os informados só nesta proposta. */
  const { bancoDe, CAMPOS_BANCO, itemDoEdital, numeroTexto } = regras;
  /** Fechamento: cidade, data e responsável (a proposta pode ajustar o que vem do cadastro). */
  const fechamentoDe = (p, e) => {
    const f = p.extras?.fechamento || {};
    const ou = (a, b) => (String(a ?? '').trim() ? String(a).trim() : (b || ''));
    const padrao = regras.fechamentoPadrao(e);
    return { ...Object.fromEntries(Object.keys(padrao).map((k) => [k, ou(f[k], padrao[k])])), data: ou(f.data, LH.datas.hoje()) };
  };
  const dataHora = (d, h) => {
    const hora = h ? `às ${h} (horário de Brasília)` : '';
    return d ? `${fmt.data(d)}${hora ? ` ${hora}` : ''}` : hora;
  };

  /** O que falta ou está incoerente na proposta. */
  function pendenciasDe(p) {
    const e = empresaDe(p);
    return regras.pendencias(p, { empresa: e, banco: bancoDe(p, e), fim: fechamentoDe(p, e) });
  }
  /** Texto com as quebras de linha digitadas. */
  const linhas = (t) => esc(t).replace(/\r?\n/g, '<br>');
  // Lacuna no documento: linha para preencher à mão (nunca "[Cidade]" nem "não informado").
  const LACUNA = '____________________';

  /** Avisa o que falta. Resolve true para seguir ("mesmo assim") e false para corrigir. */
  function conferirPendencias(p, rotuloSeguir) {
    const faltam = pendenciasDe(p);
    if (!faltam.length) return Promise.resolve(true);
    return new Promise((resolver) => {
      LH.modal({
        titulo: 'Confira a proposta',
        html: `<p>Confira estes pontos. O que estiver vazio sai em branco, para preencher à mão:</p>
          <ul class="pendencias-proposta">${faltam.map((f) => `<li>${esc(f.campo)} <span class="fraco">(${{ empresa: 'cadastro da empresa', itens: 'itens', proposta: 'nesta proposta' }[f.onde]})</span></li>`).join('')}</ul>
          ${faltam.some((f) => f.onde === 'empresa') ? `<p>${icone('info')} Complete o cadastro em <a href="#/empresa" data-ir-empresa>Minha empresa</a>.</p>` : ''}`,
        acoes: [
          { rotulo: 'Corrigir', classe: 'btn--fantasma', acao: (f) => { f(); resolver(false); } },
          { rotulo: rotuloSeguir, classe: 'btn--primario', acao: (f) => { f(); resolver(true); } },
        ],
      });
      document.querySelector('[data-ir-empresa]')?.addEventListener('click', () => {
        document.querySelectorAll('.modal-fundo').forEach((m) => m.remove());
        resolver(false);
      });
    });
  }

  function folhaProposta(p, { documento = false } = {}) {
    const e = empresaDe(p);
    const l = p.licitacao || {};
    const total = totalProposta(p.itens);
    const local = [l.municipio, l.uf].filter(Boolean).join('/');
    const ref = [l.modalidade, l.numero && `nº ${l.numero}`].filter(Boolean).join(' ');
    const temMarca = p.itens.some((it) => it.marca);
    const banco = bancoDe(p, e);
    const fim = fechamentoDe(p, e);
    const decl = declaracoesDe(p).filter((d) => d.ativo && String(d.texto || '').trim());
    const cnpj = e.cnpj ? LH.cnpj.mascara(e.cnpj) : '';
    const sessao = dataHora(l.abertura, l.hora);
    const limite = dataHora(l.limite, l.horaLimite);
    const linhaInfo = (rotulo, valor) => (valor ? `<tr><th scope="row" width="28%">${rotulo}</th><td>${linhas(valor)}</td></tr>` : '');
    const faltam = documento ? [] : pendenciasDe(p);
    // Logo: tamanho em pt (o Word ignora max-width/max-height); o mesmo na tela e no PDF.
    const logo = e.logo ? `<img class="folha__logo" decoding="sync" src="${esc(e.logo)}" alt="Logo ${esc(e.razao || '')}"${p.logoPt ? ` width="${Math.round(p.logoPt.w * 4 / 3)}" height="${Math.round(p.logoPt.h * 4 / 3)}" style="width:${p.logoPt.w}pt;height:${p.logoPt.h}pt"` : ''}>` : '';
    return `
      ${faltam.length ? `<p class="nota nota--alerta nao-imprimir aviso-lacunas">${icone('alerta')} Confira: ${esc(faltam.map((f) => f.campo).join('; '))}. O que estiver vazio sai em branco.${faltam.some((f) => f.onde === 'empresa') ? ' <a href="#/empresa">Completar o cadastro</a>.' : ''}</p>` : ''}
      <div class="folha folha--proposta">
        <table class="folha__topo" role="presentation"><tr>
          ${logo ? `<td class="folha__topo-logo"${p.logoPt ? ` width="${Math.round((p.logoPt.w + 14) * 4 / 3)}"` : ''}>${logo}</td>` : ''}
          <td class="folha__empresa">
            <div><strong>${esc(e.razao || LACUNA)}</strong></div>
            ${[cnpj && `CNPJ ${cnpj}`,
              [e.endereco, e.cidade && `${e.cidade}/${e.uf}`, e.cep && `CEP ${e.cep}`].filter(Boolean).join(' · '),
              [e.email, e.telefone].filter(Boolean).join(' · ')].filter(Boolean).map((t) => `<div>${esc(t)}</div>`).join('')}
          </td>
        </tr></table>
        <h2>PROPOSTA COMERCIAL</h2>
        <p class="folha__centro" align="center">${esc(p.numero || NUMERO_PENDENTE)}</p>
        <h3>Ao(À) ${esc(l.orgao || LACUNA)}${local ? ` · ${esc(local)}` : ''}</h3>
        <table class="folha__info">
          ${linhaInfo('Referência', l.numero ? ref : [l.modalidade, `nº ${LACUNA}`].filter(Boolean).join(' '))}
          ${linhaInfo('Processo', l.processo)}
          ${linhaInfo('Sessão pública (abertura)', sessao)}
          ${linhaInfo('Envio das propostas até', limite)}
          ${linhaInfo('Objeto', l.objeto || LACUNA)}
        </table>
        <h3>Proponente</h3>
        <table class="folha__info">
          ${linhaInfo('Razão social', e.razao || LACUNA)}
          ${linhaInfo('CNPJ', cnpj || LACUNA)}
          ${linhaInfo('Inscrições', [e.ie && `IE ${e.ie}`, e.im && `IM ${e.im}`].filter(Boolean).join(' · '))}
          ${linhaInfo('Endereço', [e.endereco, e.cidade && `${e.cidade}/${e.uf}`, e.cep && `CEP ${e.cep}`].filter(Boolean).join(' · ') || LACUNA)}
          ${linhaInfo('Contato', [e.email, e.telefone].filter(Boolean).join(' · '))}
        </table>
        <h3>Itens</h3>
        <table class="folha__itens${temMarca ? '' : ' folha__itens--sem-marca'}">
          <colgroup><col class="c-item"><col class="c-desc">${temMarca ? '<col class="c-marca">' : ''}<col class="c-un"><col class="c-qtd"><col class="c-valor"><col class="c-valor"></colgroup>
          <thead><tr><th width="7%">Item</th><th>Descrição / especificação</th>${temMarca ? '<th width="13%">Marca</th>' : ''}<th width="8%">Un.</th><th class="numero" width="9%">Qtd.</th><th class="numero" width="16%">Valor unitário</th><th class="numero" width="17%">Valor global</th></tr></thead>
          <tbody>${p.itens.map((it, i) => `<tr${String(it.descricao).length > 700 ? ' class="longa" style="page-break-inside:auto"' : ''}><td>${esc(it.numero ?? i + 1)}</td><td class="quebra">${linhas(it.descricao || LACUNA)}</td>${temMarca ? `<td class="quebra">${esc(it.marca || '')}</td>` : ''}<td>${esc(it.unidade)}</td>
            <td class="numero">${fmtQtd.format(it.quantidade)}</td><td class="numero">${quebravel(fmtUnitario.format(it.unitario))}</td><td class="numero">${quebravel(fmt.moeda(totalLinha(it)))}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="${temMarca ? 6 : 5}" class="numero">Valor global da proposta</th><th class="numero">${fmt.moeda(total)}</th></tr></tfoot>
        </table>
        <p class="folha__extenso"><strong>Valor global:</strong> ${fmt.moeda(total)} (${esc(LH.porExtenso(total))}).</p>
        <h3>Condições</h3>
        <p>Validade da proposta: ${esc(p.validade)} dias a contar da data de abertura da sessão pública.</p>
        <p>Prazo de entrega/execução: ${esc(p.prazo || 'conforme o edital')}.</p>
        <p>Condições de pagamento: ${esc(p.pagamento || 'conforme o edital')}.</p>
        ${p.observacoes ? `<p>${linhas(p.observacoes)}</p>` : ''}
        ${decl.length ? `<h3>Declarações</h3>
        <ol class="folha__declaracoes">${decl.map((d) => `<li><strong>${esc(d.titulo)}.</strong> ${linhas(textoDeclaracao(d.texto, p))}</li>`).join('')}</ol>` : ''}
        <div class="folha__fecho">
        <h3>Dados bancários</h3>
        <table class="folha__info">${linhaInfo('Banco', banco.banco || LACUNA)}${linhaInfo('Agência', banco.agencia || LACUNA)}${linhaInfo(esc(banco.tipoConta), banco.conta || LACUNA)}${linhaInfo('Pix', regras.pixTexto(banco))}${linhaInfo('Titular', [e.razao, cnpj && `CNPJ ${cnpj}`].filter(Boolean).join(' · ') || LACUNA)}</table>
        <p class="folha__local">${esc(fim.cidade || LACUNA)}, ${esc(fmt.dataLonga(fim.data))}.</p>
        <div class="folha__assinatura">${documento ? `<div>${LACUNA}${LACUNA}</div>` : "<span></span>"}
          <div><strong>${esc(fim.representante || LACUNA)}</strong></div>
          <div>${esc([fim.cargo, fim.rg && `RG ${fim.rg}`, `CPF ${fim.cpf || LACUNA}`].filter(Boolean).join(' · '))}</div>
          <div>${esc(e.razao || '')}${cnpj ? ` · CNPJ ${esc(cnpj)}` : ''}</div>
        </div>
        <div class="folha__rodape">
          ${[[e.razao, cnpj && `CNPJ ${cnpj}`], [e.endereco, e.cidade && `${e.cidade}/${e.uf}`, e.telefone, e.email]]
            .map((l) => l.filter(Boolean).join(' · ')).filter(Boolean).map((t) => `<div>${esc(t)}</div>`).join('')}
          <div class="folha__rodape-sistema">Proposta ${esc(p.numero || '(sem número)')} · gerada no Uso LicitaHub em ${esc(fmt.data(p.criada || LH.datas.hoje()))}. Confira com o edital antes de enviar.</div>
        </div>
        </div>
      </div>`;
  }

  /** Rodapé de cada página (PDF e Word). */
  const rodapePagina = (p) => [empresaDe(p).razao, p.numero && `Proposta ${p.numero}`].filter(Boolean).join(' · ');
  /** PDF: rodapé e número em todas as páginas (só existe enquanto a prévia está na tela). */
  const estiloPagina = (p) => {
    const texto = rodapePagina(p).replace(/[\\"<>]/g, ' ').replace(/\s+/g, ' ');
    const letra = 'font: 8pt Arial, sans-serif; color: #5a6b80;';
    return `<style>@page { margin: 14mm 12mm 18mm; @bottom-left { content: "${texto}"; ${letra} } @bottom-right { content: "Página " counter(page) " de " counter(pages); ${letra} white-space: nowrap; } }</style>`;
  };

  /** Tamanho do logo em pt (até 180 × 60 pt, sem ampliar). Null sem logo. */
  async function medirLogo(src) {
    if (!src) return null;
    const img = new Image();
    img.src = src;
    try { await img.decode(); } catch { return null; }
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const escala = Math.min(0.75, 180 / img.naturalWidth, 60 / img.naturalHeight);
    return { w: Math.round(img.naturalWidth * escala), h: Math.round(img.naturalHeight * escala) };
  }

  /** Proposta em Word (.doc): HTML que o Word abre e edita. */
  async function baixarWord(p) {
    const logoPt = await medirLogo(empresaDe(p).logo);
    // Word: só entende uma classe por elemento; seção e rodapé usam as marcas mso-*.
    const estilos = `@page S1{size:595.3pt 841.9pt;margin:42pt 42pt 54pt 42pt;mso-footer-margin:24pt;mso-footer:f1;mso-paper-source:0}div.S1{page:S1}
      body{font-family:Arial,sans-serif;font-size:10.5pt;color:#000}p,div{margin:0 0 4pt}h2,h3{font-family:Arial,sans-serif;font-style:normal;color:#000;page-break-after:avoid}h2{text-align:center;font-size:15pt;margin:0}h3{font-size:12pt;margin:12pt 0 4pt}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:3pt 4pt;font-size:9.5pt;vertical-align:top}th{background:#e8e8e8}tr{page-break-inside:avoid}
      .numero{text-align:right}.folha__assinatura{margin-top:36pt;text-align:center;page-break-inside:avoid}.folha__assinatura div{margin:0}
      table.folha__topo{margin-bottom:10pt}table.folha__topo td{border:none;border-bottom:1.5pt solid #1b2533;vertical-align:middle;padding:0 8pt 6pt 0}.folha__empresa div{font-size:9pt;margin:0}
      .folha__info th{text-align:left}p.vao{font-size:4pt;margin:0}table.folha__itens{table-layout:fixed}.folha__itens th,.folha__itens td{font-size:8pt}.folha__declaracoes li{margin-bottom:4pt;text-align:justify}.folha__local{margin-top:18pt}
      .folha__rodape{margin-top:20pt;border-top:1px solid #444;padding-top:4pt;text-align:center;font-size:8pt;color:#444}.folha__rodape div{margin:0}
      p.MsoFooter{text-align:center;font-size:8pt;color:#444;margin:0}table.so-rodape{margin:0 0 0 900pt;width:1pt;height:1pt;overflow:hidden}`;
    const campo = (nome) => `<!--[if supportFields]><span style='mso-element:field-begin'></span> ${nome} <span style='mso-element:field-end'></span><![endif]-->`;
    const rodape = `<table class="so-rodape" border="0" cellspacing="0" cellpadding="0"><tr><td style="border:none"><div style="mso-element:footer" id="f1"><p class="MsoFooter">${esc(rodapePagina(p))} · Página&nbsp;${campo('PAGE')}&nbsp;de&nbsp;${campo('NUMPAGES')}</p></div></td></tr></table>`;
    // O Word só mantém o fechamento na mesma página com "manter com o próximo" em cada parágrafo.
    const junto = 'page-break-after:avoid';
    const manterJunto = (t) => t
      .replace(/<(t[hd])([^>]*)>([\s\S]*?)<\/\1>/g, (_, x, attr, miolo) => `<${x}${attr}><p style="margin:0;${junto}">${miolo}</p></${x}>`)
      .replace(/<(p|div|h3)((?: class="(?!folha__rodape-sistema)[^"]*")?)>/g, `<$1$2 style="${junto}">`);
    // Itens com largura fixa em pt: palavra sem espaço quebra dentro da coluna em vez de alargá-la.
    const larguras = p.itens.some((it) => it.marca) ? [30, 164, 66, 34, 45, 80, 100] : [30, 230, 34, 45, 80, 100];
    const fixarItens = (t) => t.replace(/<colgroup>[\s\S]*?<\/colgroup>/, '')
      .replace(/(<table class="[^"]*")>/, `$1 width="692" style="width:519pt;table-layout:fixed;mso-table-layout-alt:fixed">`)
      .replace(/<tr[^>]*>[\s\S]*?<\/tr>/g, (tr) => {
        if (tr.includes('colspan')) return tr;
        let n = 0;
        return tr.replace(/<(t[hd])\b([^>]*)>/g, (_, x, attr) => {
          const l = larguras[n++];
          return `<${x}${attr.replace(/ width="[^"]*"/, '')} width="${Math.round(l * 4 / 3)}" style="width:${l}pt">`;
        });
      });
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(p.numero)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>${estilos}</style></head><body><div class="S1">${folhaProposta({ ...p, logoPt }, { documento: true }).replace(/<table class="folha__itens[\s\S]*?<\/table>/, fixarItens).replaceAll('</table>', '</table><p class="vao">&nbsp;</p>').replace('<div class="folha__rodape">', '<p class="vao">&nbsp;</p><p class="vao">&nbsp;</p>$&').replace(/<div class="folha__fecho">[\s\S]*/, manterJunto)}${rodape}</div></body></html>`;
    const url = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `Proposta-${String(p.numero).replace(/[^\w-]+/g, '_')}.doc` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** Janela para escolher quais itens do edital entram na proposta. */
  function escolherItensDoEdital(itens, aoConfirmar) {
    const grupos = LH.termosBusca || [];
    LH.modal({
      titulo: 'Importar itens do edital',
      html: `<p class="fraco">${fmt.numero(itens.length)} item(ns) publicados no PNCP. Marque os que você vai cotar.</p>
        <label class="itens-termo__so" style="margin:6px 0"><input type="checkbox" data-todos checked> Marcar todos</label>
        <ul class="importar-itens">${itens.map((it, k) => `<li><label>
          <input type="checkbox" data-k="${k}" ${regras.itemEncerrado(it) ? '' : 'checked'}>
          <span><b>Item ${esc(it.numero ?? k + 1)}</b> · ${LH.termos.destacar(it.descricao, grupos)}<br>
          <small class="fraco">${it.quantidade == null ? '—' : fmt.numero(it.quantidade)} ${esc(it.unidade || '')}${it.valorUnitario ? ` · estimado ${fmt.moeda(it.valorUnitario)}/un.` : ''}${regras.itemEncerrado(it) ? ` · <b>${esc(it.situacao)}</b>` : ''}</small></span></label></li>`).join('')}</ul>`,
      acoes: [
        { rotulo: 'Cancelar', classe: 'btn--fantasma' },
        {
          rotulo: 'Adicionar à proposta', classe: 'btn--primario',
          acao: (fechar, fundo) => {
            const marcados = [...fundo.querySelectorAll('[data-k]:checked')].map((c) => itens[Number(c.dataset.k)]);
            if (!marcados.length) return LH.aviso('Marque pelo menos um item.', 'alerta');
            fechar();
            aoConfirmar(marcados);
          },
        },
      ],
    });
    const fundo = [...document.querySelectorAll('.modal-fundo')].at(-1);
    fundo.querySelector('[data-todos]').addEventListener('change', (e) => {
      fundo.querySelectorAll('[data-k]').forEach((c) => { c.checked = e.target.checked; });
    });
  }

  LH.vistas['proposta/criar'] = {
    titulo: 'Gerador de proposta',
    trilha: 'Gerador de proposta',
    render: (p) => `
      ${LH.cabecalho({
        titulo: p.id ? 'Proposta' : 'Gerador de proposta',
        texto: 'Escolha a licitação (ou preencha à mão), a empresa e os itens. Totais e valor por extenso são calculados sozinhos; exporte em PDF ou Word.',
        acoes: `<a class="btn" href="#/proposta/minhas">${icone('arquivo')} Minhas propostas</a>`,
      })}
      <form class="grade" id="form-proposta" autocomplete="off">
        <datalist id="unidades-proposta">${UNIDADES.map((u) => `<option value="${u}"></option>`).join('')}</datalist>
        <section class="card spot form">
          <div class="card__titulo"><h2>${icone('predio')} <span class="passo-num">1</span> Empresa e condições</h2><span class="selo" id="numero-proposta">…</span></div>
          <div class="empresa-proposta">
            <div class="empresa-proposta__logo" id="empresa-logo" aria-hidden="true"></div>
            <label class="campo"><span class="campo__rotulo">Empresa proponente</span><select name="empresaId"></select></label>
          </div>
          <p class="fraco empresa-proposta__resumo" id="empresa-resumo"></p>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Validade da proposta (dias)</span><input name="validade" inputmode="numeric" value="60"></label>
            <label class="campo"><span class="campo__rotulo">Prazo de entrega/execução</span><input name="prazo" maxlength="200" placeholder="ex.: 15 dias após o pedido"></label>
            <label class="campo"><span class="campo__rotulo">Condições de pagamento</span><input name="pagamento" maxlength="200" placeholder="ex.: 30 dias após o aceite"></label>
          </div>
        </section>

        <section class="card spot form">
          <div class="card__titulo"><h2>${icone('arquivo')} <span class="passo-num">2</span> Licitação</h2></div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Minhas licitações (favoritas e CRM)</span>
              <select name="licitacaoId"><option value="">Carregando...</option></select></label>
            <label class="campo"><span class="campo__rotulo">ou ID / nº de controle PNCP / link do PNCP</span>
              <span class="campo__com-botao"><input name="codigo" placeholder="ex.: 12345 ou 04628376000104-1-000060/2026">
              <button class="btn" type="button" data-acao="buscar-licitacao">${icone('busca')} Buscar</button></span></label>
          </div>
          <p class="fraco" id="lic-status" aria-live="polite">Os campos abaixo são preenchidos sozinhos e podem ser editados (ou preenchidos à mão).</p>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Órgão</span><input name="orgao" maxlength="200" placeholder="ex.: Prefeitura Municipal de Campinas"></label>
            <label class="campo"><span class="campo__rotulo">UF</span><select name="uf">${LH.opcoesUf('')}</select></label>
            <label class="campo"><span class="campo__rotulo">Cidade</span><input name="municipio" maxlength="120"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Modalidade</span><input name="modalidade" maxlength="80" placeholder="ex.: Pregão Eletrônico"></label>
            <label class="campo"><span class="campo__rotulo">Nº da compra / edital</span><input name="numero" maxlength="60" placeholder="ex.: 90010/2026"></label>
            <label class="campo"><span class="campo__rotulo">Processo</span><input name="processo" maxlength="80"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Publicação</span><input type="date" name="publicacao"></label>
            <label class="campo"><span class="campo__rotulo">Data da sessão pública</span><input type="date" name="abertura"></label>
            <label class="campo"><span class="campo__rotulo">Horário de abertura da sessão</span><input type="time" name="hora"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Envio das propostas até (data)</span><input type="date" name="limite"></label>
            <label class="campo"><span class="campo__rotulo">Envio das propostas até (hora)</span><input type="time" name="horaLimite"></label>
            <p class="nota nota--alerta" id="nota-horarios" hidden>Envio e abertura estão iguais: o PNCP só informa o fim do recebimento das propostas. Confira o horário da sessão no edital.</p>
          </div>
          <label class="campo"><span class="campo__rotulo">Objeto</span><textarea name="objeto" rows="2" maxlength="2000"></textarea></label>
          <input type="hidden" name="idPncp">
        </section>

        <section class="card spot">
          <div class="card__titulo"><h2>${icone('etiqueta')} <span class="passo-num">3</span> Itens</h2>
            <span class="chips">
              <button class="btn btn--pequeno" type="button" data-acao="importar">${icone('baixar')} Importar itens do edital</button>
              <button class="btn btn--pequeno" type="button" data-acao="planilha">${icone('arquivo')} Colar ou importar planilha</button>
              <button class="btn btn--pequeno" type="button" data-acao="item">${icone('mais')} Adicionar item</button>
            </span></div>
          <div class="tabela-rolagem">
            <table class="tabela itens itens-proposta">
              <thead><tr><th>Item</th><th>Qtd.</th><th>Unid.</th><th>Descrição / especificação</th><th>Marca</th><th>Valor unit. (R$)</th><th class="numero">Total</th><th></th></tr></thead>
              <tbody id="itens">${linhaItem({}, 0)}</tbody>
            </table>
          </div>
          <div class="total-geral"><span class="suave">Valor global</span><strong id="total">R$ 0,00</strong></div>
          <p class="fraco" id="extenso" style="text-align:right"></p>
        </section>

        <section class="card spot form">
          <div class="card__titulo"><h2>${icone('arquivoCheck')} <span class="passo-num">4</span> Declarações</h2>
            <button class="btn btn--pequeno btn--fantasma" type="button" data-acao="decl-padrao">Restaurar textos padrão</button></div>
          <p class="fraco">Saem completas na proposta. Revise e ajuste cada texto conforme o edital; desmarque a que não se aplica. <b>{validade}</b> e <b>{pagamento}</b> usam os campos acima.</p>
          <div class="decl-proposta" id="declaracoes"></div>
        </section>

        <section class="card spot form">
          <div class="card__titulo"><h2>${icone('moeda')} <span class="passo-num">5</span> Dados bancários e fechamento</h2></div>
          <label class="campo"><span class="campo__rotulo">Dados bancários</span>
            <select name="bancoOrigem"><option value="cadastro">Usar os do cadastro da empresa</option><option value="proposta">Informar outros só nesta proposta</option></select></label>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Banco</span><input name="banco" maxlength="80"></label>
            <label class="campo"><span class="campo__rotulo">Agência</span><input name="agencia" maxlength="20"></label>
            <label class="campo"><span class="campo__rotulo">Conta</span><input name="conta" maxlength="30"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Tipo de conta</span><select name="tipoConta">${LH.opcoes(regras.TIPOS_CONTA, regras.TIPOS_CONTA[0])}</select></label>
            <label class="campo"><span class="campo__rotulo">Pix (opcional): tipo da chave</span><select name="pixTipo">${LH.opcoes(regras.TIPOS_PIX, '')}</select></label>
            <label class="campo"><span class="campo__rotulo">Chave Pix</span><input name="pix" maxlength="77"></label>
          </div>
          <p class="fraco" id="banco-nota"></p>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Cidade (local da assinatura)</span><input name="fimCidade" maxlength="120"></label>
            <label class="campo"><span class="campo__rotulo">Data</span><input type="date" name="fimData"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Responsável legal</span><input name="fimRepresentante" maxlength="160"></label>
            <label class="campo"><span class="campo__rotulo">RG</span><input name="fimRg" maxlength="30"></label>
            <label class="campo"><span class="campo__rotulo">CPF</span><input name="fimCpf" maxlength="20" inputmode="numeric"></label>
            <label class="campo"><span class="campo__rotulo">Cargo</span><input name="fimCargo" maxlength="80"></label>
          </div>
          <p class="fraco">Vêm do <a href="#/empresa">cadastro da empresa</a> e podem ser ajustados só nesta proposta.</p>
        </section>

        <section class="card spot form">
          <div class="card__titulo"><h2>${icone('check')} <span class="passo-num">6</span> Observações e gerar</h2></div>
          <label class="campo"><span class="campo__rotulo">Observações (opcional)</span>
            <textarea name="observacoes" maxlength="2000" placeholder="Garantia, assistência técnica, frete..."></textarea></label>
          <div class="card__rodape">
            <button class="btn btn--primario" type="submit">${icone('check')} Salvar proposta</button>
            <button class="btn" type="button" data-acao="previa">${icone('olho')} Pré-visualizar</button>
            <span class="exportar" role="group" aria-label="Exportar">
              <button class="btn" type="button" data-acao="pdf">${icone('impressora')} Baixar PDF</button>
              <button class="btn" type="button" data-acao="word">${icone('arquivo')} Baixar Word</button>
            </span>
          </div>
          <p class="fraco nao-imprimir">PDF: na janela de impressão, escolha <b>Salvar como PDF</b>. Word: o arquivo .doc abre no Word, LibreOffice ou Google Docs para ajustes finais.</p>
        </section>
      </form>
      ${AVISO_RESPONSABILIDADE}
      <section class="area-impressao" id="previa" style="margin-top:18px"></section>`,
    montar(raiz, p) {
      const form = raiz.querySelector('#form-proposta');
      const corpo = raiz.querySelector('#itens');
      const status = raiz.querySelector('#lic-status');
      let atual = null; // proposta aberta (ao editar)
      let numero = '';
      let lista = []; // licitações do usuário (favoritas/CRM)

      let pronto = false; // só salva/baixa depois de carregar (senão uma proposta aberta viraria outra)
      let sujo = false; // alterações ainda não salvas
      form.addEventListener('input', () => { sujo = true; });
      const aoSair = (e) => {
        if (!form.isConnected) return window.removeEventListener('beforeunload', aoSair);
        if (sujo) e.preventDefault();
      };
      window.addEventListener('beforeunload', aoSair);
      let ocupado = false; // clique duplo não salva nem baixa duas vezes
      const umaVez = (fn) => async (...a) => {
        if (ocupado) return;
        ocupado = true;
        try { await fn(...a); } finally { ocupado = false; }
      };
      const aindaNao = () => {
        if (!pronto) LH.aviso('A proposta ainda está carregando. Se não abrir, recarregue a página.', 'alerta');
        return !pronto;
      };
      let foto = null; // snapshot da empresa salvo na proposta aberta
      /** Empresa do formulário: o snapshot da proposta, enquanto for a mesma empresa. */
      const empresaForm = () => (LH.repo.modo === 'demo' && !form.empresaId.value && !atual ? empresa() : null) || empresaDe({
        empresaId: form.empresaId.value || null,
        extras: foto && form.empresaId.value === String(foto.id) ? { empresa: foto } : {},
      });
      /** Reserva o número só quando o documento vai existir (salvar ou baixar). */
      const garantirNumero = async () => {
        numero = numero || await LH.repo.proximoNumeroProposta();
        raiz.querySelector('#numero-proposta').textContent = numero;
        return numero;
      };

      const ler = () => {
        const itens = [...corpo.rows].map((tr, i) => ({
          numero: tr.querySelector("[name=item]").value.trim() || String(i + 1),
          descricao: tr.querySelector('[name=descricao]').value.trim(),
          marca: tr.querySelector('[name=marca]').value.trim(),
          unidade: tr.querySelector('[name=unidade]').value.trim() || 'UN',
          quantidade: regras.lerNumero(tr.querySelector('[name=quantidade]').value),
          unitario: regras.lerNumero(tr.querySelector('[name=unitario]').value),
        }));
        const total = totalProposta(itens);
        const licitacao = Object.fromEntries(CAMPOS_LIC.map((k) => [k, String(form[k].value || '').trim()]));
        const origem = form.bancoOrigem.value;
        const extras = {
          ...(atual?.extras || {}),
          empresa: regras.snapshotEmpresa(empresaForm()),
          declaracoes: [...raiz.querySelectorAll('[data-decl]')].map((d) => ({
            id: d.dataset.decl, titulo: d.dataset.titulo, ativo: d.querySelector('input[type=checkbox]').checked,
            texto: d.querySelector('textarea').value.trim().slice(0, 2000),
          })),
          banco: origem === 'proposta'
            ? { origem, ...lerBanco() }
            : { origem: 'cadastro' },
          fechamento: {
            cidade: form.fimCidade.value.trim(), data: form.fimData.value || LH.datas.hoje(), representante: form.fimRepresentante.value.trim(),
            rg: form.fimRg.value.trim(), cpf: form.fimCpf.value.trim(), cargo: form.fimCargo.value.trim(),
          },
        };
        return {
          extras,
          id: atual?.id, numero, criada: atual?.criada || LH.datas.hoje(), status: atual?.status || 'Rascunho',
          licitacaoId: Number(form.licitacaoId.value) || atual?.licitacaoId || null,
          licitacao: Object.values(licitacao).some(Boolean) ? licitacao : null,
          empresaId: form.empresaId.value || null,
          validade: form.validade.value || 60, prazo: form.prazo.value.trim(), pagamento: form.pagamento.value.trim(),
          observacoes: form.observacoes.value.trim(), itens, total,
        };
      };
      const recalcular = () => {
        [...corpo.rows].forEach((tr) => {
          const q = regras.lerNumero(tr.querySelector('[name=quantidade]').value);
          const u = regras.lerNumero(tr.querySelector('[name=unitario]').value);
          tr.querySelector('[data-total]').textContent = q && u ? fmt.moeda(totalLinha({ quantidade: q, unitario: u })) : '—';
        });
        const { total } = ler();
        raiz.querySelector('#total').textContent = fmt.moeda(total);
        raiz.querySelector('#extenso').textContent = total ? `(${LH.porExtenso(total)})` : '';
      };
      const previa = () => {
        const caixa = raiz.querySelector('#previa');
        const proposta = ler();
        caixa.innerHTML = `${estiloPagina(proposta)}<div class="secao__titulo nao-imprimir"><h2>Pré-visualização</h2></div>${folhaProposta(proposta)}`;
        return caixa;
      };
      // Ctrl+P também imprime a proposta atual (sem a prévia, sairia em branco).
      let imprimindo = false;
      const antesDeImprimir = () => {
        if (!raiz.isConnected || !form.isConnected) return window.removeEventListener('beforeprint', antesDeImprimir);
        if (imprimindo) return; // o botão Baixar PDF já preparou a prévia
        previa();
      };
      window.addEventListener('beforeprint', antesDeImprimir);
      const avisarHorarios = () => {
        const iguais = form.abertura.value && form.abertura.value === form.limite.value && form.hora.value === form.horaLimite.value;
        raiz.querySelector('#nota-horarios').hidden = !iguais;
      };
      for (const k of ['abertura', 'hora', 'limite', 'horaLimite']) form[k].addEventListener('input', avisarHorarios);
      const preencherLicitacao = (cab) => {
        if (!cab) return;
        for (const k of CAMPOS_LIC) if (cab[k] != null && form[k]) form[k].value = cab[k];
        avisarHorarios();
      };
      const usarLicitacao = (l) => {
        preencherLicitacao(cabecalhoDe(l));
        if (l?.id && lista.some((x) => x.id === l.id)) form.licitacaoId.value = String(l.id);
        status.textContent = l ? `Dados de "${(l.objeto || '').slice(0, 80)}" preenchidos. Confira e ajuste se precisar.` : '';
      };
      const adicionarItens = (itens) => {
        const vazia = corpo.rows.length === 1 && !corpo.querySelector('[name=descricao]').value.trim();
        if (vazia) corpo.innerHTML = '';
        corpo.insertAdjacentHTML('beforeend', itens.map((it, k) => linhaItem(it, corpo.rows.length + k)).join(''));
        recalcular();
        sujo = true;
        LH.aviso(`${itens.length} item(ns) na proposta. Agora preencha a marca e o seu valor unitário.`, 'sucesso');
      };
      // Declarações: uma linha por declaração, com o texto completo editável.
      const desenharDeclaracoes = (lista) => {
        raiz.querySelector('#declaracoes').innerHTML = lista.map((d) => `
          <div class="decl-proposta__item" data-decl="${esc(d.id)}" data-titulo="${esc(d.titulo)}">
            <label class="campo--check"><input type="checkbox" ${d.ativo ? 'checked' : ''}><span><b>${esc(d.titulo)}</b></span></label>
            <textarea rows="2" maxlength="2000" aria-label="${esc(d.titulo)}">${esc(d.texto)}</textarea>
          </div>`).join('');
      };
      // Banco: com "cadastro", os campos mostram os dados da empresa (só leitura).
      const lerBanco = () => ({ ...Object.fromEntries(CAMPOS_BANCO.map((k) => [k, form[k].value.trim()])), ...(form.pixTipo.value ? {} : { pix: '' }) });
      let bancoDigitado = null; // volta ao alternar cadastro/proposta
      const mostrarBanco = (salvo = null) => {
        const e = empresaForm();
        const daProposta = form.bancoOrigem.value === 'proposta';
        const fonte = daProposta ? salvo || bancoDigitado : e;
        const valores = fonte && bancoDe({}, fonte);
        for (const k of CAMPOS_BANCO) {
          if (form[k].tagName === 'SELECT') form[k].disabled = !daProposta; else form[k].readOnly = !daProposta;
          if (valores) form[k].value = valores[k];
        }
        form.pix.readOnly = !daProposta || !form.pixTipo.value;
        raiz.querySelector('#banco-nota').innerHTML = daProposta ? 'Estes dados valem só para esta proposta; o cadastro da empresa não muda.'
          : (e.banco ? 'Dados do cadastro da empresa.' : `${icone('info')} A empresa não tem dados bancários. <a href="#/empresa">Cadastre</a> ou escolha "Informar outros".`);
      };
      // Fechamento: preenche com o cadastro (ao trocar de empresa ou numa proposta nova).
      const preencherFechamento = (f = null) => {
        const e = empresaForm();
        const v = fechamentoDe({ extras: { fechamento: f || {} } }, e);
        form.fimCidade.value = v.cidade; form.fimData.value = v.data; form.fimRepresentante.value = v.representante;
        form.fimRg.value = v.rg; form.fimCpf.value = v.cpf; form.fimCargo.value = v.cargo;
      };
      const mostrarEmpresa = () => {
        const e = empresaForm();
        const caixaLogo = raiz.querySelector('#empresa-logo');
        caixaLogo.innerHTML = e.logo ? `<img src="${esc(e.logo)}" alt="">` : `<span>${esc((e.razao || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
        caixaLogo.title = e.logo ? 'Logo que sai no topo da proposta' : 'Sem logo: cadastre em Minha empresa';
        if (!empresas.length && !foto) {
          raiz.querySelector('#empresa-resumo').innerHTML = `<span class="nota nota--alerta empresa-proposta__vazia">${icone('alerta')} Nenhuma empresa cadastrada nesta conta. <a class="btn btn--primario btn--pequeno" href="#/empresa">Cadastrar a empresa</a> Os dados (CNPJ, endereço, banco, responsável e logo) entram sozinhos na proposta.</span>`;
          return;
        }
        raiz.querySelector('#empresa-resumo').innerHTML = e.cnpj
          ? `${esc(LH.cnpj.mascara(e.cnpj))}${e.banco ? ` · banco ${esc(e.banco)} ag. ${esc(e.agencia)} ${esc(bancoDe({}, e).tipoConta.toLowerCase())} ${esc(e.conta)}` : ' · <a href="#/empresa">cadastre os dados bancários</a>'}`
          : `${icone('info')} <a href="#/empresa">Complete os dados da empresa</a>: eles entram na proposta.`;
        if (foto && form.empresaId.value === String(foto.id)) {
          const noCadastro = empresas.some((x) => String(x.id) === String(foto.id));
          raiz.querySelector('#empresa-resumo').innerHTML += `<br>Dados congelados quando a proposta foi salva.${noCadastro ? ' <button type="button" class="link-botao" data-acao="atualizar-empresa">Atualizar com o cadastro</button>' : ''}`;
        }
      };

      // Empresas da conta (a ativa vem marcada).
      let empresas = LH.repo.empresas?.() || [];
      const listarEmpresas = (escolhida) => { form.empresaId.innerHTML = empresas.length
        ? LH.opcoes(empresas.map((e) => [e.id, `${e.razao || 'Empresa sem nome'}${e.cnpj ? ` · ${LH.cnpj.mascara(e.cnpj)}` : ''}`]), escolhida)
        : '<option value="">Nenhuma empresa cadastrada</option>'; };
      listarEmpresas(LH.repo.empresaAtualId?.() || '');
      /** Troca nos campos da assinatura só o que não foi ajustado à mão. */
      const renovarFechamento = (antes) => {
        const f = regras.atualizarFechamento({ cidade: form.fimCidade.value, representante: form.fimRepresentante.value, rg: form.fimRg.value, cpf: form.fimCpf.value, cargo: form.fimCargo.value }, antes, empresaForm());
        form.fimCidade.value = f.cidade; form.fimRepresentante.value = f.representante; form.fimRg.value = f.rg; form.fimCpf.value = f.cpf; form.fimCargo.value = f.cargo;
      };
      /** Relê o cadastro. A proposta salva continua com os dados congelados. */
      const recarregarEmpresas = async () => {
        const antes = empresaForm();
        if (!(await LH.repo.atualizarEmpresas()) || !form.isConnected) return;
        empresas = LH.repo.empresas();
        const id = form.empresaId.value;
        listarEmpresas(id || (atual ? '' : LH.repo.empresaAtualId() || ''));
        if (id && !empresas.some((e) => String(e.id) === id)) {
          if (foto && String(foto.id) === id) form.empresaId.add(new Option(`${foto.razao} (dados salvos na proposta)`, id));
          else form.empresaId.add(new Option('Escolha a empresa', ''), 0);
          form.empresaId.value = foto && String(foto.id) === id ? id : '';
        } else if (!id && atual) { form.empresaId.add(new Option('Escolha a empresa', ''), 0); form.empresaId.value = ''; }
        const depois = empresaForm();
        const mudou = JSON.stringify(regras.snapshotEmpresa(antes)) !== JSON.stringify(regras.snapshotEmpresa(depois));
        mostrarEmpresa();
        if (form.bancoOrigem.value === 'cadastro') mostrarBanco();
        if (!mudou) return;
        renovarFechamento(antes);
        if (raiz.querySelector('#previa').innerHTML) previa();
        LH.aviso('O cadastro da empresa mudou: os dados desta proposta foram atualizados. Confira.', 'info');
      };
      /** Antes de salvar ou baixar: rede lenta ou fora do ar não segura o botão. */
      const conferirCadastro = () => Promise.race([recarregarEmpresas().catch(() => {}), new Promise((r) => { setTimeout(r, 4000); })]);
      const aoVoltar = () => {
        if (!form.isConnected) return document.removeEventListener('visibilitychange', aoVoltar);
        if (document.visibilityState === 'visible' && pronto) recarregarEmpresas().catch(() => {});
      };
      document.addEventListener('visibilitychange', aoVoltar);
      form.empresaId.addEventListener('change', () => {
        mostrarEmpresa(); mostrarBanco(); preencherFechamento({ data: form.fimData.value });
        const meepp = raiz.querySelector('[data-decl="meepp"] input[type=checkbox]');
        if (meepp) meepp.checked = false; // outra empresa: precisa ser marcada de novo
      });
      for (const k of CAMPOS_BANCO) {
        form[k].addEventListener('input', () => {
          if (k === 'pixTipo') { form.pix.readOnly = !form.pixTipo.value; if (!form.pixTipo.value) form.pix.value = ''; }
          bancoDigitado = lerBanco();
        });
      }
      form.bancoOrigem.addEventListener('change', () => mostrarBanco());
      mostrarEmpresa();
      desenharDeclaracoes(declaracoesPadrao());
      mostrarBanco();
      preencherFechamento();

      // Busca a licitação pelo ID, nº de controle ou link do PNCP.
      const buscarCodigo = async () => {
        const codigo = form.codigo.value.trim();
        if (!codigo) return LH.aviso('Informe o ID, o nº de controle ou o link do PNCP.', 'alerta');
        status.textContent = 'Procurando a licitação...';
        try {
          const l = await LH.repo.licitacaoPorCodigo(codigo);
          if (!l) { status.textContent = 'Não achei essa licitação no Uso LicitaHub. Preencha os campos à mão.'; return; }
          if (!lista.some((x) => x.id === l.id)) {
            lista = [l, ...lista];
            form.licitacaoId.innerHTML = LH.opcoes(lista.map((x) => [x.id, `${x.numero} · ${x.objeto.slice(0, 70)}`]), l.id, 'Escolha a licitação');
          }
          usarLicitacao(l);
        } catch (e) { status.textContent = e.message; }
      };

      // Itens do edital (PNCP) da licitação escolhida.
      const importar = async () => {
        const id = Number(form.licitacaoId.value) || atual?.licitacaoId;
        if (!id) return LH.aviso('Escolha ou busque a licitação primeiro.', 'alerta');
        if (LH.repo.modo === 'demo') return LH.aviso('Na demonstração não há itens do governo. Entre com a sua conta.', 'alerta');
        const botao = raiz.querySelector('[data-acao=importar]');
        botao.disabled = true;
        const original = botao.innerHTML;
        botao.textContent = 'Lendo os itens no PNCP...';
        try {
          const { itens } = await LH.nuvem.api(`/api/licitacoes/${id}/itens`, { limiteMs: 50_000 });
          if (!itens?.length) return LH.aviso('O PNCP não tem itens publicados para esta licitação. Adicione à mão.', 'alerta');
          escolherItensDoEdital(itens, (marcados) => adicionarItens(marcados.map(itemDoEdital)));
        } catch (e) { LH.aviso(e.message, 'perigo'); } finally { botao.disabled = false; botao.innerHTML = original; }
      };

      // Planilha: arquivo .csv (Excel: "Salvar como CSV") ou células copiadas e coladas.
      const abrirPlanilha = () => {
        const fechar = LH.modal({
          titulo: 'Colar ou importar planilha de itens',
          html: `<p class="fraco">Copie as linhas no Excel/Google Planilhas e cole abaixo, ou escolha um arquivo .csv. Com cabeçalho, as colunas são reconhecidas pelo nome (Item, Descrição, Unid., Qtd., Valor unit., Marca). Sem cabeçalho, use esta ordem: <b>Item · Descrição · Unidade · Quantidade · Valor unitário · Marca</b>.</p>
            <label class="btn btn--pequeno" style="margin:6px 0">${icone('baixar')} Escolher arquivo .csv<input type="file" accept=".csv,.txt,text/csv,text/plain" data-planilha-arquivo hidden></label>
            <textarea data-planilha-texto rows="8" style="width:100%;font-family:monospace" placeholder="Item	Descrição	Unid.	Qtd.	Valor unit.	Marca"></textarea>
            <p class="fraco" data-planilha-resumo aria-live="polite"></p>`,
          acoes: [
            { rotulo: 'Cancelar', classe: 'btn--fantasma' },
            {
              rotulo: 'Adicionar à proposta', classe: 'btn--primario',
              acao: (f, fundo) => {
                const { itens } = regras.lerPlanilha(fundo.querySelector('[data-planilha-texto]').value);
                if (!itens.length) return LH.aviso('Não encontrei itens com descrição. Confira a planilha.', 'alerta');
                f();
                adicionarItens(itens);
              },
            },
          ],
        });
        const fundo = [...document.querySelectorAll('.modal-fundo')].at(-1);
        const texto = fundo.querySelector('[data-planilha-texto]');
        const resumir = () => {
          const { itens, ignoradas } = regras.lerPlanilha(texto.value);
          fundo.querySelector('[data-planilha-resumo]').textContent = texto.value.trim()
            ? `${itens.length} item(ns) reconhecido(s)${ignoradas ? `; ${ignoradas} linha(s) sem descrição ignorada(s)` : ''}.` : '';
        };
        texto.addEventListener('input', resumir);
        fundo.querySelector('[data-planilha-arquivo]').addEventListener('change', async (e) => {
          const arq = e.target.files[0];
          if (!arq) return;
          if (arq.size > 2_000_000) return LH.aviso('Arquivo grande demais (máx. 2 MB).', 'alerta');
          const bytes = new Uint8Array(await arq.arrayBuffer());
          // CSV do Excel costuma vir em Windows-1252; UTF-8 quando é válido.
          try { texto.value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { texto.value = new TextDecoder('windows-1252').decode(bytes); }
          resumir();
        });
        return fechar;
      };

      // Carrega a proposta (ao editar) ou o próximo número, e as licitações do usuário.
      (async () => {
        try {
          await recarregarEmpresas().catch((e) => LH.aviso(e.message, 'alerta')); // sem conexão: segue com o que já tem
          if (p.id) {
            atual = await LH.repo.proposta(p.id);
            if (!atual) { LH.aviso('Proposta não encontrada.', 'alerta'); return LH.ir('proposta/minhas'); }
            numero = atual.numero;
            form.validade.value = atual.validade;
            form.prazo.value = atual.prazo;
            form.pagamento.value = atual.pagamento;
            form.observacoes.value = atual.observacoes;
            foto = atual.extras?.empresa?.razao ? atual.extras.empresa : null;
            const idEmpresa = String(foto?.id || atual.empresaId || '');
            // Empresa excluída do cadastro: continua na proposta, com os dados salvos.
            if (foto && !empresas.some((e) => String(e.id) === idEmpresa)) {
              form.empresaId.add(new Option(`${foto.razao} (dados salvos na proposta)`, idEmpresa));
            }
            if (!idEmpresa) form.empresaId.add(new Option('Escolha a empresa', ''), 0);
            form.empresaId.value = idEmpresa;
            mostrarEmpresa();
            desenharDeclaracoes(declaracoesDe(atual));
            form.bancoOrigem.value = atual.extras?.banco?.origem === 'proposta' ? 'proposta' : 'cadastro';
            if (atual.extras?.banco?.origem === 'proposta') bancoDigitado = atual.extras.banco;
            mostrarBanco(atual.extras?.banco);
            preencherFechamento(atual.extras?.fechamento);
            if (atual.itens?.length) corpo.innerHTML = atual.itens.map(linhaItem).join('');
            raiz.querySelector('h1').textContent = `Proposta ${atual.numero}`;
          } else {
            numero = '';
          }
          pronto = true;
          raiz.querySelector('#numero-proposta').textContent = numero || NUMERO_PENDENTE;
          recalcular();
          const escolhida = Number(atual?.licitacaoId || p.licitacao) || null;
          lista = await LH.repo.licitacoesDoUsuario();
          if (escolhida && !lista.some((l) => l.id === escolhida)) lista = [...(await LH.repo.licitacoes([escolhida])), ...lista];
          form.licitacaoId.innerHTML = LH.opcoes(lista.map((l) => [l.id, `${l.numero} · ${l.objeto.slice(0, 70)}`]), escolhida || '',
            lista.length ? 'Escolha a licitação' : 'Nenhuma favorita: busque pelo ID ao lado');
          if (atual?.licitacao) preencherLicitacao({ ...cabecalhoDe(LH.licitacaoEmCache(escolhida)), ...atual.licitacao });
          else if (escolhida) usarLicitacao(LH.licitacaoEmCache(escolhida) || lista.find((l) => l.id === escolhida));
          // Veio da janela "Ver itens" com itens marcados.
          const pendente = LH.propostaPendente;
          if (!p.id && pendente && Number(pendente.licitacaoId) === escolhida && pendente.itens?.length) {
            LH.propostaPendente = null;
            adicionarItens(pendente.itens.map(itemDoEdital));
          }
        } catch (e) { LH.aviso(e.message, 'perigo'); }
      })();

      form.licitacaoId.addEventListener('change', () => {
        const id = Number(form.licitacaoId.value);
        if (id) usarLicitacao(LH.licitacaoEmCache(id) || lista.find((l) => l.id === id));
      });
      form.codigo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarCodigo(); } });
      corpo.addEventListener('input', recalcular);
      // Ao sair do campo, mostra como o número foi lido ("1.000" vira "1000").
      corpo.addEventListener('change', (e) => {
        if (!['quantidade', 'unitario'].includes(e.target.name)) return;
        const n = regras.lerNumero(e.target.value);
        if (n) e.target.value = numeroTexto(n);
        else if (e.target.value.trim()) LH.aviso('Não entendi esse número. Use, por exemplo, 1.234,56.', 'alerta');
      });
      // Preço de referência: resultados homologados de itens parecidos (palavras principais da descrição).
      LH.ao(raiz, 'click', '[data-preco]', async (e, b) => {
        const tr = b.closest('tr');
        const descricao = tr.querySelector('[name=descricao]').value;
        const termo = LH.termos.grupos(descricao)[0]?.filter((w) => w.length >= 3 && !/^\d+$/.test(w)).slice(0, 3).join(' ') || '';
        if (!termo) return LH.aviso('Escreva a descrição do item primeiro.', 'alerta');
        const fechar = LH.modal({ titulo: `Preço de referência · ${termo}`, html: `<div data-precos>${LH.carregando('Consultando os resultados homologados...')}</div>` });
        const caixa = [...document.querySelectorAll('.modal-fundo [data-precos]')].at(-1);
        try {
          const uf = form.uf.value;
          const p = await LH.repo.mercadoPrecos(termo, { ufs: uf ? [uf] : [], unidade: tr.querySelector('[name=unidade]').value.trim() });
          const semFiltro = !p?.amostras && (uf || tr.querySelector('[name=unidade]').value.trim())
            ? await LH.repo.mercadoPrecos(termo) : null;
          caixa.innerHTML = `${semFiltro ? `<p class="fraco">Sem resultados em ${esc(uf || 'nesta unidade')}; mostrando o Brasil inteiro, todas as unidades.</p>` : ''}${LH.painelPrecos?.(semFiltro || p, termo) || ''}
            ${(semFiltro || p)?.preco_mediano ? `<div class="chips" style="margin-top:10px"><button type="button" class="btn btn--primario" data-usar-preco="${Number((semFiltro || p).preco_mediano)}">Usar a mediana (${fmt.moeda(Number((semFiltro || p).preco_mediano))}) neste item</button></div>` : ''}`;
          caixa.querySelector('[data-usar-preco]')?.addEventListener('click', (ev) => {
            tr.querySelector('[name=unitario]').value = Number(ev.currentTarget.dataset.usarPreco).toFixed(2).replace('.', ',');
            recalcular();
            fechar();
          });
        } catch (erro) { caixa.innerHTML = LH.erroHtml(erro); }
      });
      LH.ao(raiz, 'click', '[data-remover]', (e, b) => {
        if (corpo.rows.length === 1) return LH.aviso('A proposta precisa de pelo menos um item.', 'alerta');
        b.closest('tr').remove();
        recalcular();
      });
      LH.ao(raiz, 'click', '[data-acao]', (e, b) => {
        const acao = b.dataset.acao;
        if (acao === 'item') {
          corpo.insertAdjacentHTML('beforeend', linhaItem({}, corpo.rows.length));
          corpo.rows[corpo.rows.length - 1].querySelector('textarea').focus();
          recalcular();
        }
        if (acao === 'atualizar-empresa') {
          b.disabled = true;
          (async () => {
            try {
              await recarregarEmpresas();
              const antes = empresaForm();
              foto = null;
              mostrarEmpresa(); mostrarBanco(); renovarFechamento(antes);
              sujo = true;
              if (raiz.querySelector('#previa').innerHTML) previa();
              LH.aviso('Dados da empresa atualizados. Salve a proposta para guardar.', 'sucesso');
            } catch (erro) { b.disabled = false; LH.aviso(erro.message, 'perigo'); }
          })();
        }
        if (acao === 'buscar-licitacao') buscarCodigo();
        if (acao === 'decl-padrao') desenharDeclaracoes(declaracoesPadrao());

        if (acao === 'importar') importar();
        if (acao === 'planilha') abrirPlanilha();
        if (acao === 'previa') previa().scrollIntoView({ behavior: 'smooth' });
        if (acao === 'pdf' || acao === 'word') gerar(acao);
      });
      const validadeValida = (proposta) => {
        if (regras.validadeOk(proposta.validade)) return true;
        LH.aviso('A validade da proposta deve ser um número inteiro de 1 a 365 dias.', 'alerta');
        form.validade.focus();
        return false;
      };
      const gerar = umaVez(async (acao) => {
        if (aindaNao() || !form.reportValidity()) return;
        await conferirCadastro();
        const proposta = ler();
        if (!validadeValida(proposta)) return;
        if (!proposta.total) return LH.aviso('Preencha a quantidade e o valor unitário dos itens.', 'alerta');
        if (!(await conferirPendencias(proposta, 'Baixar mesmo assim'))) return;
        try { proposta.numero = await garantirNumero(); } catch (erro) { return LH.aviso(erro.message, 'perigo'); }
        if (!atual || sujo) LH.aviso('O arquivo não fica guardado aqui: clique em "Salvar proposta" para registrar esta versão.', 'info');
        if (acao === 'word') return baixarWord(proposta);
        previa();
        await Promise.all([...raiz.querySelectorAll('#previa img')].map((i) => i.decode().catch(() => {}))); // logo pronto antes de imprimir
        const titulo = document.title;
        document.title = `Proposta ${proposta.numero}`; // nome sugerido do arquivo PDF
        imprimindo = true;
        window.print();
        imprimindo = false;
        setTimeout(() => { document.title = titulo; }, 1000);
      });
      form.addEventListener('submit', (e) => { e.preventDefault(); salvar(); });
      const salvar = umaVez(async () => {
        if (aindaNao()) return;
        await conferirCadastro();
        const proposta = ler();
        if (!validadeValida(proposta)) return;
        if (!proposta.total) return LH.aviso('Preencha a quantidade e o valor unitário dos itens.', 'alerta');
        if (!(await conferirPendencias(proposta, 'Salvar mesmo assim'))) return;
        const botao = form.querySelector('[type=submit]');
        botao.disabled = true;
        try {
          proposta.numero = await garantirNumero();
          sujo = false; // o que for digitado durante o salvamento volta a marcar
          const id = await LH.repo.salvarProposta(proposta);
          atual = { ...proposta, id };
          foto = proposta.extras.empresa.razao ? proposta.extras.empresa : null;
          mostrarEmpresa();
          LH.aviso(`Proposta ${proposta.numero} salva em "Minhas propostas".`, 'sucesso');
        } catch (erro) { sujo = true; LH.aviso(erro.message, 'perigo'); }
        botao.disabled = false;
      });
    },
  };

  // --- Minhas propostas ----------------------------------------------------------
  LH.vistas['proposta/minhas'] = {
    titulo: 'Minhas propostas',
    trilha: 'Gerador de proposta',
    render: () => `
      ${LH.cabecalho({
        titulo: 'Minhas propostas',
        texto: 'Propostas salvas, com a situação de cada uma.',
        acoes: `<a class="btn btn--primario" href="#/proposta/criar">${icone('mais')} Criar proposta</a>`,
      })}
      <section class="card spot">
        <div class="tabela-rolagem">
          <table class="tabela">
            <thead><tr><th>Número</th><th>Licitação</th><th>Criada em</th><th>Situação</th><th class="numero">Valor</th><th></th></tr></thead>
            <tbody id="propostas"><tr><td colspan="6">${LH.carregando()}</td></tr></tbody>
          </table>
        </div>
      </section>`,
    montar(raiz) {
      let lista = [];
      const desenhar = async () => {
        try {
          lista = await LH.repo.propostas();
        } catch (e) {
          raiz.querySelector('#propostas').innerHTML = `<tr><td colspan="6">${LH.erroHtml(e)}</td></tr>`;
          return;
        }
        raiz.querySelector('#propostas').innerHTML = lista.length ? lista.map((p) => {
          const l = licitacaoDe(p);
          return `
          <tr>
            <td><strong>${esc(p.numero)}</strong></td>
            <td>${l ? `${esc(l.objeto.slice(0, 60))}…<br><span class="fraco">${esc(l.orgao)}</span>` : '—'}</td>
            <td>${fmt.data(p.criada)}</td>
            <td><select data-status="${esc(p.id)}" aria-label="Situação da proposta ${esc(p.numero)}" style="min-width:140px">${LH.opcoes(STATUS, p.status)}</select></td>
            <td class="numero">${p.total ? fmt.moeda(p.total) : '—'}</td>
            <td style="white-space:nowrap">
              <a class="btn btn--pequeno" href="#/proposta/criar?id=${encodeURIComponent(p.id)}">${icone('lapis')} Abrir</a>
              <button class="btn-icone btn-icone--pequeno" type="button" data-duplicar="${esc(p.id)}" aria-label="Duplicar">${icone('copiar')}</button>
              <button class="btn-icone btn-icone--pequeno" type="button" data-excluir="${esc(p.id)}" aria-label="Excluir">${icone('lixeira')}</button>
            </td>
          </tr>`;
        }).join('') : `<tr><td colspan="6">${LH.vazio('arquivo', 'Nenhuma proposta ainda', '', '<a class="btn btn--primario" href="#/proposta/criar">Criar a primeira</a>')}</td></tr>`;
      };
      LH.ao(raiz, 'change', '[data-status]', async (e, s) => {
        try {
          await LH.repo.mudarStatusProposta(s.dataset.status, s.value);
          LH.aviso('Situação atualizada.', 'sucesso');
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-duplicar]', async (e, b) => {
        try {
          const original = await LH.repo.proposta(b.dataset.duplicar);
          if (!original) throw new Error('Proposta não encontrada.');
          await LH.repo.atualizarEmpresas();
          const copia = regras.duplicar(original, { numero: await LH.repo.proximoNumeroProposta(), hoje: LH.datas.hoje(), empresas: LH.repo.empresas() });
          await LH.repo.salvarProposta({ ...copia, total: totalProposta(copia.itens) });
          LH.aviso('Proposta duplicada.', 'sucesso');
          desenhar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      LH.ao(raiz, 'click', '[data-excluir]', async (e, b) => {
        if (!(await LH.confirmar('Excluir proposta', 'A proposta será apagada.', 'Excluir', true))) return;
        try {
          await LH.repo.removerProposta(b.dataset.excluir);
          desenhar();
        } catch (erro) { LH.aviso(erro.message, 'perigo'); }
      });
      desenhar();
    },
  };

  // --- Gerador de declarações ---------------------------------------------------------
  const MODELOS = regras.LEGAIS.map((d) => ({ ...d, texto: (x) => regras.textoLegal(d, 'DECLARA', x.porte) }));

  LH.vistas.declaracoes = {
    titulo: 'Gerador de declarações',
    render: () => {
      const e = empresa();
      return `
      ${LH.cabecalho({
        titulo: 'Gerador de declarações',
        texto: 'Modelos de declaração conforme a Lei nº 14.133/2021, preenchidos com os dados da sua empresa.',
      })}
      <div class="grade grade--lateral">
        <section class="grade" style="align-content:start">
          <div class="card spot">
            <div class="card__titulo"><h2>${icone('arquivoCheck')} Modelo</h2></div>
            <div class="lista" role="radiogroup" aria-label="Modelo de declaração">
              ${MODELOS.map((m, i) => `
                <label class="lista__item" style="cursor:pointer">
                  <input type="radio" name="modelo" value="${m.id}" ${i ? '' : 'checked'} style="accent-color:var(--azul)">
                  <span class="lista__texto"><strong style="white-space:normal">${esc(m.titulo)}</strong><span>${esc(m.ref)}</span></span>
                </label>`).join('')}
            </div>
          </div>
        </section>
        <form class="card spot form" id="form-decl" autocomplete="off">
          <div class="card__titulo"><h2>${icone('lapis')} Dados</h2></div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Razão social</span><input name="razao" value="${esc(e.razao)}"></label>
            <label class="campo"><span class="campo__rotulo">CNPJ</span><input name="cnpj" value="${esc(e.cnpj ? LH.cnpj.mascara(e.cnpj) : '')}" placeholder="00.000.000/0000-00"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Representante legal</span><input name="rep" value="${esc(e.representante)}"></label>
            <label class="campo"><span class="campo__rotulo">CPF do representante</span><input name="cpf" value="${esc(e.cpfRepresentante)}"></label>
            <label class="campo"><span class="campo__rotulo">Cargo</span><input name="cargo" value="${esc(e.cargo)}"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Órgão</span><input name="orgao" placeholder="ex.: Prefeitura Municipal de Campinas"></label>
            <label class="campo"><span class="campo__rotulo">Licitação</span><input name="edital" placeholder="ex.: Pregão Eletrônico nº 90010/2026"></label>
          </div>
          <div class="form__linha">
            <label class="campo"><span class="campo__rotulo">Cidade</span><input name="cidade" value="${esc(e.cidade)}"></label>
            <label class="campo"><span class="campo__rotulo">Data</span><input type="date" name="data" value="${LH.datas.hoje()}"></label>
            <label class="campo"><span class="campo__rotulo">Porte</span><select name="porte">${LH.opcoes([['ME', 'Microempresa (ME)'], ['EPP', 'Empresa de pequeno porte (EPP)'], ['Demais', 'Demais']], e.porte)}</select></label>
          </div>
          <div class="card__rodape">
            <button class="btn" type="button" data-acao="copiar">${icone('copiar')} Copiar texto</button>
            <button class="btn btn--primario" type="button" data-acao="imprimir">${icone('impressora')} Imprimir / PDF</button>
          </div>
        </form>
      </div>
      <p class="nota nao-imprimir" style="margin-top:18px">${icone('info')} Modelos de referência. Se o edital trouxer um modelo próprio, use o do edital.</p>
      <section class="area-impressao" id="decl-previa" style="margin-top:18px"></section>`;
    },
    montar(raiz) {
      const form = raiz.querySelector('#form-decl');
      const dados = () => {
        const d = Object.fromEntries(new FormData(form));
        const ou = (v, alt) => (String(v || '').trim() ? String(v).trim() : alt);
        return {
          razao: ou(d.razao, '[RAZÃO SOCIAL]'), cnpj: ou(d.cnpj, '[CNPJ]'), rep: ou(d.rep, '[REPRESENTANTE LEGAL]'),
          cpf: ou(d.cpf, '[CPF]'), cargo: ou(d.cargo, '[CARGO]'), orgao: ou(d.orgao, '[ÓRGÃO]'),
          edital: ou(d.edital, '[LICITAÇÃO]'), cidade: ou(d.cidade, '[CIDADE]'), data: d.data || LH.datas.hoje(), porte: d.porte,
        };
      };
      const modelo = () => MODELOS.find((m) => m.id === raiz.querySelector('[name=modelo]:checked').value);
      const textoPuro = () => {
        const d = dados();
        const m = modelo();
        return `DECLARAÇÃO — ${m.titulo.toUpperCase()}\n(${m.ref})\n\n${d.orgao}\nRef.: ${d.edital}\n\n`
          + `A empresa ${d.razao}, inscrita no CNPJ sob o nº ${d.cnpj}, por intermédio de seu representante legal, ${d.rep}, CPF nº ${d.cpf}, ${m.texto(d)}\n\n`
          + `${d.cidade}, ${fmt.dataLonga(d.data)}.\n\n______________________________\n${d.rep}\n${d.cargo} · ${d.razao}`;
      };
      const desenhar = () => {
        const d = dados();
        const m = modelo();
        raiz.querySelector('#decl-previa').innerHTML = `
          <div class="folha">
            <h2>DECLARAÇÃO</h2>
            <p class="fraco" style="text-align:center">${esc(m.titulo)} · ${esc(m.ref)}</p>
            <p style="margin-top:18px">Ao(À) <strong>${esc(d.orgao)}</strong><br>Ref.: ${esc(d.edital)}</p>
            <p style="margin-top:18px;text-align:justify">A empresa <strong>${esc(d.razao)}</strong>, inscrita no CNPJ sob o nº ${esc(d.cnpj)}, por intermédio de seu representante legal, ${esc(d.rep)}, CPF nº ${esc(d.cpf)}, ${esc(m.texto(d))}</p>
            <p style="margin-top:18px">${esc(d.cidade)}, ${esc(fmt.dataLonga(d.data))}.</p>
            <div class="folha__assinatura"><span></span>${esc(d.rep)}<br>${esc(d.cargo)} · ${esc(d.razao)}</div>
          </div>`;
      };
      raiz.addEventListener('input', desenhar);
      raiz.addEventListener('change', desenhar);
      LH.ao(raiz, 'click', '[data-acao]', async (e, b) => {
        if (b.dataset.acao === 'imprimir') { desenhar(); window.print(); }
        if (b.dataset.acao === 'copiar') {
          try { await navigator.clipboard.writeText(textoPuro()); LH.aviso('Texto copiado.', 'sucesso'); } catch { LH.aviso('Não consegui copiar. Selecione o texto da prévia.', 'alerta'); }
        }
      });
      desenhar();
    },
  };
})();
