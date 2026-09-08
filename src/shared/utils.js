/**
 * ProductRadar - Utilitários Compartilhados
 * Funções puras de identidade de produtos, validação de URLs, classificação de contexto e cálculos de indicadores (TASK-003 / TASK-005 / TASK-013 / TASK-014)
 */

import {
  ML_DOMAIN_SUFFIX,
  ML_BASE_URL,
  PRODUCT_ID_TYPES,
  PRODUCT_PATTERNS,
  DEFAULT_CONFIG,
  DATA_SOURCES,
  DATA_SOURCE_LABELS,
  TRAFFIC_LIGHT_STATUS,
  ML_LISTING_TYPES,
} from './constants.js';

/**
 * Constantes para classificação de contexto de páginas do Mercado Livre Brasil.
 */
export const PAGE_CONTEXTS = Object.freeze({
  SEARCH_RESULTS: 'SEARCH_RESULTS',
  PRODUCT_DETAIL: 'PRODUCT_DETAIL',
  UNSUPPORTED: 'UNSUPPORTED',
});

/**
 * Validador e analisador seguro de URLs do Mercado Livre Brasil.
 * Retorna uma instância de URL válida ou null se inválida ou fora do domínio suportado.
 * Função pura e determinística sem efeitos colaterais.
 * 
 * @param {string|URL} urlInput - A URL ou string de rota a ser analisada.
 * @returns {URL|null} Objeto URL seguro ou null.
 */
