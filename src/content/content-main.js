/**
 * ProductRadar - Content Script Orchestrator, Search & Product Detail UI
 * Orquestração dos fluxos de extração/persistência e renderização de overlays (TASK-009 / TASK-010 / TASK-014 / TASK-016)
 */

import {
  classifyPageContext,
  PAGE_CONTEXTS,
  calculateTrafficLight,
  extractSearchResultCount,
  calculateEstimatedTax,
  calculateSalesPerDay,
  calculateRevenue,
  calculateMonthlyVelocity,
  calculateElapsedDays,
  calculateConversionRate,
  calculateReceiveNet,
  formatDateBR,
  extractCanonicalProductId,
  parseMonetaryInput,
} from '../shared/utils.js';
import { extractSearchPageData } from './extractors/search-extractor.js';
import { extractProductPageData } from './extractors/product-extractor.js';
import {
  saveMultipleProductSearchContexts,
  getProductSearchContext,
  saveProductSupplierCost,
  getProductSupplierCost,
  getConfig,
} from '../shared/storage.js';
import {
  DEFAULT_CONFIG,
  TRAFFIC_LIGHT_STATUS,
} from '../shared/constants.js';

// Rastreamento em memória de IDs de produtos processados para evitar gravações repetidas
// desnecessárias no mesmo ciclo de vida estático do DOM
const processedProductIds = new Set();

// Referências de controle para observação de mutações do DOM e temporizadores (TASK-024)
let activeObserver = null;
let activeDebounceTimer = null;
let activeMaxTimeout = null;

/**
 * Renderiza ou atualiza o painel overlay isolado do ProductRadar na página de busca.
 * Não altera e não injeta elementos dentro dos cards nativos do Mercado Livre.
 * 
 * @param {Document|Element} documentRoot - Raiz do documento ou contêiner.
 * @param {object} params - Parâmetros de renderização.
 * @param {object[]} params.extractedCards - Lista de cards de busca extraídos.
 * @param {number|null} params.resultCount - Quantidade total de resultados observada.
 * @param {object} params.config - Configuração ativa do ProductRadar.
 * @returns {HTMLElement|null} Elemento do overlay renderizado.
 */
