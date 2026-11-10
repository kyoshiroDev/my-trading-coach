/** Calendrier économique : formes JSON de /eco-calendar (front + API). */

export interface EcoEvent {
  date?: string;
  time: string;
  name: string;
  impact: 'high' | 'medium';
  country: string;
  currency: string;
  actual: number | null;
  estimate: number | null;
  previous: number | null;
  isReleased: boolean;
  unit?: string | null;
  /**
   * false = intervention sans résultat chiffré (discours, conférence de presse, minutes) : jamais
   * « publiée », jamais analysée. Absent (données figées) = annonce chiffrée.
   */
  hasResult?: boolean;
  /**
   * released = résultat publié ; past = heure passée sans résultat (intervention terminée, ou
   * chiffre jamais fourni) ; upcoming = à venir. Absent (données figées) = déduire de isReleased.
   */
  status?: EcoEventStatus;
}

export type EcoEventStatus = 'upcoming' | 'released' | 'past';

export interface EcoAnalysis {
  summary: string;
  recommendation: string;
  assetImpacts: { asset: string; sentiment: 'bull' | 'bear' | 'neutral'; reason: string }[];
}

/**
 * Ligne de briefing d'une annonce forte du jour : factuelle, calculée en code (heure, prévision,
 * précédent, actifs du trader dans la devise). Aucune direction, aucun conseil.
 */
export interface EcoBriefingLine {
  time: string;
  name: string;
  currency: string;
  estimate: number | null;
  previous: number | null;
  unit: string | null;
  /** Actifs récents du trader libellés dans la devise de l'annonce. */
  assets: string[];
  status: EcoEventStatus;
  /** Phrase prête à afficher : « 14:30 · NFP (USD) · prévision 180K · précédent 150K · concerne NQ. » */
  text: string;
}