function parseMercadoLivreUrl(urlInput) {
  if (!urlInput || (typeof urlInput !== 'string' && !(urlInput instanceof URL))) {
    return null;
  }

  try {
    const rawUrlString = typeof urlInput === 'string' ? urlInput.trim() : urlInput.href;
    if (!rawUrlString) {
      return null;
    }

    const isRelative = rawUrlString.startsWith('/');
    const parsed = isRelative
      ? new URL(rawUrlString, ML_BASE_URL)
      : new URL(rawUrlString);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const isMlBrazil = hostname === ML_DOMAIN_SUFFIX || hostname.endsWith(`.${ML_DOMAIN_SUFFIX}`);
    if (!isMlBrazil) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Normaliza um identificador bruto do Mercado Livre para o formato canônico padronizado (MLB + dígitos).
 * Remove hífens e espaços, convertendo o prefixo para maiúsculas.
 * Exemplo: 'MLB-1234567890' -> 'MLB1234567890'
 * 
 * @param {string} rawId - Identificador bruto a ser normalizado.
 * @returns {string|null} Identificador canônico normalizado ou null se inválido.
 */
export function normalizeProductId(rawId) {
  if (!rawId || typeof rawId !== 'string') {
    return null;
  }

  const cleaned = rawId.trim().toUpperCase().replace(/[-\s]/g, '');
  if (PRODUCT_PATTERNS.CANONICAL_ID.test(cleaned)) {
    return cleaned;
  }

  return null;
}

/**
 * Valida se uma string corresponde a um identificador de produto canônico válido.
 * 
 * @param {string} productId - Identificador a ser validado.
 * @returns {boolean} true se válido, false caso contrário.
 */
export function isValidProductId(productId) {
  if (!productId || typeof productId !== 'string') {
    return false;
  }
  return PRODUCT_PATTERNS.CANONICAL_ID.test(productId.trim());
}

/**
 * Extrai e normaliza o identificador canônico de um produto a partir de uma URL do Mercado Livre Brasil.
 * Suporta anúncios diretos (/MLB-...) e produtos de catálogo (/p/MLB...).
 * Ignora query strings (tracking, filtros) e fragmentos de hash (#wid, posições).
 * Não tenta adivinhar IDs a partir de parâmetros de busca ou metadados de vendedor.
 * 
 * @param {string|URL} url - URL do produto no Mercado Livre Brasil.
 * @returns {string|null} Identificador canônico (ex: 'MLB1234567890') ou null se não reconhecido.
 */
export function extractCanonicalProductId(url) {
  const parsed = parseMercadoLivreUrl(url);
  if (!parsed) {
    return null;
  }

  // 1. Se a URL for um redirecionamento ou anúncio patrocinado com URL interna encapsulada
  if (parsed.searchParams) {
    const targetUrlParam = parsed.searchParams.get('url') ||
      parsed.searchParams.get('item_url') ||
      parsed.searchParams.get('target_url') ||
      parsed.searchParams.get('mclics_url') ||
      parsed.searchParams.get('click_url');

    if (targetUrlParam) {
      try {
        const unescaped = decodeURIComponent(targetUrlParam);
        const innerId = extractCanonicalProductId(unescaped);
        if (innerId) {
          return innerId;
        }
      } catch {
        // Ignora e continua para os parâmetros do item / pathname
      }
    }

    // 2. Tentar encontrar identificador MLB explícito em query parameters (ex: item_id, wid, itemId, pdp_id)
    const itemParamKeys = ['item_id', 'wid', 'itemId', 'pdp_id', 'item', 'product_id'];
    for (const key of itemParamKeys) {
      const paramVal = parsed.searchParams.get(key);
      if (paramVal) {
        const normalized = normalizeProductId(paramVal);
        if (normalized) {
          return normalized;
        }
      }
    }
  }

  const pathname = parsed.pathname;

  // 3. Tentar correspondência com URL de catálogo (/p/MLB...)
  const catalogMatch = PRODUCT_PATTERNS.CATALOG_URL_PATH.exec(pathname);
  if (catalogMatch && catalogMatch[1]) {
    return normalizeProductId(catalogMatch[1]);
  }

  // 4. Tentar correspondência com URL de anúncio direto (/MLB-...)
  const standardMatch = PRODUCT_PATTERNS.STANDARD_URL_PATH.exec(pathname);
  if (standardMatch && standardMatch[1]) {
    return normalizeProductId(standardMatch[1]);
  }

  // 5. Correspondência robusta de qualquer segmento contendo MLB + dígitos no pathname
  const generalMatch = /(?:^|\/)(MLB-?\d{6,14})(?:[_\/-]|$)/i.exec(pathname);
  if (generalMatch && generalMatch[1]) {
    return normalizeProductId(generalMatch[1]);
  }

  return null;
}

/**
 * Extrai a identidade estruturada do produto (identificador canônico e tipo de URL).
 * 
 * @param {string|URL} url - URL do produto no Mercado Livre Brasil.
 * @returns {{ id: string, type: 'CATALOG'|'STANDARD' }|null} Identidade do produto ou null.
 */
export function extractProductIdentity(url) {
  const parsed = parseMercadoLivreUrl(url);
  if (!parsed) {
    return null;
  }

  // 1. Se a URL for um redirecionamento ou anúncio patrocinado com URL interna encapsulada
  if (parsed.searchParams) {
    const targetUrlParam = parsed.searchParams.get('url') ||
      parsed.searchParams.get('item_url') ||
      parsed.searchParams.get('target_url') ||
      parsed.searchParams.get('mclics_url') ||
      parsed.searchParams.get('click_url');

    if (targetUrlParam) {
      try {
        const unescaped = decodeURIComponent(targetUrlParam);
        const innerIdentity = extractProductIdentity(unescaped);
        if (innerIdentity) {
          return innerIdentity;
        }
      } catch {
        // Ignora e continua
      }
    }
  }

  const id = extractCanonicalProductId(parsed);
  if (!id) {
    return null;
  }

  const pathname = parsed.pathname;
  const isCatalog = PRODUCT_PATTERNS.CATALOG_URL_PATH.test(pathname) ||
    (PRODUCT_PATTERNS.UP_CATALOG_URL_PATH && PRODUCT_PATTERNS.UP_CATALOG_URL_PATH.test(pathname));

  return {
    id,
    type: isCatalog ? PRODUCT_ID_TYPES.CATALOG : PRODUCT_ID_TYPES.STANDARD,
  };
}

/**
 * Constrói uma URL canônica limpa para um identificador de produto do Mercado Livre Brasil.
 * 
 * @param {string} productId - Identificador bruto ou canônico do produto.
 * @param {'STANDARD'|'CATALOG'} [type=PRODUCT_ID_TYPES.STANDARD] - Tipo de produto.
 * @returns {string|null} URL canônica limpa ou null se o ID for inválido.
 */
export function buildCanonicalProductUrl(productId, type = PRODUCT_ID_TYPES.STANDARD) {
  const canonicalId = normalizeProductId(productId);
  if (!canonicalId) {
    return null;
  }

  if (type === PRODUCT_ID_TYPES.CATALOG) {
    return `${ML_BASE_URL}/p/${canonicalId}`;
  }

  const formattedStandardId = canonicalId.replace(/^MLB/, 'MLB-');
  return `${ML_BASE_URL}/${formattedStandardId}`;
}

/**
 * Classifica de forma determinística a página do Mercado Livre Brasil em um dos contextos:
 * - SEARCH_RESULTS: página de resultados de busca ou listagem de produtos.
 * - PRODUCT_DETAIL: página detalhada de produto (anúncio individual ou catálogo).
 * - UNSUPPORTED: página fora do escopo (externa, não-Brasil, home, carrinho, ajuda, etc.).
 * 
 * Utiliza estrutura de URL e evidências no DOM (se fornecido).
 * Não faz suposições heurísticas e não classifica páginas como PRODUCT_DETAIL
 * apenas por conter identificadores MLB em query parameters.
 * 
 * @param {string|URL} urlInput - URL ou rota a ser classificada.
 * @param {Element|Document|null} [rootElement=null] - Elemento raiz opcional para evidências DOM.
 * @returns {'SEARCH_RESULTS'|'PRODUCT_DETAIL'|'UNSUPPORTED'} Contexto detectado.
 */
export function classifyPageContext(urlInput, rootElement = null) {
  const parsed = parseMercadoLivreUrl(urlInput);
  if (!parsed) {
    return PAGE_CONTEXTS.UNSUPPORTED;
  }

  // 1. Verificação de Página de Detalhes de Produto (PRODUCT_DETAIL)
  // Baseada em identidade canônica de produto suportada (TASK-003)
  const canonicalId = extractCanonicalProductId(parsed);
  if (canonicalId) {
    return PAGE_CONTEXTS.PRODUCT_DETAIL;
  }

  // Verificação via evidência DOM de produto detalhado se o elemento raiz foi fornecido
  if (rootElement && typeof rootElement.querySelector === 'function') {
    const hasPdpDom = Boolean(
      rootElement.querySelector('#ui-pdp-main-container') ||
      rootElement.querySelector('.ui-pdp-container') ||
      rootElement.querySelector('.ui-pdp-header') ||
      rootElement.querySelector('h1.ui-pdp-title')
    );
    if (hasPdpDom) {
      return PAGE_CONTEXTS.PRODUCT_DETAIL;
    }
  }

  // 2. Verificação de Página de Resultados de Busca (SEARCH_RESULTS)
  // Verificação via evidência DOM de busca se o elemento raiz foi fornecido
  if (rootElement && typeof rootElement.querySelector === 'function') {
    const hasSearchDom = Boolean(
      rootElement.querySelector('.ui-search-results') ||
      rootElement.querySelector('.ui-search-layout') ||
      rootElement.querySelector('.poly-card') ||
      rootElement.querySelector('.ui-search-search-result__quantity-results')
    );
    if (hasSearchDom) {
      return PAGE_CONTEXTS.SEARCH_RESULTS;
    }
  }

  // Verificação via estrutura da URL
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;

  // Subdomínio de listagem (lista.mercadolivre.com.br)
  if (hostname === 'lista.mercadolivre.com.br' || hostname.startsWith('lista.')) {
    // Exige caminho não-vazio além da barra raiz ou query parameters
    if (pathname.length > 1 || parsed.search.length > 1) {
      return PAGE_CONTEXTS.SEARCH_RESULTS;
    }
  }

  // Rotas de busca / categorias em subdomínio principal (www.mercadolivre.com.br)
  const isSearchPath = /^\/(?:c|busca|search|jm\/search)(?:[_\/-]|$)/i.test(pathname);
  if (isSearchPath) {
    return PAGE_CONTEXTS.SEARCH_RESULTS;
  }

  // Parâmetros de consulta explícitos de busca
  if (parsed.searchParams) {
    const hasSearchQueryParam =
      parsed.searchParams.has('q') ||
      parsed.searchParams.has('as_word') ||
      parsed.searchParams.has('search_layout');

    if (hasSearchQueryParam) {
      return PAGE_CONTEXTS.SEARCH_RESULTS;
    }
  }

  // 3. URLs ambíguas ou não suportadas (home, ajuda, conta, etc.) sem evidência
  return PAGE_CONTEXTS.UNSUPPORTED;
}

/**
 * Converte strings com contagem de resultados (ex: "+9.999 resultados", "1.420 resultados", "Mais de 10 mil produtos")
 * em número inteiro positivo, suportando separadores de milhar com ponto e multiplicador "mil" (TASK-021).
 *
 * @param {string} text - Texto bruto observado no cabeçalho.
 * @returns {number|null} Quantidade numérica ou null se inválida.
 */
export function parseSearchResultCountText(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const clean = text.trim();
  const match = clean.match(/(?:mais\s+de\s+)?(?:\+\s*)?([\d.,]+)\s*(mil)?\s*(?:resultados?|produtos?)/i);
  if (!match) {
    return null;
  }

  let numStr = match[1].replace(/\./g, '').replace(',', '.');
  let count = parseFloat(numStr);
  if (isNaN(count) || count < 0) {
    return null;
  }

  if (match[2] && match[2].toLowerCase() === 'mil') {
    count = Math.round(count * 1000);
  } else {
    count = Math.round(count);
  }

  return count >= 0 ? count : null;
}

/**
 * Extrai determinísticamente a quantidade total de resultados a partir do cabeçalho da página de busca (TASK-014 / TASK-021).
 * Suporta formatos reais do Mercado Livre ("+9.999 resultados", "1.420 resultados", "500 produtos", "+10 mil resultados").
 * 
 * @param {Document|Element} documentRoot - Raiz do documento ou contêiner de busca.
 * @returns {number|null} Quantidade total de resultados observada ou null se indisponível.
 */
export function extractSearchResultCount(documentRoot) {
  if (!documentRoot || typeof documentRoot.querySelector !== 'function') {
    return null;
  }

  const candidateSelectors = [
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
  ];

  for (const sel of candidateSelectors) {
    try {
      const el = documentRoot.querySelector(sel);
      if (el) {
        const count = parseSearchResultCountText(el.textContent);
        if (count !== null) {
          return count;
        }
      }
    } catch {
      // Ignora e continua
    }
  }

  // Fallback em nós de cabeçalho / resumo
  try {
    const headerNodes = documentRoot.querySelectorAll('h1, h2, span, p, div.ui-search-head');
    for (const node of headerNodes) {
      const text = (node.textContent || '').trim();
      if (text.length < 120 && /(?:resultados?|produtos?)/i.test(text)) {
        const count = parseSearchResultCountText(text);
        if (count !== null) {
          return count;
        }
      }
    }
  } catch {
    // Ignora
  }

  return null;
}

// =============================================================================
// SEÇÃO: CÁLCULOS E INDICADORES DISPONIBILIDADE-CONSCIENTES (TASK-013)
// =============================================================================

/**
 * Classifica a oportunidade de mercado por semáforo com base no total de resultados da busca.
 * - GREEN: concorrência baixa / alta oportunidade (<= green_max)
 * - YELLOW: concorrência moderada (> green_max && <= yellow_max)
 * - RED: concorrência alta (> yellow_max)
 * - UNAVAILABLE: total de resultados nulo, indefinido, negativo ou não numérico.
 * 
 * @param {number|null|undefined} resultCount - Quantidade total de resultados observada na busca.
 * @param {object} [config=DEFAULT_CONFIG] - Configuração ativa do ProductRadar.
 * @returns {{ value: 'GREEN'|'YELLOW'|'RED'|null, source: string, status: string }}
 */
export function calculateTrafficLight(resultCount, config = DEFAULT_CONFIG) {
  if (
    resultCount === null ||
    resultCount === undefined ||
    typeof resultCount !== 'number' ||
    isNaN(resultCount) ||
    resultCount < 0
  ) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
      status: TRAFFIC_LIGHT_STATUS.UNAVAILABLE,
    };
  }

  const tlConfig = (config && config.trafficLight) || DEFAULT_CONFIG.trafficLight;
  const greenMax = typeof tlConfig.green_max === 'number' ? tlConfig.green_max : DEFAULT_CONFIG.trafficLight.green_max;
  const yellowMax = typeof tlConfig.yellow_max === 'number' ? tlConfig.yellow_max : DEFAULT_CONFIG.trafficLight.yellow_max;

  if (resultCount <= greenMax) {
    return {
      value: TRAFFIC_LIGHT_STATUS.GREEN,
      source: DATA_SOURCES.CALCULATED,
      status: TRAFFIC_LIGHT_STATUS.GREEN,
    };
  }

  if (resultCount <= yellowMax) {
    return {
      value: TRAFFIC_LIGHT_STATUS.YELLOW,
      source: DATA_SOURCES.CALCULATED,
      status: TRAFFIC_LIGHT_STATUS.YELLOW,
    };
  }

  return {
    value: TRAFFIC_LIGHT_STATUS.RED,
    source: DATA_SOURCES.CALCULATED,
    status: TRAFFIC_LIGHT_STATUS.RED,
  };
}

