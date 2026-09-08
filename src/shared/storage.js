/**
 * ProductRadar - Serviço de Armazenamento Local
 * Gerenciamento assíncrono de configurações e cache de contexto de busca via chrome.storage.local (TASK-004 / TASK-008)
 */

import {
  STORAGE_KEYS,
  CONFIG_SCHEMA_VERSION,
  DEFAULT_CONFIG,
} from './constants.js';

import {
  normalizeProductId,
  isValidProductId,
  parseMonetaryInput,
} from './utils.js';

/**
 * Retorna uma cópia profunda segura da configuração padrão.
 * Garante que chamadores não alterem acidentalmente o objeto DEFAULT_CONFIG.
 * 
 * @returns {object} Cópia mutável da configuração padrão.
 */
export function getDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Fusão profunda recursiva de objetos para suportar atualizações parciais
 * preservando todas as propriedades existentes não modificadas.
 * 
 * @param {object} target - Objeto base existente.
 * @param {object} source - Objeto com campos a serem atualizados.
 * @returns {object} Novo objeto com as alterações aplicadas.
 */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}

/**
 * Valida e normaliza um objeto de configuração arbitrário contra o esquema do ProductRadar.
 * Quando campos estiverem ausentes ou inválidos, aplica os valores padrão seguros.
 * 
 * @param {any} rawConfig - Dados brutos da configuração a serem validados.
 * @returns {object} Objeto de configuração estritamente normalizado.
 */
export function normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return getDefaultConfig();
  }

  const defaults = getDefaultConfig();
  const normalized = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
  };

  // 1. Semáforo (trafficLight)
  const rawTl = rawConfig.trafficLight || rawConfig.traffic_light || {};
  let greenMax = Number(rawTl.green_max);
  if (isNaN(greenMax) || greenMax <= 0) {
    greenMax = defaults.trafficLight.green_max;
  } else {
    greenMax = Math.round(greenMax);
  }

  let yellowMax = Number(rawTl.yellow_max);
  if (isNaN(yellowMax) || yellowMax < greenMax) {
    yellowMax = Math.max(greenMax, defaults.trafficLight.yellow_max);
  } else {
    yellowMax = Math.round(yellowMax);
  }

  normalized.trafficLight = {
    green_max: greenMax,
    yellow_max: yellowMax,
  };

  // 2. Taxa de imposto (taxRate)
  const rawTax = rawConfig.taxRate !== undefined ? rawConfig.taxRate : rawConfig.tax_rate;
  const numTax = Number(rawTax);
  if (isNaN(numTax) || numTax < 0 || numTax > 100) {
    normalized.taxRate = defaults.taxRate;
  } else {
    normalized.taxRate = Number(numTax.toFixed(2));
  }

  // 3. Visibilidade dos Indicadores (visibility: search e product separados)
  const rawVis = rawConfig.visibility || {};
  const rawSearch = rawVis.search || rawConfig.searchIndicators || {};
  const rawProduct = rawVis.product || rawConfig.productIndicators || {};

  normalized.visibility = {
    search: {
      sales: typeof rawSearch.sales === 'boolean' ? rawSearch.sales : defaults.visibility.search.sales,
      revenue: typeof rawSearch.revenue === 'boolean' ? rawSearch.revenue : defaults.visibility.search.revenue,
      stock: typeof rawSearch.stock === 'boolean' ? rawSearch.stock : defaults.visibility.search.stock,
      trafficLight: typeof rawSearch.trafficLight === 'boolean'
        ? rawSearch.trafficLight
        : (typeof rawSearch.traffic_light === 'boolean' ? rawSearch.traffic_light : defaults.visibility.search.trafficLight),
    },
    product: {
      sales: typeof rawProduct.sales === 'boolean' ? rawProduct.sales : defaults.visibility.product.sales,
      revenue: typeof rawProduct.revenue === 'boolean' ? rawProduct.revenue : defaults.visibility.product.revenue,
      netMargin: typeof rawProduct.netMargin === 'boolean'
        ? rawProduct.netMargin
        : (typeof rawProduct.net_margin === 'boolean' ? rawProduct.net_margin : defaults.visibility.product.netMargin),
      taxRate: typeof rawProduct.taxRate === 'boolean'
        ? rawProduct.taxRate
        : (typeof rawProduct.tax_rate === 'boolean' ? rawProduct.tax_rate : defaults.visibility.product.taxRate),
      trafficLight: typeof rawProduct.trafficLight === 'boolean'
        ? rawProduct.trafficLight
        : (typeof rawProduct.traffic_light === 'boolean' ? rawProduct.traffic_light : defaults.visibility.product.trafficLight),
    },
  };

  return normalized;
}

