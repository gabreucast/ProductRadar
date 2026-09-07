/**
 * ProductRadar - Extrator de Dados de Produto
 * Motor puro de extração de dados da árvore DOM para páginas de detalhe de produto (PDP) do Mercado Livre Brasil (TASK-007)
 */

import { SELECTORS } from './selectors.js';
import { extractCanonicalProductId, extractProductIdentity } from '../../shared/utils.js';

/**
 * Consulta o primeiro elemento correspondente a partir de uma lista ordenada de seletores CSS candidatos.
 * 
 * @param {Element|Document} root - Elemento raiz no qual a busca será executada.
 * @param {readonly string[]} selectorList - Lista de seletores em ordem de prioridade.
 * @returns {Element|null} Primeiro elemento encontrado ou null.
 */
function queryFirst(root, selectorList) {
  if (!root || !selectorList) return null;
  const list = Array.isArray(selectorList) ? selectorList : [selectorList];
  for (const sel of list) {
    try {
      const found = root.querySelector(sel);
      if (found) return found;
    } catch {
      // Ignora seletores inválidos com segurança
    }
  }
  return null;
}

/**
 * Converte strings monetárias no padrão brasileiro (BRL) em valores numéricos JavaScript.
 * Suporta elementos DOM estruturados do Mercado Livre (.andes-money-amount__*) ou strings de texto.
 * 
 * @param {Element|string|null} elementOrString - Nó DOM ou string contendo o valor monetário.
 * @returns {number|null} Valor numérico ou null se ausente/inválido.
 */
