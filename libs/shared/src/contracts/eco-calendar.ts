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
