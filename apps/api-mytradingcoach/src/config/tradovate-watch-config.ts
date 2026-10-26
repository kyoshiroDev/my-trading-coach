/**
 * Veille serveur Tradovate (#770) : plafond de veilles simultanées, lu dans `TRADOVATE_WATCH_MAX`.
 * Entier ≥ 0 ; absent, invalide ou 0 → veille ÉTEINTE. Elle s'allume environnement par environnement
 * (valeur conseillée : 500), pas d'office avec le push des traders : la mesure de charge passe avant
 * la prod (deploy.md).
 */
export function resolveWatchMax(env: Record<string, string | undefined> = process.env): number {
  const raw = env['TRADOVATE_WATCH_MAX']?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : 0;
}
