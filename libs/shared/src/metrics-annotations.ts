/**
 * Jours de l'historique quotidien (`MetricsSnapshot`) où les essais n'étaient pas comptés (#828,
 * décision G4 : annoter, pas recalculer) : du lancement de l'essai d'inscription (28/10, 05:57) à la
 * veille du déploiement en prod de #828. Le plan restait FREE pendant l'essai : gratuits gonflés,
 * essais et Premium sous-comptés. Les lignes restent telles quelles ; la courbe admin les marque.
 * `to` : dernier relevé pris avec l'ancien code (dates Paris, incluses). #828 est en prod depuis le
 * 01/11 (20:25, Paris) ; le relevé du 01/11 est pris le 02/11 à 00:05 avec le nouveau code : il est juste.
 */
export const TRIAL_KPI_UNRELIABLE = { from: '2026-10-28', to: '2026-10-31' } as const;

/** Le snapshot de ce jour (YYYY-MM-DD, Paris) a-t-il des essais non comptés ? */
export function isTrialKpiUnreliable(date: string): boolean {
  return date >= TRIAL_KPI_UNRELIABLE.from && date <= TRIAL_KPI_UNRELIABLE.to;
}
