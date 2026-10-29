/**
 * Carte « Streak & activité » de Score, calculée sur les vraies données (décisions du 25/10/2026) :
 * - pastilles = les 35 derniers jours OUVRÉS (lundi à vendredi), aujourd'hui compris s'il est ouvré ;
 *   les week-ends n'apparaissent pas (marchés futures fermés) ;
 * - intensité = nombre de trades du jour : 0 · 1 · 2-3 · 4-5 · 6 et plus → niveaux 0 à 4 ;
 * - série actuelle = jours ouvrés consécutifs avec au moins un trade. Le week-end ne la casse pas, et
 *   aujourd'hui sans trade non plus (la journée n'est pas finie) : elle s'arrête au premier jour ouvré
 *   PASSÉ sans trade.
 * Dates en YYYY-MM-DD, journées Paris (mêmes clés que `GET /analytics/activity/range`).
 */

export const JOURS_PASTILLES = 35;

export type NiveauActivite = 0 | 1 | 2 | 3 | 4;

export interface Pastille {
  date: string;
  trades: number;
  niveau: NiveauActivite;
}

export interface Streak {
  pastilles: Pastille[];
  serie: number;
}

// Midi UTC : l'arithmétique de jours ne bascule jamais à cause d'un changement d'heure.
const versDate = (jour: string) => new Date(`${jour}T12:00:00Z`);
const versJour = (d: Date) => d.toISOString().slice(0, 10);
const estOuvre = (jour: string) => {
  const j = versDate(jour).getUTCDay();
  return j !== 0 && j !== 6;
};

/** Jour calendaire décalé de `n` jours (négatif : vers le passé). */
export function decalerJour(jour: string, n: number): string {
  const d = versDate(jour);
  d.setUTCDate(d.getUTCDate() + n);
  return versJour(d);
}

/** Les `n` derniers jours ouvrés jusqu'à `aujourdhui` inclus, du plus ancien au plus récent. */
export function joursOuvres(aujourdhui: string, n: number): string[] {
  const jours: string[] = [];
  for (let j = aujourdhui; jours.length < n; j = decalerJour(j, -1)) if (estOuvre(j)) jours.push(j);
  return jours.reverse();
}

export function niveauActivite(trades: number): NiveauActivite {
  if (trades <= 0) return 0;
  if (trades === 1) return 1;
  if (trades <= 3) return 2;
  if (trades <= 5) return 3;
  return 4;
}

/**
 * @param jours activité par jour (seuls les jours avec trades sont attendus, les autres valent 0)
 * @param joursSerie jours ouvrés sur lesquels compter la série (du plus ancien au plus récent, se
 *   terminant à `aujourdhui`) : plus longs que la grille, pour qu'une série dépasse 35 jours.
 */
export function calculerStreak(
  jours: readonly { date: string; tradesCount: number }[],
  aujourdhui: string,
  joursSerie: readonly string[] = joursOuvres(aujourdhui, JOURS_PASTILLES),
): Streak {
  const parJour = new Map(jours.map((j) => [j.date, j.tradesCount]));
  const trades = (jour: string) => parJour.get(jour) ?? 0;

  const pastilles = joursOuvres(aujourdhui, JOURS_PASTILLES).map((date) => ({
    date,
    trades: trades(date),
    niveau: niveauActivite(trades(date)),
  }));

  let serie = 0;
  for (let i = joursSerie.length - 1; i >= 0; i--) {
    const jour = joursSerie[i];
    if (trades(jour) > 0) serie++;
    else if (jour === aujourdhui) continue; // journée en cours : pas encore un jour « sans trade »
    else break;
  }
  return { pastilles, serie };
}
