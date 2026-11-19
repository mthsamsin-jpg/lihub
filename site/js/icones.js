/* =============================================================================
   Uso LicitaHub · icones.js
   Ícones SVG de linha (24x24), desenhados para o Uso LicitaHub.
   Uso: LH.icone('busca')  ->  '<svg ...>...</svg>'
   ============================================================================= */
window.LH = window.LH || {};

(function () {
  // Só o "miolo" de cada ícone; o <svg> em volta é igual para todos.
  const desenhos = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.4 5.6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    gota: '<path d="M12 3s6.5 6.6 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>',
    estrela: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h2M14 14h2M8 17.5h2"/>',
    pasta: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    arquivo: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    arquivoCheck: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 15 2 2 4-4"/>',
    brilho: '<path d="M11 3.5 12.9 9l5.6 1.9-5.6 1.9L11 18.5l-1.9-5.7-5.6-1.9L9.1 9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    kanban: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 4v16"/><path d="M5.5 8h1.5M11 8h2M17 8h1.5"/>',
    etiqueta: '<path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.3 8.3a1.8 1.8 0 0 1 0 2.5l-6.7 6.7a1.8 1.8 0 0 1-2.5 0z"/><circle cx="8" cy="8" r="1.6"/>',
    chat: '<path d="M21 14.5a2.5 2.5 0 0 1-2.5 2.5H8.5L4 21V6.5A2.5 2.5 0 0 1 6.5 4h12A2.5 2.5 0 0 1 21 6.5z"/><path d="M8 9h8M8 12.5h5"/>',
    plugue: '<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0z"/><path d="M12 16.5V21"/>',
    predio: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8.5 7h1.5M14 7h1.5M8.5 11h1.5M14 11h1.5M8.5 15h1.5M14 15h1.5"/><path d="M10 21v-3h4v3"/>',
    usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.9.6c0 1.8-2.5 2.3-2.5 4"/><path d="M12 17.3h.01"/>',
    setaBaixo: '<path d="m6 9 6 6 6-6"/>',
    setaEsq: '<path d="m15 6-6 6 6 6"/>',
    setaDir: '<path d="m9 6 6 6-6 6"/>',
    setaCima: '<path d="m6 15 6-6 6 6"/>',
    menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
    fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
    sino: '<path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15 6 8.5"/><path d="M10.2 20a2 2 0 0 0 3.6 0"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCirculo: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
    alerta: '<path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
    relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    lixeira: '<path d="M3.5 6.5h17M9 6.5V4.5h6v2M6 6.5l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-13"/><path d="M10 11v6M14 11v6"/>',
    enviar: '<path d="M12 15.5V3.5M7 8.5l5-5 5 5"/><path d="M4 15.5v3A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
    baixar: '<path d="M12 3.5v12M7 10.5l5 5 5-5"/><path d="M4 15.5v3A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
    impressora: '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8.5" rx="2"/><path d="M7 14h10v6.5H7z"/>',
    copiar: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
    lapis: '<path d="M4 20h4.5L19.3 9.2a2.1 2.1 0 0 0-3-3L5.5 17v3z"/><path d="m14.8 7.7 3 3"/>',
    olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    filtro: '<path d="M3.5 5h17l-6.5 7.8V19l-4 1.5v-7.7z"/>',
    local: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    tendencia: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    grafico: '<path d="M4 20V4M4 20h16"/><rect x="7" y="11" width="3" height="6" rx=".8"/><rect x="12" y="7" width="3" height="10" rx=".8"/><rect x="17" y="13" width="3" height="4" rx=".8"/>',
    escudo: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.3 7.5 9.5 4.3-1.2 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    cadeado: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    raio: '<path d="M13 3 4.5 13.5H12L11 21l8.5-10.5H12z"/>',
    alvo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
    maleta: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18"/>',
    balanca: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0z"/><path d="m19 7-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
    aviao: '<path d="M21 3 10.5 13.5"/><path d="M21 3 14.5 21l-4-7.5L3 9.5z"/>',
    externo: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h4.5"/>',
    sair: '<path d="M15 4h3.5A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5H15"/><path d="M10 16.5 14.5 12 10 7.5M14.5 12H3.5"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
    caixa: '<path d="M3.5 13.5 6 5.5A2 2 0 0 1 7.9 4h8.2A2 2 0 0 1 18 5.5l2.5 8"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5v5a2.5 2.5 0 0 1-2.5 2.5h-12a2.5 2.5 0 0 1-2.5-2.5z"/>',
    pegar: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    atualizar: '<path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9M3.5 12A8.5 8.5 0 0 1 18.1 6.1"/><path d="M18.5 2.5v4h-4M5.5 21.5v-4h4"/>',
    play: '<circle cx="12" cy="12" r="9.5"/><path d="M10 8.5v7l6-3.5z" fill="currentColor"/>',
    moeda: '<circle cx="12" cy="12" r="9"/><path d="M15 9.2c-.5-1-1.6-1.6-3-1.6-1.8 0-3 .9-3 2.2 0 3.2 6.2 1.6 6.2 4.6 0 1.4-1.3 2.3-3.2 2.3-1.5 0-2.7-.7-3.2-1.8M12 6v1.6M12 16.7v1.5"/>',
    telegram: '<path d="M21.5 4.5 2.8 11.6c-.9.4-.9 1.6.1 1.9l4.7 1.5 1.8 5.4c.3.8 1.3 1 1.9.4l2.6-2.5 4.8 3.5c.7.5 1.7.1 1.9-.7l3.1-14.5c.2-1-.8-1.8-1.7-1.4z"/><path d="m7.6 15 9.7-6.6-7.4 7.8"/>',
    computador: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8 20.5h8M12 16.5v4"/>',
    globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
    whatsapp: '<path d="M4 20.5 5.3 16.6A8.5 8.5 0 1 1 8.6 19.5z"/><path d="M9 8.6c.2-.5.6-.6.9-.6h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .5-.1.6l-.5.6c-.1.2-.1.4 0 .6.6 1 1.4 1.8 2.4 2.3.2.1.4.1.6-.1l.6-.6c.2-.2.4-.2.6-.1l1.6.8c.2.1.4.3.4.5v.5c0 .4-.2.8-.6 1-1 .4-2.2.3-3.4-.3a9.5 9.5 0 0 1-3.8-3.7c-.6-1.1-.8-2.2-.3-3.4z"/>',
  };

  LH.icone = function icone(nome, classe = '') {
    const miolo = desenhos[nome] || desenhos.info;
    return `<svg class="${classe}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${miolo}</svg>`;
  };
})();
