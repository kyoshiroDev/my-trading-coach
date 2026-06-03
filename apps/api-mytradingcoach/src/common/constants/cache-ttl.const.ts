/** Durées de cache Redis en secondes */
export const CACHE_TTL = {
  PRICE:           3,
  MARKET_CTX:      15,
  NEWS:            300,
  ECO_EVENTS:      3_600,
  ECO_EVENTS_LONG: 3_600 * 6,
  EXCHANGE_RATES:  3_600 * 6,
  ANALYTICS:       300,
  DEBRIEF:         3_600,
  BILLING:         300,
} as const;