export function renderSearchOverlay(documentRoot, { extractedCards = [], resultCount = null, config = DEFAULT_CONFIG }) {
  if (!documentRoot) return null;

  const doc = documentRoot.ownerDocument || (documentRoot.nodeType === 9 ? documentRoot : document);
  if (!doc || !doc.body) return null;

  const OVERLAY_ID = 'productradar-search-overlay';
  let overlayEl = doc.getElementById(OVERLAY_ID);

  if (!overlayEl) {
    overlayEl = doc.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.setAttribute('data-productradar-root', 'search-overlay');
    doc.body.appendChild(overlayEl);
  }

  const searchVis = (config && config.visibility && config.visibility.search) || DEFAULT_CONFIG.visibility.search;
  const tlConfig = (config && config.trafficLight) || DEFAULT_CONFIG.trafficLight;
  const greenMax = tlConfig.green_max || 100;
  const yellowMax = tlConfig.yellow_max || 500;

  // 1. Semáforo
  const tl = calculateTrafficLight(resultCount, config);
  let tlBadgeHtml = '';
  let tlColor = '#6b7280';
  let tlText = 'Total de resultados não observado';

  if (tl.status === TRAFFIC_LIGHT_STATUS.GREEN) {
    tlColor = '#059669';
    tlText = 'Baixo Volume de Resultados';
  } else if (tl.status === TRAFFIC_LIGHT_STATUS.YELLOW) {
    tlColor = '#d97706';
    tlText = 'Volume Moderado de Resultados';
  } else if (tl.status === TRAFFIC_LIGHT_STATUS.RED) {
    tlColor = '#dc2626';
    tlText = 'Alto Volume de Resultados';
  }

  if (searchVis.trafficLight) {
    tlBadgeHtml = `
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px;">Semáforo de Resultados</span>
          <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: ${tlColor}; background: #fff; padding: 2px 8px; border-radius: 9999px; border: 1px solid ${tlColor};">
            ● ${tl.value ? tl.value : 'INDISPONÍVEL'} [CALCULADO]
          </span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #111827; margin-bottom: 4px;">
          ${tlText}
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">
          ${resultCount !== null ? `Total observado: <strong>${resultCount.toLocaleString('pt-BR')}</strong> resultados` : 'Total de resultados da busca não disponível nesta página.'}
        </div>
        <div style="font-size: 11px; color: #6b7280; line-height: 1.4; border-top: 1px dashed #e5e7eb; padding-top: 6px;">
          ℹ️ <em>O semáforo reflete exclusivamente o volume de resultados frente aos limites configurados (Verde: até ${greenMax}, Amarelo: até ${yellowMax}, Vermelho: acima de ${yellowMax}). NÃO representa qualidade do produto nem lucratividade.</em>
        </div>
      </div>
    `;
  }

  // 2. Indicadores de Busca com Indisponibilidade Explícita ou Dados Observados (TASK-018 / TASK-020)
  let indicatorsHtml = '';
  const indicatorRows = [];

  if (searchVis.sales) {
    const cardsWithSales = extractedCards.filter((c) => c && typeof c.soldQuantity === 'number');
    let salesText = '<span style="color: #9ca3af; font-style: italic;">Indisponível na busca</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span>';
    if (cardsWithSales.length > 0) {
      const totalObservedSales = cardsWithSales.reduce((acc, c) => acc + c.soldQuantity, 0);
      salesText = `<strong style="color: #111827;">+${totalObservedSales.toLocaleString('pt-BR')} vendidos</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO EM ${cardsWithSales.length} ITENS]</span>`;
    }
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Vendas observadas:</span>
        <div>${salesText}</div>
      </div>
    `);
  }

  if (searchVis.revenue) {
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Faturamento:</span>
        <div><span style="color: #9ca3af; font-style: italic;">Indisponível na busca</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span></div>
      </div>
    `);
  }

  if (searchVis.stock) {
    const cardsWithStock = extractedCards.filter((c) => c && typeof c.availableStock === 'number');
    let stockText = '<span style="color: #9ca3af; font-style: italic;">Indisponível na busca</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span>';
    if (cardsWithStock.length > 0) {
      const totalObservedStock = cardsWithStock.reduce((acc, c) => acc + c.availableStock, 0);
      stockText = `<strong style="color: #111827;">${totalObservedStock.toLocaleString('pt-BR')} unidades</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO EM ${cardsWithStock.length} ITENS]</span>`;
    }
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Estoque observado:</span>
        <div>${stockText}</div>
      </div>
    `);
  }

  if (indicatorRows.length > 0) {
    indicatorsHtml = `
      <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; margin-bottom: 6px;">Indicadores de Busca</div>
        ${indicatorRows.join('')}
        <div style="font-size: 10px; color: #6b7280; line-height: 1.35; margin-top: 6px; border-top: 1px dashed #e5e7eb; padding-top: 6px;">
          ℹ️ <em>Valores [OBSERVADO] vêm diretamente da listagem do Mercado Livre. Métricas ausentes são explicitamente marcadas como [INDISPONÍVEL].</em>
        </div>
      </div>
    `;
  }

  // 3. Resumo compacto de produtos detectados
  let productsListHtml = '';
  if (Array.isArray(extractedCards) && extractedCards.length > 0) {
    const items = extractedCards.slice(0, 5).map((card) => {
      const priceText = card.price && card.price.current !== null
        ? `R$ ${card.price.current.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : 'Preço sob consulta';
      const cleanUrl = card.url || '#';
      const title = card.title || 'Produto sem título';

      let extraBadges = [];
      if (typeof card.soldQuantity === 'number') {
        extraBadges.push(`<span style="font-size: 10px; background: #ecfdf5; color: #065f46; padding: 1px 4px; border-radius: 4px;">+${card.soldQuantity} vend.</span>`);
      }
      if (typeof card.availableStock === 'number') {
        extraBadges.push(`<span style="font-size: 10px; background: #eff6ff; color: #1e40af; padding: 1px 4px; border-radius: 4px;">${card.availableStock} disp.</span>`);
      }
      const badgesHtml = extraBadges.length > 0 ? `<div style="display: flex; gap: 4px; margin-top: 2px;">${extraBadges.join('')}</div>` : '';

      return `
        <div style="padding: 6px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px;">
          <div style="font-weight: 600; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${title}">
            ${title}
          </div>
          ${badgesHtml}
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
            <span style="color: #059669; font-weight: 700;">${priceText}</span>
            <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none; font-size: 11px; font-weight: 600;">
              Abrir produto ↗
            </a>
          </div>
        </div>
      `;
    }).join('');

    productsListHtml = `
      <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;">Produtos Capturados</span>
          <span style="font-size: 11px; color: #6b7280; font-weight: 600;">${extractedCards.length} itens</span>
        </div>
        <div style="max-height: 160px; overflow-y: auto;">
          ${items}
        </div>
      </div>
    `;
  }

  overlayEl.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      max-width: calc(100vw - 40px);
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      z-index: 999999;
      overflow: hidden;
      line-height: 1.3;
    ">
      <!-- Cabeçalho -->
      <div style="background: #2563eb; color: #ffffff; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 14px;">📡</span>
          <strong style="font-size: 13px; font-weight: 700; letter-spacing: 0.3px;">ProductRadar</strong>
          <span style="font-size: 10px; background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 4px;">Busca</span>
        </div>
        <button id="productradar-toggle-btn" style="background: none; border: none; color: #fff; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px;" title="Minimizar/Expandir">
          _
        </button>
      </div>

      <!-- Conteúdo do Painel -->
      <div id="productradar-content-panel" style="padding: 12px; max-height: 480px; overflow-y: auto;">
        ${tlBadgeHtml}
        ${indicatorsHtml}
        ${productsListHtml}
      </div>
    </div>
  `;

  // Toggle minimize/expand
  const toggleBtn = overlayEl.querySelector('#productradar-toggle-btn');
  const contentPanel = overlayEl.querySelector('#productradar-content-panel');
  if (toggleBtn && contentPanel) {
    toggleBtn.onclick = () => {
      if (contentPanel.style.display === 'none') {
        contentPanel.style.display = 'block';
        toggleBtn.innerText = '_';
      } else {
        contentPanel.style.display = 'none';
        toggleBtn.innerText = '□';
      }
    };
  }

  return overlayEl;
}

/**
 * Utilitário interno para renderização do ícone de informação ℹ️ com suporte a tooltip por hover/tap (TASK-031).
 *
 * @param {string} text - Texto explicativo do tooltip.
 * @returns {string} HTML do elemento de ícone com atributos de tooltip.
 */
function renderInfoIcon(text) {
  if (!text) return '';
  const escapedText = String(text).replace(/"/g, '&quot;');
  return `<span class="productradar-info-icon" data-tooltip="${escapedText}" title="${escapedText}" style="cursor: help; margin-left: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; user-select: none;">ℹ️</span>`;
}

/**
 * Renderiza ou atualiza o painel overlay isolado do ProductRadar na página de detalhes de produto (PDP) (TASK-016 / TASK-020).
 * Combina os dados frescos da página com o contexto previamente capturado na busca, mantendo-os explicitamente separados.
 * 
 * @param {Document|Element} documentRoot - Raiz do documento ou contêiner.
 * @param {object} params - Parâmetros de renderização do produto.
 * @param {object|null} params.productData - Dados extraídos da página de produto (TASK-007).
 * @param {object|null} params.searchContext - Dados de busca previamente capturados (TASK-006 / TASK-008).
 * @param {object} params.config - Configuração ativa do ProductRadar.
 * @returns {HTMLElement|null} Elemento do overlay de produto renderizado.
 */
export function renderProductOverlay(documentRoot, { productData = null, searchContext = null, config = DEFAULT_CONFIG, supplierCost = null }) {
  if (!documentRoot) return null;

  const doc = documentRoot.ownerDocument || (documentRoot.nodeType === 9 ? documentRoot : document);
  if (!doc || !doc.body) return null;

  const OVERLAY_ID = 'productradar-pdp-overlay';
  let overlayEl = doc.getElementById(OVERLAY_ID);

  if (!overlayEl) {
    overlayEl = doc.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.setAttribute('data-productradar-root', 'pdp-overlay');
    doc.body.appendChild(overlayEl);
  }

  const prodVis = (config && config.visibility && config.visibility.product) || DEFAULT_CONFIG.visibility.product;
  const taxRate = typeof config.taxRate === 'number' ? config.taxRate : DEFAULT_CONFIG.taxRate;

  // Fallback padrão exato para valores não disponíveis (TASK-030)
  const notFoundHtml = '<span style="color: #9ca3af; font-style: italic;">Não encontrado</span>';

  // 1. Dados Observados na Página (PDP Overview)
  const pdpTitle = productData && productData.title ? productData.title : 'Produto sem título identificado';
  const pdpPrice = productData && productData.price && productData.price.current !== null
    ? `R$ ${productData.price.current.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : null;
  const pdpPriceDisplay = pdpPrice
    ? `<strong style="color: #059669;">${pdpPrice}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`
    : notFoundHtml;

  // Frete
  let shippingDisplay = notFoundHtml;
  if (productData && productData.shipping) {
    if (productData.shipping.isFree && productData.shipping.isFull) {
      shippingDisplay = '<strong style="color: #111827;">Frete Grátis (Full)</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>';
    } else if (productData.shipping.isFree) {
      shippingDisplay = '<strong style="color: #111827;">Frete Grátis</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>';
    } else if (productData.shipping.isFull) {
      shippingDisplay = '<strong style="color: #111827;">Envio Full</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>';
    } else {
      shippingDisplay = '<strong style="color: #111827;">Padrão</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>';
    }
  }

  // Catálogo
  let catalogDisplay = notFoundHtml;
  if (productData) {
    if (productData.isCatalog) {
      catalogDisplay = '<strong style="color: #111827;">Sim (Anúncio de Catálogo)</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>';
    } else {
      catalogDisplay = '<strong style="color: #111827;">Não (Anúncio Padrão)</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>';
    }
  }

  // Vendas declaradas
  let salesDeclaredDisplay = notFoundHtml;
  if (productData && typeof productData.soldQuantity === 'number') {
    salesDeclaredDisplay = `<strong style="color: #111827;">+${productData.soldQuantity.toLocaleString('pt-BR')} vendidos</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
  }

  // Estoque
  let stockDisplay = notFoundHtml;
  if (productData && typeof productData.availableStock === 'number') {
    stockDisplay = `<strong style="color: #111827;">${productData.availableStock} unidades</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
  }

  // Anúncio criado em & Criado há
  let creationDateDisplay = notFoundHtml;
  let createdAgoDisplay = notFoundHtml;
  const creationDate = productData && productData.creationDate ? productData.creationDate : null;
  if (creationDate) {
    const formattedDate = formatDateBR(creationDate);
    if (formattedDate) {
      creationDateDisplay = `<strong style="color: #111827;">${formattedDate}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
    }
    const elapsedDays = calculateElapsedDays(creationDate);
    if (elapsedDays !== null) {
      createdAgoDisplay = `<strong style="color: #111827;">${elapsedDays} dias</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[CALCULADO]</span>`;
    }
  }

  // Bloco de Informações do Anúncio (Overview - TASK-031 Collapsible)
  const pdpDetailsHtml = `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="productradar-section-toggle-btn" data-target="productradar-section-pdp-details" style="background: none; border: 1px solid #cbd5e1; border-radius: 4px; color: #475569; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
          <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;">Dados Observados na Página</span>
        </div>
        <span style="font-size: 10px; background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px; font-weight: 700;">[OBSERVADO NO ANÚNCIO]</span>
      </div>
      <div id="productradar-section-pdp-details">
        <div style="font-size: 12px; font-weight: 600; color: #111827; margin-bottom: 8px; line-height: 1.3;" title="${pdpTitle}">
          ${pdpTitle}
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding: 2px 0;">
            <span style="color: #6b7280;">Preço PDP:</span> <div>${pdpPriceDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding: 2px 0;">
            <span style="color: #6b7280;">Frete:</span> <div>${shippingDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding: 2px 0;">
            <span style="color: #6b7280;">Catálogo:</span> <div>${catalogDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding: 2px 0;">
            <span style="color: #6b7280;">Estoque:</span> <div>${stockDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding: 2px 0;">
            <span style="color: #6b7280;">Vendas declaradas:</span> <div>${salesDeclaredDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding: 2px 0;">
            <span style="color: #6b7280;">Anúncio criado em:</span> <div>${creationDateDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0;">
            <span style="color: #6b7280;">Criado há:</span> <div>${createdAgoDisplay}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 2. Informações do Vendedor (TASK-030 / TASK-031 / TASK-033)
  let sellerNameDisplay = notFoundHtml;
  let sellerSalesDisplay = notFoundHtml;
  let sellerReputationDisplay = notFoundHtml;
  let sellerLocationDisplay = notFoundHtml;

  if (productData && productData.seller) {
    if (productData.seller.name) {
      sellerNameDisplay = `<strong style="color: #111827;">${productData.seller.name}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
    }
    if (productData.seller.sales) {
      sellerSalesDisplay = `<strong style="color: #111827;">${productData.seller.sales}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
    }
    if (productData.seller.reputation || productData.seller.powerSellerStatus) {
      const repText = productData.seller.reputation || (productData.seller.powerSellerStatus === 'platinum' ? 'MercadoLíder Platinum' : productData.seller.powerSellerStatus);
      sellerReputationDisplay = `<strong style="color: #111827;">${repText}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
    }
    if (productData.seller.location) {
      sellerLocationDisplay = `<strong style="color: #111827;">${productData.seller.location}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
    }
  }

  const sellerDetailsHtml = `
    <div style="background: #fdf4ff; border: 1px solid #f5d0fe; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="productradar-section-toggle-btn" data-target="productradar-section-seller-details" style="background: none; border: 1px solid #f0abfc; border-radius: 4px; color: #86198f; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
          <span style="font-size: 11px; font-weight: 700; color: #86198f; text-transform: uppercase;">Informações do Vendedor</span>
        </div>
        <span style="font-size: 10px; background: #fae8ff; color: #a21caf; padding: 1px 6px; border-radius: 4px; font-weight: 700;">[OBSERVADO]</span>
      </div>
      <div id="productradar-section-seller-details">
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #fdf2f8; padding: 2px 0;">
            <span style="color: #6b7280;">Vendedor:</span> <div>${sellerNameDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #fdf2f8; padding: 2px 0;">
            <span style="color: #6b7280;">Vendas do vendedor:</span> <div>${sellerSalesDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #fdf2f8; padding: 2px 0;">
            <span style="color: #6b7280;">Reputação do vendedor:</span> <div>${sellerReputationDisplay}</div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 2px 0;">
            <span style="color: #6b7280;">Localização do vendedor:</span> <div>${sellerLocationDisplay}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 3. Custo do Fornecedor (Entrada manual do Usuário / TASK-029 / TASK-031 Collapsible & Tooltip)
  const canonicalId = (productData && productData.id) || null;
  const initialCostValue = (typeof supplierCost === 'number' && supplierCost >= 0)
    ? supplierCost.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';

  let supplierCostHtml = '';
  if (canonicalId) {
    supplierCostHtml = `
      <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="productradar-section-toggle-btn" data-target="productradar-section-supplier-cost" style="background: none; border: 1px solid #fcd34d; border-radius: 4px; color: #92400e; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
            <span style="font-size: 11px; font-weight: 700; color: #92400e; text-transform: uppercase;">Custo do Fornecedor</span>
            ${renderInfoIcon('Valor informado manualmente pelo usuário para cálculo de rentabilidade. Não é extraído do Mercado Livre.')}
          </div>
          <span style="font-size: 10px; background: #fef3c7; color: #b45309; padding: 1px 6px; border-radius: 4px; font-weight: 700;">[INFORMADO PELO USUÁRIO]</span>
        </div>
        <div id="productradar-section-supplier-cost">
          <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 4px;">
            <span style="font-size: 11px; color: #4b5563; font-weight: 600;">R$</span>
            <input
              id="productradar-supplier-cost-input"
              type="text"
              value="${initialCostValue}"
              placeholder="0,00"
              data-product-id="${canonicalId}"
              style="flex: 1; padding: 4px 8px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 4px; outline: none; background: #ffffff;"
            />
            <button
              id="productradar-supplier-cost-save-btn"
              style="background: #d97706; color: #ffffff; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;"
            >
              Salvar
            </button>
          </div>
          <div id="productradar-supplier-cost-feedback" style="font-size: 10px; min-height: 14px; margin-top: 2px;"></div>
        </div>
      </div>
    `;
  } else {
    supplierCostHtml = `
      <div style="background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px; color: #6b7280;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="productradar-section-toggle-btn" data-target="productradar-section-supplier-cost-null" style="background: none; border: 1px solid #cbd5e1; border-radius: 4px; color: #475569; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
            <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;">Custo do Fornecedor</span>
            ${renderInfoIcon('ID do produto não identificado. Custo do fornecedor indisponível.')}
          </div>
          <span style="font-size: 10px; background: #f3f4f6; color: #6b7280; padding: 1px 4px; border-radius: 4px; font-weight: 700;">Não encontrado</span>
        </div>
        <div id="productradar-section-supplier-cost-null">
          <em>ID do produto não identificado. Custo do fornecedor indisponível.</em>
        </div>
      </div>
    `;
  }

  // 4. Contexto Herdado da Busca (Search Context / TASK-031 Collapsible)
  let searchContextHtml = '';
  if (searchContext) {
    const sPrice = searchContext.price && searchContext.price.current !== null
      ? `R$ ${searchContext.price.current.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : 'Não informado';
    const sRating = searchContext.rating && searchContext.rating.score !== null
      ? `★ ${searchContext.rating.score} (${searchContext.rating.reviewsCount || 0})`
      : 'Sem avaliações';
    const sSponsored = searchContext.isSponsored ? 'Sim (Patrocinado)' : 'Não (Orgânico)';
    const sDiscount = searchContext.price && searchContext.price.discountPercent
      ? `${searchContext.price.discountPercent}% OFF`
      : '';

    searchContextHtml = `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="productradar-section-toggle-btn" data-target="productradar-section-search-context" style="background: none; border: 1px solid #86efac; border-radius: 4px; color: #166534; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
            <span style="font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase;">Contexto da Busca Anterior</span>
          </div>
          <span style="font-size: 10px; background: #dcfce7; color: #15803d; padding: 1px 6px; border-radius: 4px; font-weight: 700;">[OBSERVADO NA BUSCA]</span>
        </div>
        <div id="productradar-section-search-context">
          <div style="font-size: 11px; color: #166534; margin-bottom: 4px;">
            Preço na busca: <strong>${sPrice}</strong> ${sDiscount ? `<span style="color: #15803d; font-weight: 700;">(${sDiscount})</span>` : ''}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; color: #374151;">
            <div><span style="color: #6b7280;">Avaliação:</span> <strong>${sRating}</strong></div>
            <div><span style="color: #6b7280;">Patrocinado:</span> <strong>${sSponsored}</strong></div>
          </div>
        </div>
      </div>
    `;
  } else {
    searchContextHtml = `
      <div style="background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px; color: #6b7280;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="productradar-section-toggle-btn" data-target="productradar-section-search-context-null" style="background: none; border: 1px solid #cbd5e1; border-radius: 4px; color: #475569; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
            <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;">Contexto da Busca Anterior</span>
            ${renderInfoIcon('Contexto da busca indisponível para este produto (anúncio acessado diretamente ou não visualizado na busca anterior).')}
          </div>
          <span style="font-size: 10px; background: #f3f4f6; color: #6b7280; padding: 1px 4px; border-radius: 4px; font-weight: 700;">Não encontrado</span>
        </div>
        <div id="productradar-section-search-context-null">
          <em>Contexto da busca indisponível para este produto (anúncio acessado diretamente ou não visualizado na busca anterior).</em>
        </div>
      </div>
    `;
  }

  // 5. Inteligência e Indicadores do Produto (TASK-030 / TASK-031 Hover Tooltips)
  const indicatorRows = [];

  // Faturando (Vendas declaradas × preço)
  const priceNum = productData && productData.price && typeof productData.price.current === 'number' ? productData.price.current : null;
  const soldNum = productData && typeof productData.soldQuantity === 'number' ? productData.soldQuantity : null;
  let revenueDisplay = notFoundHtml;
  if (soldNum !== null && priceNum !== null) {
    const revCalc = calculateRevenue(soldNum, priceNum);
    if (revCalc.value !== null) {
      revenueDisplay = `<strong style="color: #111827;">R$ ${revCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[ESTIMADO / CALCULADO]</span>`;
    }
  }
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Faturando: ${renderInfoIcon('Faturamento bruto estimado (vendas declaradas × preço unitário). NÃO representa lucro líquido.')}</span>
      <div>${revenueDisplay}</div>
    </div>
  `);

  // Vendas por dia & Velocidades
  const effectiveSold = (productData && typeof productData.soldQuantity === 'number')
    ? productData.soldQuantity
    : (searchContext && typeof searchContext.soldQuantity === 'number' ? searchContext.soldQuantity : null);
  const spdCalc = calculateSalesPerDay(effectiveSold, creationDate);

  let spdDisplay = notFoundHtml;
  let monthlySalesDisplay = notFoundHtml;
  let currentPaceDisplay = notFoundHtml;

  if (spdCalc.value !== null) {
    spdDisplay = `<strong style="color: #111827;">${spdCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} / dia</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[ESTIMADO / CALCULADO]</span>`;
    const monthlyVelocity = calculateMonthlyVelocity(spdCalc.value);
    if (monthlyVelocity.value !== null) {
      monthlySalesDisplay = `<strong style="color: #111827;">~${Math.round(monthlyVelocity.value).toLocaleString('pt-BR')} / mês</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[ESTIMADO / CALCULADO]</span>`;
      currentPaceDisplay = `<strong style="color: #111827;">~${Math.round(monthlyVelocity.value).toLocaleString('pt-BR')} / mês</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[ESTIMADO / CALCULADO]</span>`;
    }
  }

  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Vendas por dia: ${renderInfoIcon('Velocidade estimada (vendas declaradas divididas pelos dias decorridos desde a criação do anúncio). É uma estimativa derivada e NÃO representa garantia de lucro, margem, concorrência ou oportunidade.')}</span>
      <div>${spdDisplay}</div>
    </div>
  `);

  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Vendas mensais:</span>
      <div>${monthlySalesDisplay}</div>
    </div>
  `);

  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Ritmo atual (vendas/mês):</span>
      <div>${currentPaceDisplay}</div>
    </div>
  `);

  // Vendas estimadas
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Vendas estimadas:</span>
      <div>${notFoundHtml}</div>
    </div>
  `);

  // Visitas
  let visitsDisplay = notFoundHtml;
  if (productData && typeof productData.visits === 'number') {
    visitsDisplay = `<strong style="color: #111827;">${productData.visits.toLocaleString('pt-BR')}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
  }
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Visitas:</span>
      <div>${visitsDisplay}</div>
    </div>
  `);

  // Conversão
  let conversionDisplay = notFoundHtml;
  if (productData && typeof productData.soldQuantity === 'number' && typeof productData.visits === 'number' && productData.visits > 0) {
    const convCalc = calculateConversionRate(productData.soldQuantity, productData.visits);
    if (convCalc.value !== null) {
      conversionDisplay = `<strong style="color: #111827;">${convCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[CALCULADO]</span>`;
    }
  }
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Conversão:</span>
      <div>${conversionDisplay}</div>
    </div>
  `);

  // Imposto (Simulação do Usuário)
  let taxDisplay = notFoundHtml;
  if (priceNum !== null) {
    const taxCalc = calculateEstimatedTax(priceNum, taxRate);
    if (taxCalc.value !== null) {
      taxDisplay = `<strong style="color: #111827;">R$ ${taxCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[SIMULAÇÃO / CALCULADO]</span>`;
    }
  }
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Imposto: ${renderInfoIcon(`Simulação do usuário com alíquota configurada de ${taxRate}%. Não é dado observado do Mercado Livre.`)}</span>
      <div>${taxDisplay}</div>
    </div>
  `);

  // Comissão ML
  let commissionDisplay = notFoundHtml;
  if (productData && typeof productData.commission === 'number') {
    commissionDisplay = `<strong style="color: #111827;">R$ ${productData.commission.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`;
  }
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Comissão ML:</span>
      <div>${commissionDisplay}</div>
    </div>
  `);

  // Recebe
  let receiveDisplay = notFoundHtml;
  if (priceNum !== null && productData && typeof productData.commission === 'number') {
    const taxVal = (priceNum * taxRate) / 100;
    const recCalc = calculateReceiveNet({
      price: priceNum,
      commission: productData.commission,
      tax: taxVal,
      freight: 0,
    });
    if (recCalc.value !== null) {
      receiveDisplay = `<strong style="color: #111827;">R$ ${recCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[CALCULADO]</span>`;
    }
  }
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Recebe:</span>
      <div>${receiveDisplay}</div>
    </div>
  `);

  // Recomendação
  indicatorRows.push(`
    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
      <span style="color: #4b5563;">Recomendação:</span>
      <div>${notFoundHtml}</div>
    </div>
  `);

  const indicatorsHtml = `
    <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="productradar-section-toggle-btn" data-target="productradar-section-product-indicators" style="background: none; border: 1px solid #cbd5e1; border-radius: 4px; color: #475569; cursor: pointer; font-size: 12px; font-weight: 700; width: 18px; height: 18px; line-height: 1; display: inline-flex; align-items: center; justify-content: center; padding: 0;" title="Minimizar/Expandir">−</button>
          <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;">Indicadores de Inteligência do Produto</span>
        </div>
      </div>
      <div id="productradar-section-product-indicators">
        ${indicatorRows.join('')}
      </div>
    </div>
  `;

  overlayEl.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 340px;
      max-width: calc(100vw - 40px);
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      z-index: 999999;
      overflow: hidden;
      line-height: 1.3;
    ">
      <!-- Cabeçalho -->
      <div style="background: #0f766e; color: #ffffff; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 14px;">📡</span>
          <strong style="font-size: 13px; font-weight: 700; letter-spacing: 0.3px;">ProductRadar</strong>
          <span style="font-size: 10px; background: rgba(255,255,255,0.2); padding: 1px 5px; border-radius: 4px;">Produto (PDP)</span>
        </div>
        <button id="productradar-pdp-toggle-btn" style="background: none; border: none; color: #fff; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 4px;" title="Minimizar/Expandir">
          _
        </button>
      </div>

      <!-- Conteúdo do Painel -->
      <div id="productradar-pdp-content-panel" style="padding: 12px; max-height: 520px; overflow-y: auto;">
        ${pdpDetailsHtml}
        ${sellerDetailsHtml}
        ${supplierCostHtml}
        ${searchContextHtml}
        ${indicatorsHtml}
      </div>

      <!-- Tooltip flutuante global para PDP (TASK-031) -->
      <div id="productradar-pdp-tooltip" style="
        display: none;
        position: fixed;
        z-index: 1000001;
        max-width: 240px;
        background-color: #1f2937;
        color: #ffffff;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 11px;
        font-weight: normal;
        line-height: 1.35;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      "></div>
    </div>
  `;

  // Toggle minimize/expand do painel completo
  const toggleBtn = overlayEl.querySelector('#productradar-pdp-toggle-btn');
  const contentPanel = overlayEl.querySelector('#productradar-pdp-content-panel');
  if (toggleBtn && contentPanel) {
    toggleBtn.onclick = () => {
      if (contentPanel.style.display === 'none') {
        contentPanel.style.display = 'block';
        toggleBtn.innerText = '_';
      } else {
        contentPanel.style.display = 'none';
        toggleBtn.innerText = '□';
      }
    };
  }

  // Toggle de minimização/expansão independente por seção (TASK-031)
  const sectionToggleBtns = overlayEl.querySelectorAll('.productradar-section-toggle-btn');
  sectionToggleBtns.forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      const targetEl = overlayEl.querySelector(`#${targetId}`);
      if (!targetEl) return;
      if (targetEl.style.display === 'none') {
        targetEl.style.display = 'block';
        btn.innerText = '−';
      } else {
        targetEl.style.display = 'none';
        btn.innerText = '+';
      }
    };
  });

  // Gerenciamento de tooltips por hover/tap (TASK-031)
  const tooltipEl = overlayEl.querySelector('#productradar-pdp-tooltip');
  const infoIcons = overlayEl.querySelectorAll('.productradar-info-icon');

  if (tooltipEl && infoIcons.length > 0) {
    const showTooltipForIcon = (icon) => {
      const text = icon.getAttribute('data-tooltip') || icon.getAttribute('title');
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.style.display = 'block';
      const rect = icon.getBoundingClientRect();
      const tooltipRect = tooltipEl.getBoundingClientRect();

      let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
      if (left < 10) left = 10;
      if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
      }

      let top = rect.top - tooltipRect.height - 8;
      if (top < 10) {
        top = rect.bottom + 8;
      }

      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `${top}px`;
    };

    const hideTooltip = () => {
      if (tooltipEl) {
        tooltipEl.style.display = 'none';
      }
    };

    infoIcons.forEach((icon) => {
      icon.onmouseenter = () => showTooltipForIcon(icon);
      icon.onmouseleave = hideTooltip;
      icon.onclick = (e) => {
        e.stopPropagation();
        if (tooltipEl.style.display === 'block') {
          hideTooltip();
        } else {
          showTooltipForIcon(icon);
        }
      };
    });

    overlayEl.addEventListener('mouseleave', hideTooltip);
    doc.addEventListener('click', hideTooltip);
  }

  // Salvar Custo do Fornecedor (TASK-029)
  const costInput = overlayEl.querySelector('#productradar-supplier-cost-input');
  const costSaveBtn = overlayEl.querySelector('#productradar-supplier-cost-save-btn');
  const costFeedback = overlayEl.querySelector('#productradar-supplier-cost-feedback');

  if (costInput && costSaveBtn && canonicalId) {
    const handleSave = async () => {
      const rawVal = costInput.value;
      const parsed = parseMonetaryInput(rawVal);
      if (parsed === null) {
        if (costFeedback) {
          costFeedback.innerHTML = `<span style="color: #dc2626; font-weight: 600;">Valor inválido. Digite um valor numérico positivo.</span>`;
        }
        return;
      }
      try {
        await saveProductSupplierCost(canonicalId, parsed);
        costInput.value = parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (costFeedback) {
          costFeedback.innerHTML = `<span style="color: #16a34a; font-weight: 600;">✓ Custo salvo com sucesso!</span>`;
          setTimeout(() => {
            if (costFeedback && costFeedback.innerHTML.includes('Custo salvo')) {
              costFeedback.innerHTML = '';
            }
          }, 3000);
        }
      } catch (err) {
        if (costFeedback) {
          costFeedback.innerHTML = `<span style="color: #dc2626; font-weight: 600;">Erro ao salvar custo.</span>`;
        }
      }
    };

    costSaveBtn.onclick = handleSave;
    costInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    };
  }

  return overlayEl;
}

