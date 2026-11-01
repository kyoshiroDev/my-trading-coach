/**
 * Jours de l'historique quotidien (`MetricsSnapshot`) où les essais n'étaient pas comptés (#828,
 * décision G4 : annoter, pas recalculer) : du lancement de l'essai d'inscription (28/10, 05:57) à la
 * veille du déploiement en prod de #828. Le plan restait FREE pendant l'essai : gratuits gonflés,
 * essais et Premium sous-comptés. Les lignes restent telles quelles ; la courbe admin les marque.
 * `to` : à régler sur la veille du jour de déploiement en prod de #828 (dates Paris, incluses).
 */
export const TRIAL_KPI_UNRELIABLE = { from: '2026-10-28', to: '2026-11-01' } as const;

/** Le snapshot de ce jour (YYYY-MM-DD, Paris) a-t-il des essais non comptés ? */
export function isTrialKpiUnreliable(date: string): boolean {
  return date >= TRIAL_KPI_UNRELIABLE.from && date <= TRIAL_KPI_UNRELIABLE.to;
}
