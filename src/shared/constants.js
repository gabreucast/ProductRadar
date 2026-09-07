/**
 * ProductRadar - Constantes Compartilhadas
 * Módulo de constantes globais, identidade de produto, configurações e classificação de fontes (TASK-002 / TASK-003 / TASK-004 / TASK-013)
 */

export const EXTENSION_NAME = 'ProductRadar';
export const EXTENSION_VERSION = '0.1.0';

// Configurações de Domínio e Identidade do Mercado Livre Brasil
export const ML_DOMAIN_SUFFIX = 'mercadolivre.com.br';
export const ML_SITE_ID = 'MLB';
export const ML_BASE_URL = 'https://www.mercadolivre.com.br';

// Tipos de Identificador de Produto
export const PRODUCT_ID_TYPES = Object.freeze({
  STANDARD: 'STANDARD', // Anúncio direto de listagem (/MLB-...)
  CATALOG: 'CATALOG',   // Produto de catálogo unificado (/p/MLB...)
});

// Expressões Regulares para Reconhecimento e Normalização de Identificadores
export const PRODUCT_PATTERNS = Object.freeze({
  // Identificador canônico limpo: MLB seguido de 6 a 14 dígitos numéricos
  CANONICAL_ID: /^MLB\d{6,14}$/,
  // Identificador bruto aceitável (com ou sem hífen, case-insensitive)
  RAW_ID: /^MLB-?\d{6,14}$/i,
  // Rota de Catálogo: /p/MLB... ou /slug-produto/p/MLB...
  CATALOG_URL_PATH: /(?:^|\/)p\/(MLB-?\d{6,14})(?:[_\/-]|$)/i,
  // Rota de Anúncio Padrão: /MLB-... ou /(item|produto)/MLB-...
  STANDARD_URL_PATH: /^\/(?:(?:item|produto)\/)?(MLB-?\d{6,14})(?:[_\/-]|$)/i,
});

// Chaves estáveis para persistência em chrome.storage.local
export const STORAGE_KEYS = Object.freeze({
  CONFIG: 'product_radar_config',
  PRODUCT_CACHE: 'product_radar_cache', // Limite de esquema reservado para contexto de produtos
  SUPPLIER_COSTS: 'product_radar_supplier_costs', // Custo do fornecedor por produto canônico (TASK-029)
});

// Versão do esquema de configuração para suportar migrações futuras com segurança
export const CONFIG_SCHEMA_VERSION = 1;

// Classificação de Origem e Confiança dos Dados (TASK-013 / TASK-020 / TASK-029)
export const DATA_SOURCES = Object.freeze({
  OBSERVED: 'OBSERVED',       // Extraído diretamente do DOM público do Mercado Livre
  CALCULATED: 'CALCULATED',   // Derivado de fórmulas matemáticas a partir de dados observados/configurados
  ESTIMATED: 'ESTIMATED',     // Estimativa derivada (ex: vendas por dia via data de criação)
  USER_INPUT: 'USER_INPUT',   // Informado manualmente pelo usuário (ex: custo do fornecedor)
  UNAVAILABLE: 'UNAVAILABLE', // Dados ou parâmetros de entrada ausentes/insuficientes
});

// Rótulos em Português para Apresentação Visual da Origem dos Dados (TASK-020 / TASK-029)
export const DATA_SOURCE_LABELS = Object.freeze({
  OBSERVED: 'OBSERVADO',
  CALCULATED: 'CALCULADO',
  ESTIMATED: 'ESTIMADO',
  USER_INPUT: 'INFORMADO PELO USUÁRIO',
  UNAVAILABLE: 'INDISPONÍVEL',
});

// Estados de Semáforo de Oportunidade por Quantidade de Resultados (TASK-013)
export const TRAFFIC_LIGHT_STATUS = Object.freeze({
  GREEN: 'GREEN',             // Baixa concorrência / Alta oportunidade (<= green_max)
  YELLOW: 'YELLOW',           // Concorrência moderada (> green_max && <= yellow_max)
  RED: 'RED',                 // Alta concorrência (> yellow_max)
  UNAVAILABLE: 'UNAVAILABLE', // Total de resultados não observado/indisponível
});

/**
 * Congela profundamente um objeto e suas propriedades aninhadas para garantir imutabilidade.
 * 
 * @param {object} obj - Objeto a ser congelado.
 * @returns {object} Objeto congelado.
 */
function deepFreeze(obj) {
  Object.keys(obj).forEach((prop) => {
    if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
      deepFreeze(obj[prop]);
    }
  });
  return Object.freeze(obj);
}

// Configuração padrão do ProductRadar (imutável)
export const DEFAULT_CONFIG = deepFreeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  trafficLight: {
    green_max: 100,  // Até 100: Verde (alta oportunidade)
    yellow_max: 500, // De 101 até 500: Amarelo (atenção); acima de 500: Vermelho
  },
  // Taxa de imposto padrão (7%): dado de entrada para cálculo do usuário, NÃO observado do Mercado Livre
  taxRate: 7,
  visibility: {
    // Configuração de visibilidade dos indicadores da página de busca
    search: {
      sales: true,
      revenue: true,
      stock: true,
      trafficLight: true,
    },
    // Configuração de visibilidade dos indicadores da página de produto
    product: {
      sales: true,
      revenue: true,
      netMargin: true,
      taxRate: true,
      trafficLight: true,
    },
  },
});
