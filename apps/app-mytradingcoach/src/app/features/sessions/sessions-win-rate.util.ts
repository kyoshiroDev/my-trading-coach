/**
 * Win rate des séances listées, sur leurs TRADES : Σ gagnants ÷ (Σ gagnants + Σ perdants), BE et
 * ouverts exclus (même règle que `computeTradeStats`). Avant (#947), moyenne non pondérée des win
 * rates par séance, une séance sans trade décisif comptant 0 %. `null` si aucun trade décisif.
 */
export function sessionsWinRate(sessions: readonly { wins?: number; losses?: number }[]): number | null {
  const wins = sessions.reduce((acc, s) => acc + (s.wins ?? 0), 0);
  const losses = sessions.reduce((acc, s) => acc + (s.losses ?? 0), 0);
  return wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;
}