/**
 * Calcula a estimativa de imposto sobre o preço do produto utilizando a alíquota configurada.
 * Parâmetro de simulação do usuário (CALCULATED), NÃO observado do Mercado Livre.
 * 
 * @param {number|null|undefined} price - Preço bruto do produto (BRL).
 * @param {number|null|undefined} [taxRate=DEFAULT_CONFIG.taxRate] - Alíquota de imposto configurada (%).
 * @returns {{ value: number|null, source: string }}
 */
export function calculateEstimatedTax(price, taxRate = DEFAULT_CONFIG.taxRate) {
  if (
    price === null ||
    price === undefined ||
    typeof price !== 'number' ||
    isNaN(price) ||
    price < 0 ||
    taxRate === null ||
    taxRate === undefined ||
    typeof taxRate !== 'number' ||
    isNaN(taxRate) ||
    taxRate < 0
  ) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const tax = (price * taxRate) / 100;
  return {
    value: tax,
    source: DATA_SOURCES.CALCULATED,
  };
}

/**
 * Calcula o valor líquido a receber pelo vendedor:
 * Fórmula: preço - comissão ML - imposto estimado - frete
 * IMPORTANTE: O valor a receber NÃO representa lucro líquido, pois custos de fornecedor
 * e aquisição de estoque não estão disponíveis.
 * 
 * @param {object} params - Parâmetros monetários de entrada.
 * @param {number} params.price - Preço de venda atual do produto.
 * @param {number} params.commission - Comissão/taxa retida pelo Mercado Livre.
 * @param {number} params.tax - Imposto estimado calculado.
 * @param {number} params.freight - Custo de frete/envio arcado pelo vendedor.
 * @returns {{ value: number|null, source: string }}
 */
