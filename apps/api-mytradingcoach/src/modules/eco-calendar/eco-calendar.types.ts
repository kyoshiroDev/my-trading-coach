import type { EcoAnalysis, EcoBriefingLine, EcoEvent } from '@mtc/shared';

// Forme partagée avec le front (#920, conformité) : plus de sentiment haussier/baissier par actif.
export type { EcoResultAnalysis } from '@mtc/shared';

export interface EcoCalendarData {
  events: EcoEvent[];
  analysis: EcoAnalysis;
  userAssets: string[];
  pinnedEvents?: string[];
  /** Annonces fortes du jour, une ligne factuelle chacune (aujourd'hui seulement). */
  briefing?: EcoBriefingLine[];
}

/** Événement brut renvoyé par l'API Financial Modeling Prep. */
export interface FmpEcoEvent {
  date: string;        // '2026-05-26 13:30:00' UTC
  event: string;
  country: string;
  currency: string;
  previous: number | null;
  estimate: number | null;
  actual: number | null;
  change: number | null;
  changePercentage: number | null;
  impact: string;      // 'High' | 'Medium' | 'Low'
  unit: string;
}

