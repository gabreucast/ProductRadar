/**
 * ProductRadar - Popup Settings Controller
 * Gerenciamento de preferências do usuário e parâmetros de simulação (TASK-017)
 */

import {
  getConfig,
  saveConfig,
  resetConfig,
  normalizeConfig,
} from '../shared/storage.js';
import { DEFAULT_CONFIG } from '../shared/constants.js';

/**
 * Atualiza os rótulos dinâmicos da legenda do semáforo com os valores dos campos.
 */
function updateLegendLabels(greenVal, yellowVal) {
  const green = parseInt(greenVal, 10) || 100;
  const yellow = parseInt(yellowVal, 10) || 500;

  const lblGreen = document.getElementById('lbl-green');
  const lblGreenNext = document.getElementById('lbl-green-next');
  const lblYellow = document.getElementById('lbl-yellow');
  const lblYellowNext = document.getElementById('lbl-yellow-next');

  if (lblGreen) lblGreen.innerText = green;
  if (lblGreenNext) lblGreenNext.innerText = green + 1;
  if (lblYellow) lblYellow.innerText = yellow;
  if (lblYellowNext) lblYellowNext.innerText = yellow;
}

/**
 * Exibe mensagem de feedback para o usuário.
 * 
 * @param {string} msg - Texto da mensagem.
 * @param {'success'|'error'} [type='success'] - Tipo do status.
 */
function showStatusMessage(msg, type = 'success') {
  const statusEl = document.getElementById('status-msg');
  if (!statusEl) return;

  statusEl.innerText = msg;
  statusEl.className = type === 'success' ? 'status-success' : 'status-error';
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3500);
}

/**
 * Preenche os campos do formulário com o objeto de configuração fornecido.
 * 
 * @param {object} config - Objeto de configuração do ProductRadar.
 */
export function populateForm(config) {
  const norm = normalizeConfig(config);

  const greenInput = document.getElementById('green_max');
  const yellowInput = document.getElementById('yellow_max');
  const taxInput = document.getElementById('tax_rate');

  if (greenInput) greenInput.value = norm.trafficLight.green_max;
  if (yellowInput) yellowInput.value = norm.trafficLight.yellow_max;
  if (taxInput) taxInput.value = norm.taxRate;

  updateLegendLabels(norm.trafficLight.green_max, norm.trafficLight.yellow_max);

  // Visibilidade Busca
  const sVis = norm.visibility.search;
  const setCheck = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
  };

  setCheck('vis_search_trafficLight', sVis.trafficLight);
  setCheck('vis_search_sales', sVis.sales);
  setCheck('vis_search_revenue', sVis.revenue);
  setCheck('vis_search_stock', sVis.stock);

  // Visibilidade Produto
  const pVis = norm.visibility.product;
  setCheck('vis_product_sales', pVis.sales);
  setCheck('vis_product_taxRate', pVis.taxRate);
  setCheck('vis_product_revenue', pVis.revenue);
  setCheck('vis_product_netMargin', pVis.netMargin);
  setCheck('vis_product_trafficLight', pVis.trafficLight);
}

/**
 * Lê os dados dos campos do formulário e constrói o objeto de configuração.
 * 
 * @returns {object} Objeto de configuração bruto coletado do formulário.
 */
export function readFormData() {
  const greenInput = document.getElementById('green_max');
  const yellowInput = document.getElementById('yellow_max');
  const taxInput = document.getElementById('tax_rate');

  const getCheck = (id) => {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  };

  return {
    trafficLight: {
      green_max: greenInput ? parseFloat(greenInput.value) : DEFAULT_CONFIG.trafficLight.green_max,
      yellow_max: yellowInput ? parseFloat(yellowInput.value) : DEFAULT_CONFIG.trafficLight.yellow_max,
    },
    taxRate: taxInput ? parseFloat(taxInput.value) : DEFAULT_CONFIG.taxRate,
    visibility: {
      search: {
        trafficLight: getCheck('vis_search_trafficLight'),
        sales: getCheck('vis_search_sales'),
        revenue: getCheck('vis_search_revenue'),
        stock: getCheck('vis_search_stock'),
      },
      product: {
        sales: getCheck('vis_product_sales'),
        taxRate: getCheck('vis_product_taxRate'),
        revenue: getCheck('vis_product_revenue'),
        netMargin: getCheck('vis_product_netMargin'),
        trafficLight: getCheck('vis_product_trafficLight'),
      },
    },
  };
}

/**
 * Carrega e exibe a configuração persistida ao abrir o popup.
 */
export async function loadSettings() {
  try {
    const config = await getConfig();
    populateForm(config);
  } catch (err) {
    console.error('[ProductRadar Popup] Erro ao carregar configurações:', err);
    populateForm(DEFAULT_CONFIG);
  }
}

/**
 * Salva as alterações feitas pelo usuário no chrome.storage.local via API compartilhada.
 */
export async function handleSave() {
  try {
    const rawData = readFormData();
    const saved = await saveConfig(rawData);
    populateForm(saved);
    showStatusMessage('✓ Configurações salvas com sucesso!', 'success');
  } catch (err) {
    console.error('[ProductRadar Popup] Erro ao salvar configurações:', err);
    showStatusMessage('Erro ao salvar as configurações.', 'error');
  }
}

/**
 * Restaura todas as configurações para os padrões do ProductRadar.
 */
export async function handleReset() {
  try {
    const defaults = await resetConfig();
    populateForm(defaults);
    showStatusMessage('✓ Padrões restaurados com sucesso!', 'success');
  } catch (err) {
    console.error('[ProductRadar Popup] Erro ao restaurar padrões:', err);
    showStatusMessage('Erro ao restaurar os padrões.', 'error');
  }
}

// Inicialização de eventos do DOM
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    loadSettings();

    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleSave);
    }

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', handleReset);
    }

    const greenInput = document.getElementById('green_max');
    const yellowInput = document.getElementById('yellow_max');

    if (greenInput) {
      greenInput.addEventListener('input', () => {
        updateLegendLabels(greenInput.value, yellowInput ? yellowInput.value : 500);
      });
    }

    if (yellowInput) {
      yellowInput.addEventListener('input', () => {
        updateLegendLabels(greenInput ? greenInput.value : 100, yellowInput.value);
      });
    }
  });
}
