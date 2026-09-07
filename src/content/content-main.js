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
} from '../shared/utils.js';
import { extractSearchPageData } from './extractors/search-extractor.js';
import { extractProductPageData } from './extractors/product-extractor.js';
import {
  saveMultipleProductSearchContexts,
  getProductSearchContext,
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
export function renderProductOverlay(documentRoot, { productData = null, searchContext = null, config = DEFAULT_CONFIG }) {
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

  // 1. Dados Observados na Página (PDP)
  const pdpTitle = productData && productData.title ? productData.title : 'Produto sem título identificado';
  const pdpPrice = productData && productData.price && productData.price.current !== null
    ? `R$ ${productData.price.current.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : 'Não informado';
  const pdpStock = productData && productData.availableStock !== null
    ? `${productData.availableStock} unidades`
    : 'Não informado';
  const pdpSeller = productData && productData.seller && productData.seller.name
    ? productData.seller.name
    : 'Não identificado';
  const pdpShipping = productData && productData.shipping && productData.shipping.isFree
    ? (productData.shipping.isFull ? 'Frete Grátis (Full)' : 'Frete Grátis')
    : (productData && productData.shipping && productData.shipping.isFull ? 'Envio Full' : 'Padrão');

  const pdpDetailsHtml = `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase;">Dados Observados na Página</span>
        <span style="font-size: 10px; background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px; font-weight: 700;">[OBSERVADO NO ANÚNCIO]</span>
      </div>
      <div style="font-size: 12px; font-weight: 600; color: #111827; margin-bottom: 6px; line-height: 1.3;" title="${pdpTitle}">
        ${pdpTitle}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px;">
        <div><span style="color: #6b7280;">Preço PDP:</span> <strong style="color: #059669;">${pdpPrice}</strong></div>
        <div><span style="color: #6b7280;">Estoque:</span> <strong>${pdpStock}</strong></div>
        <div><span style="color: #6b7280;">Vendedor:</span> <strong>${pdpSeller}</strong></div>
        <div><span style="color: #6b7280;">Envio:</span> <strong>${pdpShipping}</strong></div>
      </div>
    </div>
  `;

  // 2. Contexto Herdado da Busca (Search Context)
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
          <span style="font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase;">Contexto da Busca Anterior</span>
          <span style="font-size: 10px; background: #dcfce7; color: #15803d; padding: 1px 6px; border-radius: 4px; font-weight: 700;">[OBSERVADO NA BUSCA]</span>
        </div>
        <div style="font-size: 11px; color: #166534; margin-bottom: 4px;">
          Preço na busca: <strong>${sPrice}</strong> ${sDiscount ? `<span style="color: #15803d; font-weight: 700;">(${sDiscount})</span>` : ''}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; color: #374151;">
          <div><span style="color: #6b7280;">Avaliação:</span> <strong>${sRating}</strong></div>
          <div><span style="color: #6b7280;">Patrocinado:</span> <strong>${sSponsored}</strong></div>
        </div>
      </div>
    `;
  } else {
    searchContextHtml = `
      <div style="background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px; color: #6b7280;">
        ℹ️ <em>Contexto da busca indisponível para este produto (anúncio acessado diretamente ou não visualizado na busca anterior) <span style="font-size: 10px; background: #f3f4f6; color: #6b7280; padding: 1px 4px; border-radius: 4px; font-weight: 700;">[INDISPONÍVEL]</span>.</em>
      </div>
    `;
  }

  // 3. Indicadores de Produto (Controlados por visibility.product com Semântica Estrita TASK-020)
  const indicatorRows = [];

  // Vendas (Observadas no PDP)
  if (prodVis.sales) {
    const salesText = productData && productData.soldQuantity !== null
      ? `<strong style="color: #111827;">+${productData.soldQuantity.toLocaleString('pt-BR')} vendidos</strong> <span style="font-size: 10px; color: #059669; font-weight: 700; background: #ecfdf5; padding: 1px 6px; border-radius: 4px;">[OBSERVADO]</span>`
      : `<span style="color: #9ca3af; font-style: italic;">Indisponível na página</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span>`;
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Vendas declaradas:</span>
        <div>${salesText}</div>
      </div>
    `);

    // Vendas por dia (Estimativa de Velocidade / TASK-028)
    const effectiveSold = (productData && typeof productData.soldQuantity === 'number')
      ? productData.soldQuantity
      : (searchContext && typeof searchContext.soldQuantity === 'number' ? searchContext.soldQuantity : null);
    const creationDate = productData && productData.creationDate ? productData.creationDate : null;
    const spdCalc = calculateSalesPerDay(effectiveSold, creationDate);

    let spdContent = '';
    if (spdCalc.value !== null) {
      spdContent = `
        <div style="text-align: right;">
          <strong style="color: #111827;">${spdCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} / dia</strong>
          <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[ESTIMADO / CALCULADO]</span>
        </div>
      `;
    } else {
      spdContent = `
        <div style="text-align: right;">
          <span style="color: #9ca3af; font-style: italic;">Indisponível (sem data de criação)</span>
          <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span>
        </div>
      `;
    }

    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Vendas por dia:</span>
        <div>${spdContent}</div>
      </div>
      <div style="font-size: 10px; color: #6b7280; margin-bottom: 4px; padding-left: 2px;">
        ℹ️ <em>Velocidade estimada (vendas declaradas divididas pelos dias decorridos desde a criação do anúncio). É uma estimativa derivada e NÃO representa garantia de lucro, margem, concorrência ou oportunidade.</em>
      </div>
    `);
  }

  // Imposto Estimado (Simulação do Usuário)
  if (prodVis.taxRate) {
    let taxContent = `<span style="color: #9ca3af; font-style: italic;">Indisponível (preço ausente)</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span>`;
    if (productData && productData.price && typeof productData.price.current === 'number') {
      const taxCalc = calculateEstimatedTax(productData.price.current, taxRate);
      if (taxCalc.value !== null) {
        taxContent = `
          <div style="text-align: right;">
            <strong style="color: #111827;">R$ ${taxCalc.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            <span style="font-size: 10px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 1px 6px; border-radius: 4px;">[SIMULAÇÃO / CALCULADO]</span>
          </div>
        `;
      }
    }
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Imposto estimado:</span>
        <div>${taxContent}</div>
      </div>
      <div style="font-size: 10px; color: #6b7280; margin-bottom: 4px; padding-left: 2px;">
        ℹ️ <em>Simulação do usuário com alíquota configurada de ${taxRate}%. Não é dado observado do Mercado Livre.</em>
      </div>
    `);
  }

  // Faturamento (Indisponível no MVP)
  if (prodVis.revenue) {
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Faturamento:</span>
        <div><span style="color: #9ca3af; font-style: italic;">Indisponível</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span></div>
      </div>
    `);
  }

  // Margem Líquida (Indisponível sem custo de fornecedor)
  if (prodVis.netMargin) {
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Margem líquida:</span>
        <div><span style="color: #9ca3af; font-style: italic;">Indisponível (requer custo fornecedor)</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span></div>
      </div>
    `);
  }

  // Semáforo (Métrica exclusiva de busca)
  if (prodVis.trafficLight) {
    indicatorRows.push(`
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0; border-bottom: 1px solid #f3f4f6;">
        <span style="color: #4b5563;">Semáforo:</span>
        <div><span style="color: #9ca3af; font-style: italic;">Indisponível no produto individual</span> <span style="font-size: 10px; color: #6b7280; font-weight: 600; background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">[INDISPONÍVEL]</span></div>
      </div>
    `);
  }

  let indicatorsHtml = '';
  if (indicatorRows.length > 0) {
    indicatorsHtml = `
      <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px;">
        <div style="font-size: 11px; font-weight: 700; color: #4b5563; text-transform: uppercase; margin-bottom: 6px;">Indicadores do Produto</div>
        ${indicatorRows.join('')}
      </div>
    `;
  }

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
      <div id="productradar-pdp-content-panel" style="padding: 12px; max-height: 480px; overflow-y: auto;">
        ${pdpDetailsHtml}
        ${searchContextHtml}
        ${indicatorsHtml}
      </div>
    </div>
  `;

  // Toggle minimize/expand
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

  // 3. Recuperação do contexto de busca previamente armazenado para o ID canônico (TASK-008 / TASK-021)
  let searchContext = null;
  const targetId = (productData && productData.id) || (currentUrl ? extractCanonicalProductId(currentUrl) : null);
  if (targetId) {
    try {
      searchContext = await getProductSearchContext(targetId);
    } catch (err) {
      console.warn('[ProductRadar] Erro ao recuperar contexto de busca para produto:', err);
      searchContext = null;
    }
  }

  // 4. Obter configuração ativa do ProductRadar
  let config = DEFAULT_CONFIG;
  try {
    config = await getConfig();
  } catch {
    config = DEFAULT_CONFIG;
  }

  // 5. Renderização do Overlay de Produto (TASK-016)
  try {
    renderProductOverlay(documentRoot, { productData, searchContext, config });
  } catch (err) {
    console.warn('[ProductRadar] Erro ao renderizar overlay de produto:', err);
  }

  // 6. Retorno estruturado com separação explícita entre productData e searchContext
  return {
    context,
    productData,
    searchContext,
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
