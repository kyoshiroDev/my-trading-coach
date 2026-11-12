/**
 * Période glissante de N mois CALENDAIRES, commune au tableau de bord et à Statistiques (#947 :
 * l'un prenait 30 jours, l'autre un mois calendaire à l'heure près). Début = même quantième N mois
 * plus tôt, à minuit LOCAL (borné au dernier jour du mois : 31/03 → 28/02, pas 03/03) ; fin = fin
 * de la journée, jamais « maintenant » figé à l'ouverture. `months = null` → tout l'historique.
 */
export function rollingRange(months: number | null, now = new Date()): { from: Date | null; to: Date } {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (months == null) return { from: null, to };
  const m = now.getMonth() - months;
  const lastDay = new Date(now.getFullYear(), m + 1, 0).getDate();
  return { from: new Date(now.getFullYear(), m, Math.min(now.getDate(), lastDay)), to };
}