/**
 * Operação utilitária interna para obter item de chrome.storage.local
 * Compatível com Promises nativas do Manifest V3 e com adaptadores/mocks de callback.
 * 
 * @param {string} key - Chave a ser lida.
 * @returns {Promise<any>} Valor associado à chave ou undefined.
 */
function getFromStorage(key) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return reject(new Error('chrome.storage.local não está disponível no ambiente atual.'));
    }

    try {
      const res = chrome.storage.local.get([key]);
      if (res && typeof res.then === 'function') {
        res.then((data) => resolve(data ? data[key] : undefined)).catch(reject);
      } else {
        chrome.storage.local.get([key], (data) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(data ? data[key] : undefined);
          }
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Operação utilitária interna para salvar item em chrome.storage.local
 * 
 * @param {string} key - Chave a ser salva.
 * @param {any} value - Valor a ser serializado e salvo.
 * @returns {Promise<void>}
 */
function setToStorage(key, value) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return reject(new Error('chrome.storage.local não está disponível no ambiente atual.'));
    }

    try {
      const res = chrome.storage.local.set({ [key]: value });
      if (res && typeof res.then === 'function') {
        res.then(resolve).catch(reject);
      } else {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Operação utilitária interna para remover item de chrome.storage.local
 * 
 * @param {string} key - Chave a ser removida.
 * @returns {Promise<void>}
 */
function removeFromStorage(key) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return reject(new Error('chrome.storage.local não está disponível no ambiente atual.'));
    }

    try {
      const res = chrome.storage.local.remove([key]);
      if (res && typeof res.then === 'function') {
        res.then(resolve).catch(reject);
      } else {
        chrome.storage.local.remove([key], () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Obtém a configuração atual do ProductRadar armazenada em chrome.storage.local.
 * Retorna uma configuração normalizada padrão segura caso esteja ausente ou corrompida.
 * 
 * @returns {Promise<object>} Configuração completa normalizada.
 */
export async function getConfig() {
  try {
    const rawStored = await getFromStorage(STORAGE_KEYS.CONFIG);
    if (!rawStored) {
      return getDefaultConfig();
    }
    return normalizeConfig(rawStored);
  } catch (err) {
    console.warn('[ProductRadar Storage] Falha ao ler configuração. Usando padrão seguro:', err);
    return getDefaultConfig();
  }
}

/**
 * Salva uma nova configuração completa em chrome.storage.local.
 * Valida e normaliza os dados antes de persistir.
 * 
 * @param {object} config - Nova configuração.
 * @returns {Promise<object>} Configuração normalizada persistida.
 */
export async function saveConfig(config) {
  const normalized = normalizeConfig(config);
  await setToStorage(STORAGE_KEYS.CONFIG, normalized);
  return normalized;
}

/**
 * Atualiza parcialmente a configuração existente, preservando todos os campos
 * e subcampos não informados no objeto de atualização parcial.
 * 
 * @param {object} partialConfig - Objeto com os campos parciais a serem modificados.
 * @returns {Promise<object>} Configuração completa atualizada e persistida.
 */
export async function updateConfig(partialConfig) {
  const currentConfig = await getConfig();
  const merged = deepMerge(currentConfig, partialConfig);
  const normalized = normalizeConfig(merged);
  await setToStorage(STORAGE_KEYS.CONFIG, normalized);
  return normalized;
}

/**
 * Restaura todas as configurações para os valores padrão do ProductRadar.
 * 
 * @returns {Promise<object>} Configuração padrão restaurada e persistida.
 */
export async function resetConfig() {
  const defaults = getDefaultConfig();
  await setToStorage(STORAGE_KEYS.CONFIG, defaults);
  return defaults;
}

// =============================================================================
// SEÇÃO: PERSISTÊNCIA DE CONTEXTO DE PRODUTO DERIVADO DE BUSCA (TASK-008)
// =============================================================================

/**
 * Valida e normaliza determinísticamente um registro de contexto de busca de produto.
 * Aceita exclusivamente os campos aprovados no modelo TASK-006.
 * Rejeita qualquer registro sem um ID canônico MLB válido e não mescla dados de PDP.
 * 
 * @param {any} raw - Dados brutos do card de busca.
 * @returns {object|null} Registro normalizado e defensivo, ou null se inválido.
 */
export function normalizeSearchContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const rawId = typeof raw.id === 'string' ? raw.id : '';
  const canonicalId = normalizeProductId(rawId);
  if (!canonicalId || !isValidProductId(canonicalId)) {
    return null;
  }

  const type = raw.type === 'CATALOG' ? 'CATALOG' : 'STANDARD';
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';

  // 1. Preço
  const rawPrice = raw.price || {};
  let currentPrice = null;
  if (typeof rawPrice.current === 'number' && !isNaN(rawPrice.current) && rawPrice.current >= 0) {
    currentPrice = Number(rawPrice.current.toFixed(2));
  }
  let originalPrice = null;
  if (typeof rawPrice.original === 'number' && !isNaN(rawPrice.original) && rawPrice.original >= 0) {
    originalPrice = Number(rawPrice.original.toFixed(2));
  }
  let discountPercent = null;
  if (
    typeof rawPrice.discountPercent === 'number' &&
    !isNaN(rawPrice.discountPercent) &&
    rawPrice.discountPercent > 0 &&
    rawPrice.discountPercent <= 100
  ) {
    discountPercent = Math.round(rawPrice.discountPercent);
  }

  let installments = null;
  if (rawPrice.installments && typeof rawPrice.installments === 'object') {
    const rawInst = rawPrice.installments;
    let count = null;
    if (typeof rawInst.count === 'number' && !isNaN(rawInst.count) && rawInst.count > 0) {
      count = Math.round(rawInst.count);
    }
    let amount = null;
    if (typeof rawInst.amount === 'number' && !isNaN(rawInst.amount) && rawInst.amount >= 0) {
      amount = Number(rawInst.amount.toFixed(2));
    }
    let hasInterest = null;
    if (typeof rawInst.hasInterest === 'boolean') {
      hasInterest = rawInst.hasInterest;
    }
    installments = {
      count,
      amount,
      hasInterest,
    };
  }

  // 2. Vendedor
  const rawSeller = raw.seller || {};
  const sellerName = typeof rawSeller.name === 'string' && rawSeller.name.trim() ? rawSeller.name.trim() : null;

  // 3. Avaliações
  const rawRating = raw.rating || {};
  let score = null;
  if (typeof rawRating.score === 'number' && !isNaN(rawRating.score) && rawRating.score >= 1 && rawRating.score <= 5) {
    score = Number(rawRating.score.toFixed(1));
  }
  let reviewsCount = null;
  if (typeof rawRating.reviewsCount === 'number' && !isNaN(rawRating.reviewsCount) && rawRating.reviewsCount >= 0) {
    reviewsCount = Math.round(rawRating.reviewsCount);
  }

  // 4. Frete
  const rawShipping = raw.shipping || {};
  const isFree = Boolean(rawShipping.isFree);
  const isFull = Boolean(rawShipping.isFull);

  // 5. Patrocinado
  const isSponsored = Boolean(raw.isSponsored);

  // 6. Imagem
  let imageUrl = null;
  if (typeof raw.imageUrl === 'string' && raw.imageUrl.trim()) {
    imageUrl = raw.imageUrl.trim();
  }

  // 7. Quantidade Vendida e Estoque Observados (TASK-018)
  let soldQuantity = null;
  if (typeof raw.soldQuantity === 'number' && !isNaN(raw.soldQuantity) && raw.soldQuantity >= 0) {
    soldQuantity = Math.round(raw.soldQuantity);
  }

  let availableStock = null;
  if (typeof raw.availableStock === 'number' && !isNaN(raw.availableStock) && raw.availableStock >= 0) {
    availableStock = Math.round(raw.availableStock);
  }

  // Retorna objeto estritamente restrito ao esquema TASK-006 / TASK-018 sem campos de PDP ou métricas calculadas
  return {
    id: canonicalId,
    type,
    url,
    title,
    price: {
      current: currentPrice,
      original: originalPrice,
      currency: 'BRL',
      discountPercent,
      installments,
    },
    seller: {
      name: sellerName,
    },
    rating: {
      score,
      reviewsCount,
    },
    shipping: {
      isFree,
      isFull,
    },
    isSponsored,
    imageUrl,
    soldQuantity,
    availableStock,
  };
}

/**
 * Lê o dicionário de cache de contexto de busca armazenado em chrome.storage.local.
 * 
 * @returns {Promise<Record<string, object>>} Dicionário chaveado por ID canônico de produto.
 */
async function getProductCacheMap() {
  try {
    const rawCache = await getFromStorage(STORAGE_KEYS.PRODUCT_CACHE);
    if (!rawCache || typeof rawCache !== 'object' || Array.isArray(rawCache)) {
      return {};
    }
    return rawCache;
  } catch (err) {
    console.warn('[ProductRadar Storage] Falha ao ler cache de produtos:', err);
    return {};
  }
}

/**
 * Salva o contexto de busca de um produto indexado por seu ID canônico no chrome.storage.local.
 * Rejeita produtos sem ID canônico válido e preserva a integridade de chamadores via cópia defensiva.
 * 
 * @param {object} productData - Modelo de card de busca gerado por extractSearchPageData.
 * @returns {Promise<object|null>} Objeto normalizado persistido ou null se inválido.
 */
export async function saveProductSearchContext(productData) {
  const normalized = normalizeSearchContext(productData);
  if (!normalized) {
    return null;
  }

  const cache = await getProductCacheMap();
  cache[normalized.id] = normalized;

  await setToStorage(STORAGE_KEYS.PRODUCT_CACHE, cache);
  return JSON.parse(JSON.stringify(normalized));
}

/**
 * Salva múltiplos contextos de produto em uma única transação de armazenamento.
 * 
 * @param {object[]} productsList - Lista de modelos de cards de busca.
 * @returns {Promise<number>} Quantidade de produtos válidos persistidos.
 */
export async function saveMultipleProductSearchContexts(productsList) {
  if (!Array.isArray(productsList) || productsList.length === 0) {
    return 0;
  }

  const cache = await getProductCacheMap();
  let savedCount = 0;

  for (const item of productsList) {
    const normalized = normalizeSearchContext(item);
    if (normalized) {
      cache[normalized.id] = normalized;
      savedCount++;
    }
  }

  if (savedCount > 0) {
    await setToStorage(STORAGE_KEYS.PRODUCT_CACHE, cache);
  }

  return savedCount;
}

/**
 * Recupera os dados de contexto de busca previamente capturados para um produto pelo seu ID canônico.
 * Retorna uma cópia defensiva ou null caso o produto não exista ou o ID seja inválido.
 * 
 * @param {string} productId - Identificador canônico do produto (ex: "MLB1234567890").
 * @returns {Promise<object|null>} Dados de contexto de busca do produto ou null.
 */
export async function getProductSearchContext(productId) {
  const canonicalId = normalizeProductId(productId);
  if (!canonicalId || !isValidProductId(canonicalId)) {
    return null;
  }

  const cache = await getProductCacheMap();
  const entry = cache[canonicalId];
  if (!entry) {
    return null;
  }

  const normalized = normalizeSearchContext(entry);
  if (!normalized) {
    return null;
  }

  return JSON.parse(JSON.stringify(normalized));
}

/**
 * Remove o contexto de busca associado a um ID canônico de produto do cache.
 * 
 * @param {string} productId - Identificador canônico a ser removido.
 * @returns {Promise<boolean>} true se removido com sucesso, false caso contrário.
 */
export async function removeProductSearchContext(productId) {
  const canonicalId = normalizeProductId(productId);
  if (!canonicalId || !isValidProductId(canonicalId)) {
    return false;
  }

  const cache = await getProductCacheMap();
  if (Object.prototype.hasOwnProperty.call(cache, canonicalId)) {
    delete cache[canonicalId];
    await setToStorage(STORAGE_KEYS.PRODUCT_CACHE, cache);
    return true;
  }

  return false;
}

/**
 * Limpa todos os registros de contexto de produto armazenados em chrome.storage.local,
 * sem modificar ou remover as configurações do ProductRadar (STORAGE_KEYS.CONFIG).
 * 
 * @returns {Promise<void>}
 */
export async function clearProductSearchContext() {
  await setToStorage(STORAGE_KEYS.PRODUCT_CACHE, {});
}

// =============================================================================
// SEÇÃO: PERSISTÊNCIA DE CUSTO DO FORNECEDOR POR PRODUTO CANÔNICO (TASK-029)
// =============================================================================