/**
 * Orquestra o fluxo de extração, persistência e renderização de UI em páginas de busca (TASK-009 / TASK-014).
 * 
 * @param {Document|Element} [documentRoot=document] - Raiz do documento ou contêiner DOM.
 * @param {string|URL} [currentUrl=window.location.href] - URL da página ativa.
 * @returns {Promise<{ context: string, extractedCount: number, savedCount: number, status: string }>}
 */
export async function runSearchOrchestration(
  documentRoot = (typeof document !== 'undefined' ? document : null),
  currentUrl = (typeof window !== 'undefined' && window.location ? window.location.href : '')
) {
  if (!documentRoot || !currentUrl) {
    return {
      context: PAGE_CONTEXTS.UNSUPPORTED,
      extractedCount: 0,
      savedCount: 0,
      status: 'SKIPPED_INVALID_ENVIRONMENT',
    };
  }

  // 1. Classificação do contexto da página
  const context = classifyPageContext(currentUrl, documentRoot);

  if (context !== PAGE_CONTEXTS.SEARCH_RESULTS) {
    return {
      context,
      extractedCount: 0,
      savedCount: 0,
      status: 'SKIPPED_NON_SEARCH_PAGE',
    };
  }

  // 2. Extração pura dos cards de busca a partir do DOM
  let extractedCards = [];
  try {
    extractedCards = extractSearchPageData(documentRoot);
  } catch (err) {
    console.warn('[ProductRadar] Erro ao extrair dados de busca:', err);
    return {
      context,
      extractedCount: 0,
      savedCount: 0,
      status: 'EXTRACTION_ERROR',
    };
  }

  // 3. Obter configuração e contagem total de resultados
  let config = DEFAULT_CONFIG;
  try {
    config = await getConfig();
  } catch {
    config = DEFAULT_CONFIG;
  }

  const resultCount = extractSearchResultCount(documentRoot);

  if (!Array.isArray(extractedCards) || extractedCards.length === 0) {
    // Renderiza overlay informando ausência de produtos
    renderSearchOverlay(documentRoot, { extractedCards: [], resultCount, config });
    return {
      context,
      extractedCount: 0,
      savedCount: 0,
      status: 'EMPTY_RESULTS',
    };
  }

  // 4. Filtrar produtos novos para persistência
  const newCardsToSave = extractedCards.filter((card) => {
    return card && typeof card.id === 'string' && !processedProductIds.has(card.id);
  });

  let savedCount = 0;
  if (newCardsToSave.length > 0) {
    try {
      savedCount = await saveMultipleProductSearchContexts(newCardsToSave);
      for (const card of newCardsToSave) {
        if (card && card.id) {
          processedProductIds.add(card.id);
        }
      }
    } catch (err) {
      console.warn('[ProductRadar] Erro ao persistir contexto de busca:', err);
    }
  }

  // 5. Renderização do Overlay de Busca (TASK-014)
  try {
    renderSearchOverlay(documentRoot, { extractedCards, resultCount, config });
  } catch (err) {
    console.warn('[ProductRadar] Erro ao renderizar overlay de busca:', err);
  }

  return {
    context,
    extractedCount: extractedCards.length,
    savedCount,
    status: newCardsToSave.length === 0 ? 'ALREADY_PROCESSED' : 'SUCCESS',
  };
}

