/**
 * Intervalles de polling en millisecondes. Tous passent par `visibleInterval` (muet onglet caché).
 * SCA-B4 : contexte marché et calendrier éco sont poussés par le socket /eco ; leur polling HTTP
 * n'est plus qu'un secours. Cible : < 3 req/min par onglet en session (hors quick-trade).
 */
export const POLLING_MS = {
  /** /auth/me : synchronisation du plan / profil (B4-01, était 30 s). */
  USER_SYNC:               300_000,
  /** Stats live de la session (trades synchronisés par le broker). */
  LIVE_STATS:              30_000,
  /** Secours si le socket /eco ne pousse pas (coupure) ; poussé toutes les 15 s sinon. */
  MARKET_CONTEXT_FALLBACK: 300_000,
  /** Secours du calendrier éco (actuals + analyse IA aussi poussés par eco:new-releases). */
  ECO_CALENDAR_FALLBACK:   300_000,
  LIVE_PRICE:              4_000,
  NEWS:                    300_000,
} as const;
