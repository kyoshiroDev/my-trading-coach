/** Intervalles de polling en millisecondes */
export const POLLING_MS = {
  MARKET_CONTEXT: 15_000,
  LIVE_PRICE:     4_000,
  NEWS:           300_000,
  // Calendrier éco : rattrape les actuals + analyse IA publiés pendant que la fenêtre
  // est ouverte, même si le broadcast WebSocket a été manqué (reconnexion, déploiement…).
  ECO_CALENDAR:   60_000,
} as const;