/**
 * Orquestra o fluxo de extração de PDP, recuperação de contexto de busca e renderização de UI (TASK-010 / TASK-016).
 * Mantém productData (dados atuais de PDP) e searchContext (dados históricos de busca)
 * estritamente separados, sem mesclagem, sem sobrescrita e sem persistência de dados de PDP no cache.
 * 
 * @param {Document|Element} [documentRoot=document] - Raiz do documento ou contêiner DOM.
 * @param {string|URL} [currentUrl=window.location.href] - URL da página ativa.
 * @returns {Promise<{ context: string, productData: object|null, searchContext: object|null, status: string }>}
 */
export async function runProductOrchestration(
  documentRoot = (typeof document !== 'undefined' ? document : null),
  currentUrl = (typeof window !== 'undefined' && window.location ? window.location.href : '')
) {
  if (!documentRoot || !currentUrl) {
    return {
      context: PAGE_CONTEXTS.UNSUPPORTED,
      productData: null,
      searchContext: null,
      status: 'SKIPPED_INVALID_ENVIRONMENT',
    };
  }

  // 1. Classificação do contexto da página
  const context = classifyPageContext(currentUrl, documentRoot);

  if (context !== PAGE_CONTEXTS.PRODUCT_DETAIL) {
    return {
      context,
      productData: null,
      searchContext: null,
      status: 'SKIPPED_NON_PRODUCT_PAGE',
    };
  }

  if (
    documentRoot &&
    typeof documentRoot.getAttribute === 'function' &&
    !documentRoot.getAttribute('data-url') &&
    typeof currentUrl === 'string'
  ) {
    try {
      documentRoot.setAttribute('data-url', currentUrl);
    } catch {
      // Ignora
    }
  }

  // 2. Extração pura dos dados da página de produto (TASK-007)
  let productData = null;
  try {
    productData = extractProductPageData(documentRoot);
    if (productData && !productData.id && currentUrl) {
      productData.id = extractCanonicalProductId(currentUrl);
    }
  } catch (err) {
    console.warn('[ProductRadar] Erro ao extrair dados da página de produto:', err);
    return {
      context,
      productData: null,
      searchContext: null,
      status: 'EXTRACTION_ERROR',
    };
  }

  // 3. Recuperação do contexto de busca e custo de fornecedor para o ID canônico (TASK-008 / TASK-021 / TASK-029)
  let searchContext = null;
  let supplierCost = null;
  const targetId = (productData && productData.id) || (currentUrl ? extractCanonicalProductId(currentUrl) : null);
  if (targetId) {
    try {
      searchContext = await getProductSearchContext(targetId);
    } catch (err) {
      console.warn('[ProductRadar] Erro ao recuperar contexto de busca para produto:', err);
      searchContext = null;
    }
    try {
      supplierCost = await getProductSupplierCost(targetId);
    } catch (err) {
      console.warn('[ProductRadar] Erro ao recuperar custo do fornecedor:', err);
      supplierCost = null;
    }
  }

  // 4. Obter configuração ativa do ProductRadar
  let config = DEFAULT_CONFIG;
  try {
    config = await getConfig();
  } catch {
    config = DEFAULT_CONFIG;
  }

  // 5. Renderização do Overlay de Produto (TASK-016 / TASK-029)
  try {
    renderProductOverlay(documentRoot, { productData, searchContext, config, supplierCost });
  } catch (err) {
    console.warn('[ProductRadar] Erro ao renderizar overlay de produto:', err);
  }

  // 6. Retorno estruturado com separação explícita entre productData, searchContext e supplierCost
  return {
    context,
    productData,
    searchContext,
    supplierCost,
    status: 'SUCCESS',
  };
}

