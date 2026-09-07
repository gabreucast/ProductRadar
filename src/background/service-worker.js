/**
 * ProductRadar - Background Service Worker
 * Fundação Manifest V3 (TASK-002)
 */

chrome.runtime.onInstalled.addListener(() => {
  // Inicialização inerte e segura do service worker em segundo plano
  console.log('[ProductRadar] Service worker inicializado.');
});
