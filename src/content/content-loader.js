/**
 * ProductRadar - Content Script Loader
 * Carregador clássico para inicialização dinâmica de módulos ES no Manifest V3 (TASK-012)
 */

(async () => {
  try {
    const mainModuleUrl = chrome.runtime.getURL('src/content/content-main.js');
    await import(mainModuleUrl);
  } catch (err) {
    console.error('[ProductRadar] Falha ao carregar o módulo principal do content script:', err);
  }
})();