/**
 * Ponto de entrada unificado para orquestração automática do content script.
 * 
 * @param {Document|Element} [documentRoot=document] - Raiz do documento ou contêiner DOM.
 * @param {string|URL} [currentUrl=window.location.href] - URL da página ativa.
 * @returns {Promise<object>} Resultado da orquestração executada.
 */
export async function runContentScriptOrchestration(
  documentRoot = (typeof document !== 'undefined' ? document : null),
  currentUrl = (typeof window !== 'undefined' && window.location ? window.location.href : '')
) {
  if (!documentRoot || !currentUrl) {
    return {
      context: PAGE_CONTEXTS.UNSUPPORTED,
      status: 'SKIPPED_INVALID_ENVIRONMENT',
    };
  }

  const context = classifyPageContext(currentUrl, documentRoot);

  if (context === PAGE_CONTEXTS.SEARCH_RESULTS) {
    return runSearchOrchestration(documentRoot, currentUrl);
  }

  if (context === PAGE_CONTEXTS.PRODUCT_DETAIL) {
    return runProductOrchestration(documentRoot, currentUrl);
  }

  return {
    context: PAGE_CONTEXTS.UNSUPPORTED,
    status: 'SKIPPED_UNSUPPORTED_PAGE',
  };
}

/**
 * Interrompe qualquer observador de mutação e limpa temporizadores ativos de observação (TASK-024).
 */
