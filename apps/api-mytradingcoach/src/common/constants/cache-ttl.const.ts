/** Durées de cache Redis en secondes */
export const CACHE_TTL = {
  PRICE:           15,
  MARKET_CTX:      15,
  NEWS:            60,
  ECO_EVENTS:      3_600,
  ECO_EVENTS_LONG: 3_600 * 6,
  EXCHANGE_RATES:  3_600 * 6,
  ANALYTICS:       300,
  BILLING:         300,
} as const;
