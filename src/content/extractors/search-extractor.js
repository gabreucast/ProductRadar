/**
 * ProductRadar - Extrator de Dados de Busca
 * Motor puro de extração de dados da árvore DOM para páginas de busca do Mercado Livre Brasil (TASK-006 / TASK-018)
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
      // Ignora seletores inválidos ou incompatíveis com segurança
    }
  }
  return null;
}

/**
 * Encontra todos os nós candidatos a cards de produto utilizando a lista de seletores centralizada.
 * Utiliza o primeiro seletor que produzir resultados para evitar cards aninhados/duplicados.
 * 
 * @param {Element|Document} root - Elemento raiz da página ou seção de busca.
 * @returns {Element[]} Lista de elementos DOM de cards de produtos.
 */
function queryCandidateCards(root) {
  if (!root) return [];
  for (const sel of SELECTORS.SEARCH.CARD) {
    try {
      const elements = root.querySelectorAll(sel);
      if (elements && elements.length > 0) {
        return Array.from(elements);
      }
    } catch {
      // Continua para o próximo seletor de card
    }
  }
  return [];
}

/**
 * Converte strings monetárias no padrão brasileiro (BRL) em valores numéricos JavaScript.
 * Suporta elementos DOM com frações e centavos (.andes-money-amount__*) ou strings de texto.
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
    // 1. Prioriza nós estruturados da biblioteca de moeda do Mercado Livre
    const fractionEl = elementOrString.querySelector('.andes-money-amount__fraction');
    const centsEl = elementOrString.querySelector('.andes-money-amount__cents');
    if (fractionEl) {
      const fracDigits = (fractionEl.textContent || '').replace(/\D/g, '');
      const centsDigits = centsEl ? (centsEl.textContent || '').replace(/\D/g, '') : '00';
      if (fracDigits) {
        const val = parseFloat(`${fracDigits}.${centsDigits}`);
        return isNaN(val) ? null : val;
      }
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
 * Extrai e normaliza os dados de um único card de produto da listagem de busca.
 * 
 * @param {Element} card - Elemento DOM do card.
 * @param {string} baseUri - URI base do documento para resolução de links e imagens relativos.
 * @returns {object|null} Objeto estruturado do card ou null se não for um item de produto válido.
 */