export function stopDynamicContentObserver() {
  if (activeDebounceTimer) {
    clearTimeout(activeDebounceTimer);
    activeDebounceTimer = null;
  }
  if (activeMaxTimeout) {
    clearTimeout(activeMaxTimeout);
    activeMaxTimeout = null;
  }
  if (activeObserver) {
    try {
      activeObserver.disconnect();
    } catch {
      // Ignora erro ao desconectar
    }
    activeObserver = null;
  }
}

/**
 * Inicia a observação reativa e limitada por tempo de mutações no DOM para capturar renderização dinâmica (TASK-024).
 * Utiliza debounce para coalescer mutações e desliga o observador automaticamente após estabilização ou timeout.
 *
 * @param {Document|Element} [documentRoot=document] - Raiz do documento ou contêiner DOM.
 * @param {string|URL} [currentUrl=window.location.href] - URL da página ativa.
 * @param {object} [options={}] - Opções de configuração do observador.
 * @param {number} [options.debounceMs=250] - Janela de debounce em milissegundos.
 * @param {number} [options.maxWaitMs=10000] - Tempo máximo de observação em milissegundos.
 * @returns {MutationObserver|null} Instância do MutationObserver ou null.
 */
export function observeDynamicContent(
  documentRoot = (typeof document !== 'undefined' ? document : null),
  currentUrl = (typeof window !== 'undefined' && window.location ? window.location.href : ''),
  options = {}
) {
  if (!documentRoot || !currentUrl) return null;
  if (typeof MutationObserver === 'undefined') return null;

  const doc = documentRoot.ownerDocument || (documentRoot.nodeType === 9 ? documentRoot : document);
  const targetNode = doc.body || (doc.documentElement || documentRoot);
  if (!targetNode) return null;

  stopDynamicContentObserver();

  const debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : 250;
  const maxWaitMs = typeof options.maxWaitMs === 'number' ? options.maxWaitMs : 10000;

  const context = classifyPageContext(currentUrl, documentRoot);
  if (context === PAGE_CONTEXTS.UNSUPPORTED) {
    return null;
  }

  const checkStabilization = (orchResult) => {
    if (!orchResult) return false;
    if (context === PAGE_CONTEXTS.SEARCH_RESULTS) {
      const hasCount = extractSearchResultCount(documentRoot) !== null;
      const cards = extractSearchPageData(documentRoot);
      return hasCount && Array.isArray(cards) && cards.length > 0;
    }
    if (context === PAGE_CONTEXTS.PRODUCT_DETAIL) {
      const p = extractProductPageData(documentRoot);
      return Boolean(p && p.title && p.price && p.price.current !== null);
    }
    return true;
  };

  const executeOrchestration = async () => {
    try {
      const res = await runContentScriptOrchestration(documentRoot, currentUrl);
      if (checkStabilization(res)) {
        stopDynamicContentObserver();
      }
    } catch (err) {
      console.warn('[ProductRadar] Erro durante re-orquestração por mutação:', err);
    }
  };

  // Agenda timeout de término máximo para garantir execução finita e limitada
  activeMaxTimeout = setTimeout(() => {
    stopDynamicContentObserver();
  }, maxWaitMs);

  activeObserver = new MutationObserver((mutations) => {
    // Ignora mutações geradas pelos próprios overlays do ProductRadar
    const isOurMutation = mutations.every((m) => {
      const target = m.target && m.target.nodeType === 1 ? m.target : (m.target ? m.target.parentElement : null);
      return target && typeof target.closest === 'function' && target.closest('[data-productradar-root]');
    });
    if (isOurMutation) return;

    if (activeDebounceTimer) {
      clearTimeout(activeDebounceTimer);
    }
    activeDebounceTimer = setTimeout(() => {
      executeOrchestration();
    }, debounceMs);
  });

  try {
    activeObserver.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  } catch (err) {
    console.warn('[ProductRadar] Falha ao iniciar MutationObserver:', err);
    stopDynamicContentObserver();
    return null;
  }

  return activeObserver;
}

/**
 * Função utilitária para resetar o cache em memória de processamento e observadores (usado em testes ou re-inicializações).
 */
export function resetOrchestrationState() {
  processedProductIds.clear();
  stopDynamicContentObserver();
}

/**
 * Inicialização automática no carregamento do content script no navegador com suporte a prontidão reativa (TASK-024).
 */
export function initContentScript() {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const start = async () => {
      try {
        await runContentScriptOrchestration(document, window.location.href);
        const context = classifyPageContext(window.location.href, document);
        if (context !== PAGE_CONTEXTS.UNSUPPORTED) {
          observeDynamicContent(document, window.location.href);
        }
      } catch (err) {
        console.warn('[ProductRadar] Falha na orquestração automática:', err);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        start();
      }, { once: true });
    } else {
      start();
    }
  }
}

// Executa a inicialização do content script
initContentScript();
