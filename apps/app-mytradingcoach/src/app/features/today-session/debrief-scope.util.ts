/**
 * Trades de LA séance pour l'onglet Débrief : les siens, plus ceux encore non rattachés (la clôture
 * les rattache, même règle que l'API). Avant (#947), les trades de toute la journée du compte : une
 * 2e séance du jour reprenait le meilleur trade, les émotions et la discipline de la 1re.
 */
export function sessionScopedTrades<T extends { sessionId: string | null }>(
  sessionId: string | null | undefined,
  trades: readonly T[],
): T[] {
  return sessionId ? trades.filter((t) => t.sessionId === sessionId || t.sessionId === null) : [...trades];
}