function parseMonetaryValue(elementOrString) {
  if (!elementOrString) return null;

  let text = '';
  if (typeof elementOrString === 'string') {
    text = elementOrString;
  } else if (elementOrString && typeof elementOrString.querySelector === 'function') {
    // 1. Identifica fração e centavos estruturados
    const fractionEl = elementOrString.querySelector('.andes-money-amount__fraction') ||
      (elementOrString.classList && elementOrString.classList.contains('andes-money-amount__fraction') ? elementOrString : null);
    const parent = fractionEl ? fractionEl.parentElement : elementOrString;
    const centsEl = parent ? parent.querySelector('.andes-money-amount__cents') : null;

    if (fractionEl) {
      const fracDigits = (fractionEl.textContent || '').replace(/\D/g, '');
      const centsDigits = centsEl ? (centsEl.textContent || '').replace(/\D/g, '') : '00';
      if (fracDigits) {
        const val = parseFloat(`${fracDigits}.${centsDigits}`);
        return isNaN(val) ? null : val;
      }
    }
    text = elementOrString.textContent || '';
  } else if (elementOrString && elementOrString.nodeType === 1) {
    const parent = elementOrString.parentElement;
    const centsEl = parent ? parent.querySelector('.andes-money-amount__cents') : null;
    const fracDigits = (elementOrString.textContent || '').replace(/\D/g, '');
    const centsDigits = centsEl ? (centsEl.textContent || '').replace(/\D/g, '') : '00';
    if (fracDigits) {
      const val = parseFloat(`${fracDigits}.${centsDigits}`);
      return isNaN(val) ? null : val;
    }
    text = elementOrString.textContent || '';
  }

  if (!text) return null;

  // 2. Extração via regex de padrão monetário brasileiro (ex: "R$ 1.499,90" ou "189,90")
  const match = text.match(/(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (!match) return null;

  let numStr = match[1];
  numStr = numStr.replace(/\./g, '').replace(',', '.');

  const val = parseFloat(numStr);
  return isNaN(val) ? null : val;
}

/**
 * Resolve determinística e seguramente a URL da página do produto a partir do contexto DOM.
 * 
 * @param {Document|Element} root - Raiz do documento ou contêiner.
 * @returns {string} URL bruta ou string vazia.
 */
function resolveProductUrl(root) {
  if (!root) return '';

  // 1. Atributo explícito data-url no nó raiz (útil em testes unitários e fixtures)
  if (typeof root.getAttribute === 'function' && root.getAttribute('data-url')) {
    return root.getAttribute('data-url');
  }

  // 2. Meta tag canônica ou OpenGraph
  if (typeof root.querySelector === 'function') {
    const canonicalEl = root.querySelector('link[rel="canonical"]');
    if (canonicalEl) {
      const href = canonicalEl.getAttribute('href') || canonicalEl.href;
      if (href) return href;
    }
    const ogUrlEl = root.querySelector('meta[property="og:url"]');
    if (ogUrlEl) {
      const content = ogUrlEl.getAttribute('content');
      if (content) return content;
    }
  }

  // 3. Document / window location
  if (root.location && root.location.href) {
    return root.location.href;
  }
  if (root.ownerDocument && root.ownerDocument.location && root.ownerDocument.location.href) {
    return root.ownerDocument.location.href;
  }

  // 4. BaseURI válido
  if (root.baseURI && !root.baseURI.startsWith('file:') && !root.baseURI.startsWith('about:')) {
    return root.baseURI;
  }
  if (root.ownerDocument && root.ownerDocument.baseURI && !root.ownerDocument.baseURI.startsWith('file:') && !root.ownerDocument.baseURI.startsWith('about:')) {
    return root.ownerDocument.baseURI;
  }

  return '';
}

/**
 * Função pura que extrai e normaliza os dados de uma página de detalhe de produto (PDP).
 * Não realiza mutações no DOM, não chama APIs de rede ou storage, e não executa cálculos de negócio.
 * 
 * @param {Document|Element} documentRoot - Raiz do documento ou contêiner do produto.
 * @returns {object} Modelo estruturado de dados da página de produto.
 */
export function extractProductPageData(documentRoot) {
  if (!documentRoot) {
    return {
      id: null,
      type: 'STANDARD',
      url: '',
      title: '',
      price: {
        current: null,
        original: null,
        currency: 'BRL',
        discountPercent: null,
      },
      soldQuantity: null,
      availableStock: null,
      seller: {
        name: null,
      },
      shipping: {
        isFree: false,
        isFull: false,
      },
    };
  }

  // 1. URL e Identidade Canônica
  const rawUrl = resolveProductUrl(documentRoot);
  let cleanUrl = '';
  let id = null;
  let type = 'STANDARD';

  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl);
      cleanUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
      id = extractCanonicalProductId(parsedUrl);
      const identity = extractProductIdentity(parsedUrl);
      if (identity && identity.type) {
        type = identity.type;
      }
    } catch {
      cleanUrl = '';
      id = null;
      type = 'STANDARD';
    }
  }

  // 2. Título do Produto
  let title = '';
  const titleEl = queryFirst(documentRoot, SELECTORS.PRODUCT.TITLE);
  if (titleEl) {
    title = (titleEl.textContent || '').trim();
  }

  // 3. Preços e Desconto
  const currentPriceEl = queryFirst(documentRoot, SELECTORS.PRODUCT.CURRENT_PRICE);
  const currentPrice = parseMonetaryValue(currentPriceEl);

  const oldPriceEl = queryFirst(documentRoot, SELECTORS.PRODUCT.OLD_PRICE);
  const originalPrice = parseMonetaryValue(oldPriceEl);

  let discountPercent = null;
  const discountEl = queryFirst(documentRoot, SELECTORS.PRODUCT.DISCOUNT);
  if (discountEl) {
    const discText = (discountEl.textContent || '').trim();
    const discMatch = discText.match(/(\d+)\s*%/);
    if (discMatch) {
      const dVal = parseInt(discMatch[1], 10);
      if (!isNaN(dVal) && dVal > 0 && dVal <= 100) {
        discountPercent = dVal;
      }
    }
  }

  // 4. Quantidade Vendida (Subtitle / Header subtitle)
  let soldQuantity = null;
  const subtitleEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SUBTITLE_SALES);
  if (subtitleEl) {
    const subtitleText = (subtitleEl.textContent || '').trim();
    // Captura formatos explícitos como "+1000 vendidos", "+50 mil vendidos", "23 vendidos"
    const salesMatch = subtitleText.match(/(?:\+\s*)?([\d.,]+)\s*(mil)?\s*vendidos?\b/i);
    if (salesMatch) {
      let numStr = salesMatch[1].replace(/\./g, '').replace(',', '.');
      let num = parseFloat(numStr);
      if (!isNaN(num)) {
        if (salesMatch[2] && salesMatch[2].toLowerCase() === 'mil') {
          num = Math.round(num * 1000);
        } else {
          num = Math.round(num);
        }
        if (num >= 0) {
          soldQuantity = num;
        }
      }
    }
  }

  // 5. Estoque Disponível
  let availableStock = null;
  const stockEl = queryFirst(documentRoot, SELECTORS.PRODUCT.STOCK);
  if (stockEl) {
    const stockText = (stockEl.textContent || '').trim();
    if (/último\s+disponível\b/i.test(stockText)) {
      availableStock = 1;
    } else {
      const stockMatch = stockText.match(/(?:\(\s*\+?\s*|\brestam\s+|\bapenas\s+)(\d+)(?:\s*(?:disponíveis|unidades|peças)|\s*\))/i);
      if (stockMatch) {
        const parsed = parseInt(stockMatch[1], 10);
        if (!isNaN(parsed) && parsed > 0) {
          availableStock = parsed;
        }
      } else {
        const simpleMatch = stockText.match(/\+?(\d+)\s+(?:disponíveis|unidades)/i);
        if (simpleMatch) {
          const parsed = parseInt(simpleMatch[1], 10);
          if (!isNaN(parsed) && parsed > 0) {
            availableStock = parsed;
          }
        }
      }
    }
  }

  // 6. Vendedor / Marca
  let sellerName = null;
  const sellerEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SELLER);
  if (sellerEl) {
    const rawSeller = (sellerEl.textContent || '').trim();
    const cleaned = rawSeller.replace(/^(?:vendido\s+por|por)\s+/i, '').trim();
    if (cleaned) {
      sellerName = cleaned;
    }
  }

  // 7. Frete e Selo Full
  let isFree = false;
  let isFull = false;
  const shippingEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SHIPPING);
  if (shippingEl) {
    const shippingText = (shippingEl.textContent || '').toLowerCase();
    if (/frete\s+gr[áa]tis/i.test(shippingText)) {
      isFree = true;
    }
    if (
      /full\b/i.test(shippingText) ||
      shippingEl.querySelector('[class*="full" i], [aria-label*="full" i], svg use[href*="full" i]')
    ) {
      isFull = true;
    }
  }

  if (!isFull && typeof documentRoot.querySelector === 'function') {
    const fullBadge = documentRoot.querySelector('.ui-pdp-icon--full, [class*="ui-pdp-full" i], svg[class*="full" i]');
    if (fullBadge) {
      isFull = true;
    }
  }

  return {
    id,
    type,
    url: cleanUrl,
    title,
    price: {
      current: currentPrice,
      original: originalPrice,
      currency: 'BRL',
      discountPercent,
    },
    soldQuantity,
    availableStock,
    seller: {
      name: sellerName,
    },
    shipping: {
      isFree,
      isFull,
    },
  };
}

/**
 * Classe utilitária representativa do extrator de produto.
 */
export class ProductExtractor {
  /**
   * Executa a extração da página de produto a partir da raiz do documento.
   * 
   * @param {Document|Element} documentRoot
   * @returns {object}
   */
  static extract(documentRoot) {
    return extractProductPageData(documentRoot);
  }
}
