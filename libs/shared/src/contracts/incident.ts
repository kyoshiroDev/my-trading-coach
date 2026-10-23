/**
 * Autopsie d'un compte grillé (#669) : formes renvoyées par `GET /accounts/:id/incidents…`.
 * Chronologie et constats sont des faits recalculés à chaque lecture ; seule l'analyse IA
 * (Premium) est conservée. Distances et limites = estimations MyTradingCoach.
 */

/** `drawdown` : plancher · `daily_loss` : perte du jour · `manual` : compte marqué échoué sans casse détectée. */
export type AccountIncidentKind = 'drawdown' | 'daily_loss' | 'manual';

export interface AccountIncidentSummary {
  id: string;
  kind: AccountIncidentKind;
  /** Séance analysée, `AAAA-MM-JJ`. */
  tradeDate: string;
  source: 'live' | 'sync' | 'manual';
  createdAt: string;
  aiGeneratedAt: string | null;
}

export type IncidentTimelineEntry =
  | {
      type: 'trade';
      at: string;
      tradeId: string;
      asset: string;
      side: string;
      quantity: number | null;
      /** P&L net du trade. */
      net: number;
      /** Marge estimée après ce trade, null sans relevé. */
      distanceAfter: number | null;
      /** Trade daté après une alerte de la séance. */
      afterAlert: boolean;
    }
  | {
      type: 'alert';
      at: string;
      label: string;
      /** Minutes jusqu'au trade suivant, null s'il n'y en a pas. */
      nextTradeMinutes: number | null;
    };

export type IncidentAiState =
  | { status: 'ready'; text: string; generatedAt: string }
  /** Gratuit : analyse réservée au Premium. */
  | { status: 'locked' }
  /** Premium, pas encore générée : à demander à `GET …/analysis`. */
  | { status: 'pending' }
  /** IA coupée, en cours ailleurs ou en échec : rien d'inventé. */
  | { status: 'unavailable' };

export interface AccountIncidentReport {
  id: string;
  kind: AccountIncidentKind;
  tradeDate: string;
  source: 'live' | 'sync' | 'manual';
  createdAt: string;
  /** Drawdown max ou perte du jour autorisée, null pour un échec marqué à la main. */
  limit: number | null;
  account: { id: string; label: string; currency: string; status: 'ACTIVE' | 'PASSED' | 'FAILED' | 'ARCHIVED' };
  /** « Ce n'est pas un échec » remettra le compte en actif. */
  canReactivate: boolean;
  kpis: {
    net: number;
    trades: number;
    maxQuantity: number | null;
    firstQuantity: number | null;
    /** Marge estimée avant le premier trade. */
    startDistance: number | null;
  };
  /** Distance à la limite : départ (`at: null`) puis un point par trade. */
  series: { at: string | null; distance: number }[];
  timeline: IncidentTimelineEntry[];
  findings: string[];
  ai: IncidentAiState;
  /** L'heure d'entrée n'est pas enregistrée : la distance est une estimation. */
  estimatedDistance: true;
  disclaimer: string;
}

export interface DismissIncidentResult {
  dismissed: true;
  reactivated: boolean;
}
