/**
 * ProductRadar - Centralized DOM Selectors Dictionary
 * Mapeamento semântico centralizado de seletores CSS para páginas de Busca e Produto do Mercado Livre Brasil (TASK-005)
 * 
 * Baseado na pesquisa observada de estrutura DOM do Mercado Livre:
 * - Componentes modernos de busca: .poly-card, .poly-component__*, .poly-price__*
 * - Componentes legados/alternativos de busca: .ui-search-result__wrapper, .ui-search-item__title
 * - Componentes de produto detalhado: #ui-pdp-main-container, .ui-pdp-*
 * 
 * NOTA: A presença de um seletor no dicionário identifica uma localização candidata na árvore DOM,
 * sem garantir previamente a disponibilidade ou existência do dado.
 */

export const SELECTORS = Object.freeze({
  SEARCH: Object.freeze({
    // Contêineres de listagem e layout geral de busca
    CONTAINER: Object.freeze([
      '.ui-search-results',
      '.ui-search-layout',
      '.ui-search-layout--grid',
      '.ui-search-layout--stack',
      'section.ui-search-results',
    ]),
    HEADER_RESULT_COUNT: Object.freeze([
      '.ui-search-search-result__quantity-results',
      '.ui-search-search-result__quantity',
      '.ui-search-search-result',
      '.ui-search-breadcrumb__title',
      '.ui-search-results-count',
      'span.ui-search-search-result__quantity-results',
      'span[class*="quantity-results" i]',
      '[class*="quantity-results" i]',
      '[class*="results-count" i]',
      '[class*="search-result__quantity" i]',
      '.ui-search-head .ui-search-search-result',
      '.ui-search-head',
      '.ui-search-breadcrumb',
    ]),

    // Delimitação de cards individuais de produto
    CARD: Object.freeze([
      '.poly-card',
      '.ui-search-result__wrapper',
      '.ui-search-layout__item',
      '.poly-card--grid',
      '.poly-card--list',
    ]),
    CARD_CONTENT: Object.freeze([
      '.poly-card__content',
    ]),

    // Título e hiperlink
    TITLE_WRAPPER: Object.freeze([
      '.poly-component__title-wrapper',
    ]),
    TITLE: Object.freeze([
      '.poly-component__title',
      'a.poly-component__title',
      '.ui-search-item__title',
      'h2.poly-component__title',
    ]),
    LINK: Object.freeze([
      'a.poly-component__title',
      '.poly-component__title-wrapper a',
      'a.ui-search-link',
      'a.poly-card__portada',
    ]),

    // Vendedor ou marca
    SELLER: Object.freeze([
      '.poly-component__seller',
      '.poly-component__brand',
    ]),

    // Imagem do produto
    IMAGE: Object.freeze([
      '.poly-card__portada img',
      '.poly-component__picture img',
      'img.poly-card__portada',
      '.poly-card__portada picture img',
    ]),

    // Preços, descontos e parcelamento
    CURRENT_PRICE: Object.freeze([
      '.poly-price__current',
      '.poly-price__current .andes-money-amount__fraction',
    ]),
    OLD_PRICE: Object.freeze([
      '.poly-price__labels',
      '.poly-price__original .andes-money-amount__fraction',
    ]),
    DISCOUNT: Object.freeze([
      '.poly-price__discount-polylabel',
      '.andes-money-amount-discount',
    ]),
    INSTALLMENTS: Object.freeze([
      '.poly-price__installments',
    ]),

    // Avaliações
    RATING: Object.freeze([
      '.poly-component__review-compacted',
      '.poly-reviews__rating',
    ]),

    // Frete e envio
    SHIPPING: Object.freeze([
      '.poly-component__shipping-v2',
      '.poly-shipping',
    ]),

    // Marcador de anúncio patrocinado / publicidade
    SPONSORED: Object.freeze([
      '.poly-component__ads-promotions',
      '.poly-component__advertising',
    ]),
  }),

  PRODUCT: Object.freeze({
    // Contêiner principal e cabeçalho da página de produto
    CONTAINER: Object.freeze([
      '#ui-pdp-main-container',
      '.ui-pdp-container',
      '.ui-pdp',
      '.ui-vip-core-container',
      '.ui-vpp-container',
    ]),
    HEADER: Object.freeze([
      '.ui-pdp-header',
      '.ui-vpp-header',
    ]),
    TITLE: Object.freeze([
      'h1.ui-pdp-title',
      '.ui-pdp-title',
      'h1.ui-vpp-highlighted-specs__title',
      '.ui-vpp-highlighted-specs__title',
    ]),
    SUBTITLE_SALES: Object.freeze([
      '.ui-pdp-subtitle',
      '.ui-pdp-header__subtitle',
      '.ui-vpp-header__subtitle',
      '[class*="header__subtitle" i]',
    ]),

    // Preço e descontos do produto
    CURRENT_PRICE: Object.freeze([
      '.ui-pdp-price__second-line .andes-money-amount__fraction',
      '.ui-pdp-price .andes-money-amount__fraction',
    ]),
    OLD_PRICE: Object.freeze([
      '.ui-pdp-price__original-value .andes-money-amount__fraction',
    ]),
    DISCOUNT: Object.freeze([
      '.ui-pdp-price__second-line .andes-money-amount-discount',
    ]),

    // Estoque e vendedor
    STOCK: Object.freeze([
      '.ui-pdp-buybox__quantity__available',
      '.ui-pdp-stock-information',
      '.ui-pdp-stock-information__title',
      '[class*="quantity__available" i]',
      '[class*="stock-information" i]',
    ]),
    SELLER: Object.freeze([
      '.ui-pdp-seller__link-trigger',
      '.ui-seller-data',
      '.ui-pdp-seller-header__title',
      'a.ui-pdp-action-modal__link',
    ]),
    SELLER_SALES: Object.freeze([
      '.ui-seller-info__status-info',
      '.ui-pdp-seller__reputation-info',
      'p.ui-seller-info__status-info',
      '[class*="seller-info" i] [class*="sales" i]',
      '[class*="seller-info" i] [class*="status" i]',
    ]),
    SELLER_LOCATION: Object.freeze([
      '.ui-seller-info__status-info-location',
      '[class*="seller-info" i] [class*="location" i]',
      '.ui-pdp-seller__reputation-info-location',
    ]),
    SHIPPING: Object.freeze([
      '.ui-pdp-media--shipping',
      '.ui-pdp-shipping',
      '.ui-pdp-shipping-cost',
    ]),
    CATALOG: Object.freeze([
      '.ui-pdp-catalog-badge',
      '[class*="catalog-badge" i]',
      '[class*="is-catalog" i]',
      '.ui-pdp-badge--catalog',
    ]),
    VISITS: Object.freeze([
      '.ui-pdp-visits',
      '[class*="visits-count" i]',
      '[class*="ui-pdp-visits" i]',
    ]),
    COMMISSION: Object.freeze([
      '.ui-pdp-commission',
      '[class*="commission-fee" i]',
    ]),
  }),
});
