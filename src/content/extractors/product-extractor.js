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
 * Converte texto contendo data de criação ou idade do anúncio (ex: "Anúncio criado em 14/05/2025", "Criado Há 480 dias")
 * em uma string ISO de data válida (TASK-028).
 *
 * @param {string|null|undefined} text - Texto bruto observado.
 * @param {Date} [now=new Date()] - Data de referência para cálculos relativos.
 * @returns {string|null} String de data ISO ou null se ausente/inválido.
 */
export function parseCreationDateText(text, now = new Date()) {
  if (!text || typeof text !== 'string') return null;

  const clean = text.trim();

  // 1. Padrão de data brasileira: "Anúncio criado em DD/MM/YYYY" ou "Criado em DD/MM/YYYY"
  const dateMatch = clean.match(/(?:an[úu]ncio\s+)?criado\s+em\s+(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{2,4})/i);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1;
    let year = parseInt(dateMatch[3], 10);
    if (year < 100) {
      year += 2000;
    }
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  // 2. Padrão de dias decorridos: "Criado há X dias" ou "Criado Há X dias"
  const daysMatch = clean.match(/criado\s+h[áa]\s+(\d+)\s+dias?/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    if (!isNaN(days) && days >= 0) {
      const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return d.toISOString();
    }
  }

  // 3. Padrão ISO ou data legível via Date.parse (ex: "2025-05-14", "2025-05-14T13:34:35.445Z", "2025-05-14T13:34:35-03:00")
  const parsedTs = Date.parse(clean);
  if (!isNaN(parsedTs)) {
    return new Date(parsedTs).toISOString();
  }

  // 4. Timestamp numérico em milissegundos ou segundos
  if (/^\d{10,13}$/.test(clean)) {
    let ts = parseInt(clean, 10);
    if (clean.length === 10) ts *= 1000;
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  return null;
}

/**
 * Extrai dados estruturados incorporados na página de produto (application/ld+json, melidata event_data, etc.) (TASK-032 / TASK-037).
 * Serve como camada complementar de extração para obter dados legítimos do Mercado Livre quando seletores visuais não os encontram.
 *
 * @param {Document|Element} root - Raiz do documento ou contêiner.
 * @returns {object} Objeto com campos estruturados observados na página.
 */
function extractStructuredPageData(root) {
  const result = {
    id: null,
    title: null,
    price: null,
    originalPrice: null,
    soldQuantity: null,
    availableStock: null,
    sellerName: null,
    sellerSales: null,
    sellerLocation: null,
    sellerId: null,
    powerSellerStatus: null,
    reputationLevel: null,
    ratingScore: null,
    reviewsCount: null,
    isFreeShipping: false,
    isFull: false,
    isCatalog: null,
    returnAvailable: null,
    creationDate: null,
    installmentInfo: null,
    brand: null,
    category: null,
  };

  if (!root || typeof root.querySelectorAll !== 'function') return result;

  // 1. Parse de scripts application/ld+json
  try {
    const ldScripts = root.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      const content = (script.textContent || '').trim();
      if (!content) continue;
      try {
        const parsed = JSON.parse(content);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && typeof item === 'object') {
            if (item['@type'] === 'Product' || item.offers || item.name) {
              if (item.name && !result.title) result.title = item.name;
              if ((item.sku || item.productID) && !result.id) {
                const rawId = String(item.sku || item.productID);
                if (/^MLB\d+$/i.test(rawId)) result.id = rawId;
              }
              if (item.brand) {
                const bName = typeof item.brand === 'string' ? item.brand : (item.brand.name || null);
                if (bName) {
                  result.brand = bName;
                  if (!result.sellerName) result.sellerName = bName;
                }
              }
              if (item.category && !result.category) {
                result.category = typeof item.category === 'string' ? item.category : null;
              }
              if (item.offers) {
                const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                if (offer && typeof offer.price === 'number' && result.price === null) {
                  result.price = offer.price;
                }
                if (offer && offer.availability === 'https://schema.org/InStock') {
                  if (result.availableStock === null) result.availableStock = 1;
                }
                if (offer && offer.hasMerchantReturnPolicy) {
                  result.returnAvailable = true;
                }
              }
              if (item.aggregateRating && typeof item.aggregateRating === 'object') {
                if (typeof item.aggregateRating.ratingValue === 'number') {
                  result.ratingScore = item.aggregateRating.ratingValue;
                }
                const cnt = item.aggregateRating.ratingCount || item.aggregateRating.reviewCount;
                if (typeof cnt === 'number') {
                  result.reviewsCount = cnt;
                }
              }
              if ((item.dateCreated || item.releaseDate) && !result.creationDate) {
                result.creationDate = String(item.dateCreated || item.releaseDate);
              }
            }
          }
        }
      } catch {
        // Ignora JSONs malformados
      }
    }
  } catch {
    // Ignora
  }

  // 2. Parse de chamadas melidata("add", "event_data", {...}) e JSONs inline
  try {
    const scripts = root.querySelectorAll('script');
    for (const script of scripts) {
      const txt = script.textContent || '';
      if (txt.includes('melidata') && txt.includes('event_data')) {
        const match = txt.match(/melidata\(\s*["']add["']\s*,\s*["']event_data["']\s*,\s*({.*?})\s*\);/s);
        if (match) {
          try {
            const ev = JSON.parse(match[1]);
            if (ev && typeof ev === 'object') {
              if (ev.item_id && !result.id) {
                result.id = String(ev.item_id);
              }
              if (ev.seller_id) {
                result.sellerId = String(ev.seller_id);
              }
              if (typeof ev.sold_quantity === 'number' && ev.sold_quantity >= 0 && result.soldQuantity === null) {
                result.soldQuantity = ev.sold_quantity;
              }
              if (typeof ev.quantity === 'number' && ev.quantity > 0 && (result.availableStock === null || result.availableStock === 1)) {
                result.availableStock = ev.quantity;
              }
              if (typeof ev.catalog_listing === 'boolean' && result.isCatalog === null) {
                result.isCatalog = ev.catalog_listing;
              }
              if (ev.power_seller_status) {
                result.powerSellerStatus = String(ev.power_seller_status);
                if (ev.power_seller_status === 'platinum') {
                  result.reputation = 'MercadoLíder Platinum';
                } else if (ev.power_seller_status === 'gold') {
                  result.reputation = 'MercadoLíder Gold';
                } else {
                  result.reputation = String(ev.power_seller_status);
                }
              }
              if (ev.reputation_level && !result.reputationLevel) {
                result.reputationLevel = String(ev.reputation_level);
              }
              if (typeof ev.return_available === 'boolean' && result.returnAvailable === null) {
                result.returnAvailable = ev.return_available;
              }
              if (ev.installment_info && !result.installmentInfo) {
                result.installmentInfo = String(ev.installment_info);
              }
            }
          } catch {
            // Ignora
          }
        }
      }
      if (!result.creationDate) {
        const startTimeMatch = txt.match(/["']?(?:startTime|date_created|created_at|dateCreated|creation_date)["']?\s*:\s*["']?([^"'\s,}]+)["']?/i);
        if (startTimeMatch) {
          result.creationDate = startTimeMatch[1];
        }
      }
      if (result.soldQuantity === null) {
        const soldMatch = txt.match(/["']?(?:sold_quantity|soldQuantity|sold_units|total_sold)["']?\s*:\s*(\d+)/i);
        if (soldMatch) {
          const sVal = parseInt(soldMatch[1], 10);
          if (!isNaN(sVal) && sVal >= 0) {
            result.soldQuantity = sVal;
          }
        }
      }
    }
  } catch {
    // Ignora
  }

  // 3. Fallbacks de textos DOM para dados do vendedor
  try {
    if (!result.reputation) {
      const sellerStatusEl = root.querySelector('.ui-seller-data-status__info, .ui-pdp-seller-summary__header__subtitle');
      if (sellerStatusEl) {
        const text = (sellerStatusEl.textContent || '').trim();
        if (text && /mercadol[íi]der/i.test(text)) result.reputation = text;
      }
    }
    if (!result.sellerLocation) {
      const locEl = root.querySelector('.ui-seller-data-status__info-location, .ui-seller-info__status-info-location');
      if (locEl) {
        const text = (locEl.textContent || '').trim();
        if (text) result.sellerLocation = text;
      }
    }
  } catch {
    // Ignora
  }

  return result;
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
        sales: null,
        reputation: null,
        location: null,
      },
      shipping: {
        isFree: false,
        isFull: false,
      },
    };
  }

  // Camada de extração de dados estruturados incorporados na página (TASK-032)
  const structured = extractStructuredPageData(documentRoot);

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
  if (!id && structured.id) {
    id = structured.id;
  }

  // 2. Título do Produto
  let title = '';
  const titleEl = queryFirst(documentRoot, SELECTORS.PRODUCT.TITLE);
  if (titleEl) {
    title = (titleEl.textContent || '').trim();
  }
  if (!title && structured.title) {
    title = structured.title;
  }

  // 3. Preços e Desconto
  const currentPriceEl = queryFirst(documentRoot, SELECTORS.PRODUCT.CURRENT_PRICE);
  let currentPrice = parseMonetaryValue(currentPriceEl);
  if (currentPrice === null && structured.price !== null) {
    currentPrice = structured.price;
  }

  const oldPriceEl = queryFirst(documentRoot, SELECTORS.PRODUCT.OLD_PRICE);
  let originalPrice = parseMonetaryValue(oldPriceEl);

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

  // 4. Quantidade Vendida (Subtitle / Header subtitle / Structured Data)
  let soldQuantity = null;
  const subtitleEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SUBTITLE_SALES);
  if (subtitleEl) {
    const subtitleText = (subtitleEl.textContent || '').trim();
    // Captura formatos explícitos como "+1000 vendidos", "+50 mil vendidos", "+10 mil vendidos", "23 vendidos"
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
  if (soldQuantity === null && structured.soldQuantity !== null) {
    soldQuantity = structured.soldQuantity;
  }

  // 5. Estoque Disponível da Variação Selecionada (TASK-032)
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
        const simpleMatch = stockText.match(/\+?(\d+)\s+(?:disponíveis|unidades|peças)/i);
        if (simpleMatch) {
          const parsed = parseInt(simpleMatch[1], 10);
          if (!isNaN(parsed) && parsed > 0) {
            availableStock = parsed;
          }
        }
      }
    }
  }

  // Fallback para dado estruturado se o seletor visual da variação não esteve presente ou não conteve valor numérico
  if (availableStock === null && structured.availableStock !== null) {
    availableStock = structured.availableStock;
  }

  // 6. Vendedor / Informações do Vendedor (TASK-007 / TASK-030 / TASK-032 / TASK-033)
  let sellerName = null;
  let sellerSales = null;
  let sellerReputation = null;
  let sellerLocation = null;

  const sellerEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SELLER);
  if (sellerEl) {
    const rawSeller = (sellerEl.textContent || '').trim();
    const cleaned = rawSeller.replace(/^(?:vendido\s+por|por)\s+/i, '').trim();
    if (cleaned && cleaned.length <= 50 && !/seguir|ir para a p[áa]gina|mercadol[íi]der/i.test(cleaned)) {
      sellerName = cleaned;
    }
  }
  if (!sellerName && structured.sellerName) {
    sellerName = structured.sellerName;
  }

  // Vendas do vendedor (Apenas quantidade explícita de vendas numéricas do vendedor, ex: "+10 mil vendas nos últimos 60 dias")
  const sellerSalesEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SELLER_SALES);
  if (sellerSalesEl) {
    const rawSales = (sellerSalesEl.textContent || '').trim();
    if (rawSales && /vendas|vendidos/i.test(rawSales) && !/mercadol[íi]der/i.test(rawSales)) {
      sellerSales = rawSales;
    }
  }
  if (!sellerSales && structured.sellerSales && /vendas|vendidos/i.test(structured.sellerSales)) {
    sellerSales = structured.sellerSales;
  }

  // Reputação / Status do Vendedor (ex: "MercadoLíder Platinum", "MercadoLíder Gold")
  if (structured.reputation) {
    sellerReputation = structured.reputation;
  } else if (structured.powerSellerStatus) {
    if (structured.powerSellerStatus.toLowerCase() === 'platinum') sellerReputation = 'MercadoLíder Platinum';
    else if (structured.powerSellerStatus.toLowerCase() === 'gold') sellerReputation = 'MercadoLíder Gold';
    else sellerReputation = structured.powerSellerStatus;
  }
  if (!sellerReputation) {
    const sellerStatusEl = queryFirst(documentRoot, [
      '.ui-seller-data-status__info',
      '.ui-pdp-seller-summary__header__subtitle',
      '.ui-seller-info__status-info',
    ]);
    if (sellerStatusEl) {
      const txt = (sellerStatusEl.textContent || '').trim();
      if (txt && /mercadol[íi]der/i.test(txt)) {
        sellerReputation = txt;
      }
    }
  }

  const sellerLocationEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SELLER_LOCATION);
  if (sellerLocationEl) {
    const rawLoc = (sellerLocationEl.textContent || '').trim();
    if (rawLoc) {
      sellerLocation = rawLoc;
    }
  }
  if (!sellerLocation && structured.sellerLocation) {
    sellerLocation = structured.sellerLocation;
  }

  // 7. Frete e Selo Full
  let isFree = false;
  let isFull = false;
  const shippingEl = queryFirst(documentRoot, SELECTORS.PRODUCT.SHIPPING);
  if (shippingEl) {
    const shippingText = (shippingEl.textContent || '').toLowerCase();
    if (/gr[áa]tis/i.test(shippingText)) {
      isFree = true;
    }
    if (
      /full\b/i.test(shippingText) ||
      shippingEl.querySelector('[class*="full" i], [aria-label*="full" i], svg use[href*="full" i]')
    ) {
      isFull = true;
    }
  }
  if (!isFree && structured.isFreeShipping) {
    isFree = true;
  }
  if (!isFree && typeof documentRoot.querySelector === 'function') {
    const freeTextEl = documentRoot.querySelector('.ui-pdp-media--shipping, .ui-pdp-shipping, [class*="shipping" i]');
    if (freeTextEl && /gr[áa]tis/i.test(freeTextEl.textContent || '')) {
      isFree = true;
    }
  }

  if (!isFull && typeof documentRoot.querySelector === 'function') {
    const fullBadge = documentRoot.querySelector('.ui-pdp-icon--full, [class*="ui-pdp-full" i], svg[class*="full" i]');
    if (fullBadge) {
      isFull = true;
    }
  }

  // 8. Catálogo (TASK-030 / TASK-032)
  let isCatalog = type === 'CATALOG' || !!queryFirst(documentRoot, SELECTORS.PRODUCT.CATALOG);
  if (!isCatalog && structured.isCatalog === true) {
    isCatalog = true;
  }

  // 9. Visitas e Comissão ML (TASK-030 - caso legitimamente expostos no DOM)
  let visits = null;
  const visitsEl = queryFirst(documentRoot, SELECTORS.PRODUCT.VISITS);
  if (visitsEl) {
    const vMatch = (visitsEl.textContent || '').match(/([\d.,]+)/);
    if (vMatch) {
      const vParsed = parseInt(vMatch[1].replace(/\D/g, ''), 10);
      if (!isNaN(vParsed) && vParsed > 0) {
        visits = vParsed;
      }
    }
  }

  let commission = null;
  const commissionEl = queryFirst(documentRoot, SELECTORS.PRODUCT.COMMISSION);
  if (commissionEl) {
    commission = parseMonetaryValue(commissionEl);
  }

  // 10. Data de Criação do Anúncio (TASK-028 / TASK-032)
  let creationDate = null;
  if (typeof documentRoot.getAttribute === 'function' && documentRoot.getAttribute('data-creation-date')) {
    creationDate = parseCreationDateText(documentRoot.getAttribute('data-creation-date'));
  }

  if (!creationDate && typeof documentRoot.querySelector === 'function') {
    const metaEl = documentRoot.querySelector('meta[property="product:creation_date"], meta[name="creation_date"], meta[itemprop="dateCreated"]');
    if (metaEl && metaEl.content) {
      creationDate = parseCreationDateText(metaEl.content);
    }

    if (!creationDate) {
      const candidateElements = documentRoot.querySelectorAll('.ui-pdp-subtitle, .ui-pdp-header__subtitle, .ui-pdp-promotions-pill-label, .ui-pdp-description, [class*="creation" i], [class*="created" i]');
      for (const el of candidateElements) {
        const txt = el.textContent || '';
        const parsed = parseCreationDateText(txt);
        if (parsed) {
          creationDate = parsed;
          break;
        }
      }
    }
  }

  if (!creationDate && structured.creationDate) {
    creationDate = parseCreationDateText(structured.creationDate) || structured.creationDate;
  }

  // 11. Marca e Categoria (DOM fallbacks)
  let brand = structured.brand || null;
  if (!brand && typeof documentRoot.querySelector === 'function') {
    const brandEl = documentRoot.querySelector('.ui-pdp-features__part, [class*="brand-name" i]');
    if (brandEl) {
      const txt = (brandEl.textContent || '').trim();
      if (txt && txt.length <= 40) brand = txt;
    }
  }

  let category = structured.category || null;
  if (!category && typeof documentRoot.querySelectorAll === 'function') {
    const breadcrumbEls = documentRoot.querySelectorAll('.ui-pdp-breadcrumb__link, .andes-breadcrumb__link');
    if (breadcrumbEls && breadcrumbEls.length > 0) {
      const catArray = Array.from(breadcrumbEls).map((el) => (el.textContent || '').trim()).filter(Boolean);
      if (catArray.length > 0) {
        category = catArray.join(' > ');
      }
    }
  }

  return {
    id,
    type,
    isCatalog,
    url: cleanUrl,
    title,
    brand,
    category,
    price: {
      current: currentPrice,
      original: originalPrice,
      currency: 'BRL',
      discountPercent,
    },
    soldQuantity,
    availableStock,
    creationDate,
    visits,
    commission,
    seller: {
      name: sellerName,
      sales: sellerSales,
      reputation: sellerReputation,
      location: sellerLocation,
      id: structured.sellerId || null,
      powerSellerStatus: structured.powerSellerStatus || null,
      reputationLevel: structured.reputationLevel || null,
    },
    rating: {
      score: structured.ratingScore || null,
      reviewsCount: structured.reviewsCount || null,
    },
    returnAvailable: structured.returnAvailable !== null ? structured.returnAvailable : null,
    installmentInfo: structured.installmentInfo || null,
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