export function calculateReceiveNet(params) {
  if (!params || typeof params !== 'object') {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const { price, commission, tax, freight } = params;

  const isValidNumber = (val) => typeof val === 'number' && !isNaN(val) && val >= 0;

  if (!isValidNumber(price) || !isValidNumber(commission) || !isValidNumber(tax) || !isValidNumber(freight)) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const receiveNet = price - commission - tax - freight;
  return {
    value: receiveNet,
    source: DATA_SOURCES.CALCULATED,
  };
}

/**
 * Calcula a margem líquida percentual ou retorna UNAVAILABLE se o custo de fornecedor estiver ausente.
 * 
 * @param {number|null|undefined} receiveNet - Valor líquido a receber.
 * @param {number|null|undefined} supplierCost - Custo unitário de aquisição junto ao fornecedor.
 * @param {number|null|undefined} price - Preço bruto de venda do produto.
 * @returns {{ value: number|null, source: string }}
 */
export function calculateNetMargin(receiveNet, supplierCost, price) {
  const isValidNumber = (val) => typeof val === 'number' && !isNaN(val) && val >= 0;

  if (!isValidNumber(receiveNet) || !isValidNumber(supplierCost) || !isValidNumber(price) || price === 0) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const profit = receiveNet - supplierCost;
  const marginPercent = (profit / price) * 100;

  return {
    value: marginPercent,
    source: DATA_SOURCES.CALCULATED,
  };
}

/**
 * Calcula a taxa de conversão observada: (vendas / visitas) * 100.
 * Retorna UNAVAILABLE se visitas for ausente, zero ou inválido.
 * 
 * @param {number|null|undefined} sales - Quantidade de vendas legítimas observadas.
 * @param {number|null|undefined} visits - Quantidade de visitas legítimas observadas.
 * @returns {{ value: number|null, source: string }}
 */
export function calculateConversionRate(sales, visits) {
  if (
    sales === null ||
    sales === undefined ||
    typeof sales !== 'number' ||
    isNaN(sales) ||
    sales < 0 ||
    visits === null ||
    visits === undefined ||
    typeof visits !== 'number' ||
    isNaN(visits) ||
    visits <= 0
  ) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const rate = (sales / visits) * 100;
  return {
    value: rate,
    source: DATA_SOURCES.CALCULATED,
  };
}

/**
 * Calcula a estimativa de vendas por dia (soldQuantity / dias decorridos).
 * Requer soldQuantity e uma data legítima de criação do anúncio.
 * Marcado explicitamente como ESTIMATED.
 * 
 * @param {number|null|undefined} soldQuantity - Quantidade vendida observada.
 * @param {Date|string|number|null|undefined} creationDate - Data de criação do anúncio.
 * @param {Date} [currentDate=new Date()] - Data atual de referência para cálculo de dias decorridos.
 * @returns {{ value: number|null, source: string }}
 */
export function calculateSalesPerDay(soldQuantity, creationDate, currentDate = new Date()) {
  if (
    soldQuantity === null ||
    soldQuantity === undefined ||
    typeof soldQuantity !== 'number' ||
    isNaN(soldQuantity) ||
    soldQuantity < 0 ||
    !creationDate
  ) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const created = creationDate instanceof Date ? creationDate : new Date(creationDate);
  const now = currentDate instanceof Date ? currentDate : new Date(currentDate);

  if (isNaN(created.getTime()) || isNaN(now.getTime()) || created.getTime() > now.getTime()) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  const diffMs = now.getTime() - created.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // Evita divisão por zero para anúncios criados no mesmo dia (mínimo de 1 dia para base de taxa)
  const elapsedDays = Math.max(1, diffDays);

  const salesPerDay = soldQuantity / elapsedDays;

  return {
    value: salesPerDay,
    source: DATA_SOURCES.ESTIMATED,
  };
}

/**
 * Retorna o rótulo textual legível em português correspondente à classificação de origem do dado (TASK-020).
 *
 * @param {string} source - Chave de origem de DATA_SOURCES.
 * @returns {string} Rótulo descritivo em português.
 */
export function getDataSourceLabel(source) {
  if (DATA_SOURCE_LABELS[source]) {
    return DATA_SOURCE_LABELS[source];
  }
  return DATA_SOURCE_LABELS.UNAVAILABLE;
}

/**
 * Converte e normaliza com segurança valores monetários inseridos pelo usuário (BRL)
 * em um número decimal float em reais com 2 casas decimais (TASK-029).
 * Suporta formatos numéricos e strings: '30', '30,00', 'R$ 30,00', '1.250,50', '0', '0,00'.
 * Rejeita valores negativos, vazios, não numéricos ou não finitos.
 *
 * @param {string|number|null|undefined} input - Valor de entrada fornecido pelo usuário.
 * @returns {number|null} Valor numérico normalizado ou null se inválido/vazio.
 */
export function parseMonetaryInput(input) {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === 'number') {
    if (isNaN(input) || !isFinite(input) || input < 0) {
      return null;
    }
    return Number(input.toFixed(2));
  }

  if (typeof input !== 'string') {
    return null;
  }

  const clean = input.trim();
  if (!clean) {
    return null;
  }

  // Remove prefixo de moeda R$ ou $
  const stripped = clean.replace(/^(?:R\$\s*|\$\s*)/i, '').trim();
  if (!stripped) {
    return null;
  }

  // Permite apenas dígitos, pontos e vírgulas
  if (!/^[\d.,]+$/.test(stripped)) {
    return null;
  }

  let numStr = stripped;
  if (numStr.includes(',')) {
    numStr = numStr.replace(/\./g, '').replace(',', '.');
  } else if (numStr.includes('.')) {
    const parts = numStr.split('.');
    if (parts.length > 2) {
      numStr = numStr.replace(/\./g, '');
    }
  }

  const val = parseFloat(numStr);
  if (isNaN(val) || !isFinite(val) || val < 0) {
    return null;
  }

  return Number(val.toFixed(2));
}