function extractCardData(card, baseUri) {
  if (!card) return null;

  // 1. Link e Identificador Canônico
  const linkEl = queryFirst(card, SELECTORS.SEARCH.LINK) || card.querySelector('a[href]');
  const rawHref = linkEl ? (linkEl.getAttribute('href') || linkEl.href || '') : '';

  let cleanUrl = '';
  let parsedUrl = null;

  if (rawHref) {
    try {
      parsedUrl = new URL(rawHref, baseUri);

      // Se a URL do card for um link de redirecionamento ou publicidade (ex: mclics)
      const targetUrlParam = parsedUrl.searchParams && (
        parsedUrl.searchParams.get('url') ||
        parsedUrl.searchParams.get('item_url') ||
        parsedUrl.searchParams.get('target_url') ||
        parsedUrl.searchParams.get('mclics_url') ||
        parsedUrl.searchParams.get('click_url')
      );

      if (targetUrlParam) {
        try {
          const unescaped = decodeURIComponent(targetUrlParam);
          const innerParsed = new URL(unescaped, baseUri);
          cleanUrl = `${innerParsed.origin}${innerParsed.pathname}`;
        } catch {
          cleanUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
        }
      } else {
        // O permalink limpo mantém apenas origin + pathname (sem query params e sem hash)
        cleanUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
      }
    } catch {
      cleanUrl = '';
      parsedUrl = null;
    }
  }

  const id = parsedUrl ? extractCanonicalProductId(parsedUrl) : null;

  let type = 'STANDARD';
  if (parsedUrl) {
    const identity = extractProductIdentity(parsedUrl);
    if (identity && identity.type) {
      type = identity.type;
    }
  }

  // 2. Título
  let title = '';
  const titleEl = queryFirst(card, SELECTORS.SEARCH.TITLE);
  if (titleEl) {
    title = (titleEl.textContent || '').trim();
  }

  // Rejeição determinística de nós decorativos ou sem dados mínimos de produto
  if (!title && !id && !cleanUrl) {
    return null;
  }

  // 3. Preços e Descontos
  const currentPriceEl = queryFirst(card, SELECTORS.SEARCH.CURRENT_PRICE);
  const currentPrice = parseMonetaryValue(currentPriceEl);

  const oldPriceEl = queryFirst(card, SELECTORS.SEARCH.OLD_PRICE);
  const originalPrice = parseMonetaryValue(oldPriceEl);

  let discountPercent = null;
  const discountEl = queryFirst(card, SELECTORS.SEARCH.DISCOUNT);
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

  // 4. Parcelamento
  let installments = null;
  const installmentsEl = queryFirst(card, SELECTORS.SEARCH.INSTALLMENTS);
  if (installmentsEl) {
    const instText = (installmentsEl.textContent || '').trim();
    if (instText) {
      let count = null;
      const countMatch = instText.match(/(\d{1,2})\s*x/i);
      if (countMatch) {
        count = parseInt(countMatch[1], 10);
      }

      // Remove a contagem de parcelas inicial (ex: "em 10x" ou "12x") para não capturar
      // o multiplicador como valor monetário
      const moneySubEl = installmentsEl.querySelector('.andes-money-amount');
      const textAfterCount = instText.replace(/^\s*(?:em\s+)?\d{1,2}\s*x\s*/i, '');
      const amount = parseMonetaryValue(moneySubEl || textAfterCount);

      let hasInterest = null;
      const lowerInst = instText.toLowerCase();
      if (/sem\s+juros/i.test(lowerInst)) {
        hasInterest = false;
      } else if (/com\s+juros/i.test(lowerInst)) {
        hasInterest = true;
      }

      installments = {
        count: count !== null && !isNaN(count) ? count : null,
        amount: amount !== null && !isNaN(amount) ? amount : null,
        hasInterest,
      };
    }
  }

  // 5. Vendedor / Marca
  let sellerName = null;
  const sellerEl = queryFirst(card, SELECTORS.SEARCH.SELLER);
  if (sellerEl) {
    const rawSeller = (sellerEl.textContent || '').trim();
    const cleanedSeller = rawSeller.replace(/^por\s+/i, '').trim();
    if (cleanedSeller) {
      sellerName = cleanedSeller;
    }
  }

  // 6. Avaliações e Total de Opiniões
  let score = null;
  let reviewsCount = null;
  const ratingEl = queryFirst(card, SELECTORS.SEARCH.RATING);
  if (ratingEl) {
    const ratingScoreEl = ratingEl.querySelector('.poly-reviews__rating');
    let scoreText = ratingScoreEl ? ratingScoreEl.textContent : '';
    const fullRatingText = (ratingEl.textContent || '').trim();

    if (!scoreText && fullRatingText) {
      const scoreMatch = fullRatingText.match(/([1-5](?:[.,]\d)?)/);
      if (scoreMatch) {
        scoreText = scoreMatch[1];
      }
    }

    if (scoreText) {
      const s = parseFloat(scoreText.replace(',', '.'));
      if (!isNaN(s) && s >= 1 && s <= 5) {
        score = s;
      }
    }

    const totalReviewsEl = ratingEl.querySelector('.poly-reviews__total');
    let totalText = totalReviewsEl ? totalReviewsEl.textContent : '';
    if (!totalText && fullRatingText) {
      const totalMatch = fullRatingText.match(/\(([\d.]+)\)/);
      if (totalMatch) {
        totalText = totalMatch[1];
      }
    }

    if (totalText) {
      const digitsOnly = totalText.replace(/\D/g, '');
      if (digitsOnly) {
        const c = parseInt(digitsOnly, 10);
        if (!isNaN(c) && c >= 0) {
          reviewsCount = c;
        }
      }
    }
  }

  // 7. Frete e Selo Full
  let isFree = false;
  let isFull = false;
  const shippingEl = queryFirst(card, SELECTORS.SEARCH.SHIPPING);
  if (shippingEl) {
    const shippingText = (shippingEl.textContent || '').toLowerCase();
    if (/frete\s+gr[áa]tis/i.test(shippingText)) {
      isFree = true;
    }
    if (
      /full\b/i.test(shippingText) ||
      shippingEl.querySelector('[class*="full" i], [aria-label*="full" i], [title*="full" i], svg use[href*="full" i]')
    ) {
      isFull = true;
    }
  }

  if (!isFull) {
    const fullIndicator = card.querySelector('[class*="fulfillment" i], [aria-label*="full" i], svg[class*="full" i], svg use[href*="full" i]');
    if (fullIndicator) {
      isFull = true;
    }
  }

  // 8. Marcador de Publicidade / Patrocínio
  const sponsoredEl = queryFirst(card, SELECTORS.SEARCH.SPONSORED);
  const isSponsored = Boolean(sponsoredEl);

  // 9. Imagem do Produto
  let imageUrl = null;
  const imageEl = queryFirst(card, SELECTORS.SEARCH.IMAGE);
  if (imageEl) {
    const rawSrc = imageEl.getAttribute('data-src') || imageEl.getAttribute('src') || imageEl.src;
    if (rawSrc && !rawSrc.startsWith('data:image/svg')) {
      try {
        const resolved = new URL(rawSrc, baseUri);
        imageUrl = resolved.href;
      } catch {
        imageUrl = null;
      }
    }
  }

  // 10. Quantidade Vendida Observada (TASK-018)
  let soldQuantity = null;
  const salesEl = queryFirst(card, [
    '.poly-component__sales',
    '.poly-sales',
    '.ui-search-item__sold-quantity',
    '[class*="sold" i]',
    '[class*="sales" i]',
  ]);
  const salesCandidates = salesEl ? [salesEl] : Array.from(card.querySelectorAll('span, div'));
  for (const el of salesCandidates) {
    const text = (el.textContent || '').trim();
    const salesMatch = text.match(/(?:\+\s*)?([\d.,]+)\s*(mil)?\s*vendidos?\b/i);
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
          break;
        }
      }
    }
  }

  // 11. Estoque Disponível Observado (TASK-018)
  let availableStock = null;
  const stockEl = queryFirst(card, [
    '.poly-component__stock',
    '[class*="stock" i]',
    '[class*="available" i]',
  ]);
  const stockCandidates = stockEl ? [stockEl] : Array.from(card.querySelectorAll('span, div'));
  for (const el of stockCandidates) {
    const text = (el.textContent || '').trim();
    if (/último\s+disponível\b/i.test(text)) {
      availableStock = 1;
      break;
    }
    const stockMatch = text.match(/(?:\(\s*\+?\s*|\brestam\s+|\bapenas\s+)(\d+)(?:\s*(?:disponíveis|unidades|peças)|\s*\))/i);
    if (stockMatch) {
      const parsed = parseInt(stockMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        availableStock = parsed;
        break;
      }
    } else {
      const simpleMatch = text.match(/\+?(\d+)\s+(?:disponíveis|unidades|em\s+estoque)/i);
      if (simpleMatch) {
        const parsed = parseInt(simpleMatch[1], 10);
        if (!isNaN(parsed) && parsed > 0) {
          availableStock = parsed;
          break;
        }
      }
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
 * Função pura que extrai todos os cards de produtos de uma página ou contêiner de busca.
 * Não realiza mutações no DOM, não chama APIs de rede ou storage, e não executa cálculos de negócio.
 * 
 * @param {Document|Element} documentRoot - Raiz do documento ou contêiner de busca a ser analisado.
 * @returns {object[]} Lista de modelos de cards de produto estruturados segundo o esquema do ProductRadar.
 */
export function extractSearchPageData(documentRoot) {
  if (!documentRoot) return [];

  let baseUri = 'https://www.mercadolivre.com.br';
  if (documentRoot) {
    const doc = documentRoot.ownerDocument || documentRoot;
    if (doc && doc.baseURI && !doc.baseURI.startsWith('file:')) {
      baseUri = doc.baseURI;
    }
  }

  const candidateCards = queryCandidateCards(documentRoot);

  const results = [];
  for (const card of candidateCards) {
    const cardData = extractCardData(card, baseUri);
    if (cardData) {
      results.push(cardData);
    }
  }

  return results;
}

/**
 * Classe utilitária representativa do extrator de busca.
 */
export class SearchExtractor {
  /**
   * Executa a extração a partir do nó raiz.
   * 
   * @param {Document|Element} documentRoot
   * @returns {object[]}
   */
  static extract(documentRoot) {
    return extractSearchPageData(documentRoot);
  }
}
