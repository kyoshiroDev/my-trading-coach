import type { EcoAnalysis, EcoEvent } from '@mtc/shared';

export interface EcoResultAnalysis {
  interpretation: string;
  assetSentiments: { asset: string; sentiment: 'bull' | 'bear' | 'neutral'; shortReason: string }[];
}

export interface EcoCalendarData {
  events: EcoEvent[];
  analysis: EcoAnalysis;
  userAssets: string[];
  pinnedEvents?: string[];
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

