/** Dates calendaires à l'heure de Paris (fuseau de référence du produit), front + back. */
export function todayParis(): string {
  return new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

export function toParisDateStr(d: Date): string {
  return d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
}

/** Journée calendaire Paris précédant maintenant (YYYY-MM-DD). */
export function yesterdayParis(): string {
  return toParisDateStr(new Date(Date.now() - 86_400_000));
}

/**
 * Décalage Europe/Paris en minutes à un instant donné : +60 l'hiver, +120 l'été.
 * Passe par `Intl` plutôt qu'une constante, sinon tout calcul de journée est faux
 * une moitié de l'année.
 */
function parisOffsetMinutes(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(at)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second']),
  );
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * Bornes UTC d'une journée calendaire Paris `YYYY-MM-DD` : `[start, end)`.
 *
 * Sert à compter ce qui s'est réellement passé CE jour-là (inscriptions…), au lieu
 * d'une fenêtre glissante de 24 h qui déborde sur la veille.
 *
 * Deux passes pour l'offset : la première l'estime depuis minuit UTC, la seconde
 * le recalcule au voisinage du minuit parisien trouvé. Nécessaire les nuits de
 * changement d'heure, où l'offset diffère de part et d'autre de minuit.
 */
export function parisDayRange(day: string): { start: Date; end: Date } {
  const resolve = (naiveUtcMs: number): Date => {
    const firstPass = new Date(naiveUtcMs - parisOffsetMinutes(new Date(naiveUtcMs)) * 60_000);
    return new Date(naiveUtcMs - parisOffsetMinutes(firstPass) * 60_000);
  };

  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  return { start: resolve(naive), end: resolve(naive + 86_400_000) };
}
