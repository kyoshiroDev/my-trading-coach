import type { computeSummary } from '../analytics/analytics-summary';

/** Résumé des stats tel que calculé par `computeSummary` (API et scripts). */
export type StatsSummary = Awaited<ReturnType<typeof computeSummary>>;

/**
 * Stats d'un débrief hebdo (prompt IA, `WeeklyDebrief.stats`, e-mail « débrief prêt ») à partir du
 * résumé de SA semaine : l'id du compte du pire drawdown (identifiant interne) n'en fait pas partie.
 * Fonction PURE, partagée par `DebriefService.generate` et `scripts/recompute-debrief-stats.ts` (#943).
 */
export function debriefStats(summary: StatsSummary) {
  const { maxDrawdownAccountId: _accountId, ...stats } = summary;
  return stats;
}

export type DebriefStats = ReturnType<typeof debriefStats>;