/**
 * Calcula a quantidade de dias decorridos desde a data de criação até a data de referência (TASK-030).
 * Retorna número inteiro de dias (>= 0) ou null se data inválida/futura/ausente.
 *
 * @param {Date|string|number|null|undefined} creationDate - Data de criação do anúncio.
 * @param {Date} [currentDate=new Date()] - Data de referência.
 * @returns {number|null} Dias decorridos ou null.
 */
export function calculateElapsedDays(creationDate, currentDate = new Date()) {
  if (!creationDate) return null;
  const created = creationDate instanceof Date ? creationDate : new Date(creationDate);
  const now = currentDate instanceof Date ? currentDate : new Date(currentDate);

  if (isNaN(created.getTime()) || isNaN(now.getTime()) || created.getTime() > now.getTime()) {
    return null;
  }

  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Calcula o faturamento estimado bruto (vendas declaradas × preço unitário atual) (TASK-030).
 * Não representa lucro líquido.
 *
 * @param {number|null|undefined} soldQuantity - Quantidade vendida observada.
 * @param {number|null|undefined} price - Preço unitário atual.
 * @returns {{ value: number|null, source: string }}
 */
export function calculateRevenue(soldQuantity, price) {
  if (
    soldQuantity === null ||
    soldQuantity === undefined ||
    typeof soldQuantity !== 'number' ||
    isNaN(soldQuantity) ||
    soldQuantity < 0 ||
    price === null ||
    price === undefined ||
    typeof price !== 'number' ||
    isNaN(price) ||
    price < 0
  ) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  return {
    value: soldQuantity * price,
    source: DATA_SOURCES.CALCULATED,
  };
}

/**
 * Calcula a velocidade mensal estimada de vendas (vendas por dia × 30) (TASK-030).
 *
 * @param {number|null|undefined} salesPerDay - Vendas por dia estimadas.
 * @returns {{ value: number|null, source: string }}
 */
export function calculateMonthlyVelocity(salesPerDay) {
  if (
    salesPerDay === null ||
    salesPerDay === undefined ||
    typeof salesPerDay !== 'number' ||
    isNaN(salesPerDay) ||
    salesPerDay < 0
  ) {
    return {
      value: null,
      source: DATA_SOURCES.UNAVAILABLE,
    };
  }

  return {
    value: salesPerDay * 30,
    source: DATA_SOURCES.ESTIMATED,
  };
}

/**
 * Formata uma data no formato brasileiro DD/MM/AAAA (TASK-030).
 *
 * @param {Date|string|null|undefined} dateInput - Data em ISO ou Date.
 * @returns {string|null} String formatada ou null.
 */
export function formatDateBR(dateInput) {
  if (!dateInput) return null;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return null;

  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Normaliza o tipo de anúncio do Mercado Livre para um rótulo legível em português (TASK-043).
 *
 * @param {string|null|undefined} rawType - Identificador bruto do tipo de anúncio (ex: "gold_special", "gold_pro", "free").
 * @returns {string|null} Rótulo formatado em português ou null se não reconhecido.
 */
export function formatListingType(rawType) {
  if (!rawType || typeof rawType !== 'string') return null;
  const key = rawType.trim().toLowerCase();
  if (ML_LISTING_TYPES[key]) {
    return ML_LISTING_TYPES[key];
  }
  if (key.includes('special') || key.includes('classico') || key.includes('clássico')) {
    return 'Clássico';
  }
  if (key.includes('pro') || key.includes('premium')) {
    return 'Premium';
  }
  if (key.includes('free') || key.includes('gratis') || key.includes('grátis')) {
    return 'Grátis';
  }
  return rawType;
}

/**
 * Calcula o custo total de venda do Mercado Livre e o valor líquido a receber (TASK-043).
 * Retorna { value, source } com o valor calculado se os dados de entrada forem suficientes,
 * ou { value: null, source: DATA_SOURCES.UNAVAILABLE } caso contrário.
 *
 * @param {object} params
 * @param {number|null} params.price - Preço de venda do produto.
 * @param {number|null} params.commission - Valor em R$ da comissão observada (se disponível).
 * @param {number|null} [params.fixedFee=0] - Tarifa fixa observada (se disponível).
 * @returns {{ sellingCost: { value: number|null, source: string }, netAmount: { value: number|null, source: string } }}
 */
export function calculateSellingCosts({ price, commission, fixedFee = 0, freightCost = 0 }) {
  if (
    typeof price !== 'number' || isNaN(price) || price <= 0 ||
    typeof commission !== 'number' || isNaN(commission) || commission < 0
  ) {
    return {
      sellingCost: { value: null, source: DATA_SOURCES.UNAVAILABLE },
      netAmount: { value: null, source: DATA_SOURCES.UNAVAILABLE },
    };
  }

  const fee = typeof fixedFee === 'number' && !isNaN(fixedFee) && fixedFee >= 0 ? fixedFee : 0;
  const freight = typeof freightCost === 'number' && !isNaN(freightCost) && freightCost >= 0 ? freightCost : 0;
  const totalCost = commission + fee + freight;
  const net = price - totalCost;

  return {
    sellingCost: {
      value: totalCost,
      source: DATA_SOURCES.CALCULATED,
    },
    netAmount: {
      value: Math.max(0, net),
      source: DATA_SOURCES.CALCULATED,
    },
  };
}
