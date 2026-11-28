/**
 * Alertes de comportement (#602, #671) : types partagés par l'API (moteur, routes /behavior) et l'app
 * (bandeau de la Session live, Débrief hebdo, Profil). Les dates sont des `string` ISO.
 */

export type BehaviorAlertType =
  | 'A1_SIZE_OVER_PLAN'
  | 'A2_DAILY_LOSS_DISTANCE'
  | 'A3_ENTRY_DAY_STARTED'
  | 'B_REVENGE'
  | 'C1_LOSS_STREAK'
  | 'C2_OVER_DAILY_LIMIT'
  | 'C3_MARTINGALE'
  | 'D1_NEWS_WINDOW'
  | 'E1_STOP_WIDENED'
  | 'F1_EMOTION_AFTER_LOSS';

export type BehaviorAlertSeverity = 'medium' | 'high';

/**
 * Types « signal » (#671) : enregistrés en silence pour plus tard, jamais émis ni affichés, et exclus de
 * tout ce qui lit les alertes (historique, autopsie, référence, rejeu, détecteurs, anti-spam).
 */
export const BEHAVIOR_SIGNAL_TYPES: readonly BehaviorAlertType[] = ['F1_EMOTION_AFTER_LOSS'];

/** Détecteurs que le trader peut couper (« Pas pour mon style ») : le bouclier annonces a son propre réglage. */
export const BEHAVIOR_MUTABLE_DETECTORS = [
  'A1_SIZE_OVER_PLAN',
  'A2_DAILY_LOSS_DISTANCE',
  'A3_ENTRY_DAY_STARTED',
  'B_REVENGE',
  'C1_LOSS_STREAK',
  'C2_OVER_DAILY_LIMIT',
  'C3_MARTINGALE',
  'E1_STOP_WIDENED',
] as const satisfies readonly BehaviorAlertType[];
export type BehaviorMutableDetector = (typeof BEHAVIOR_MUTABLE_DETECTORS)[number];

/** Nom d'un détecteur affiché au trader (bandeau, Débrief hebdo, Profil). */
export const BEHAVIOR_DETECTOR_LABELS: Record<Exclude<BehaviorAlertType, 'F1_EMOTION_AFTER_LOSS'>, string> = {
  A1_SIZE_OVER_PLAN: 'Taille au-dessus du plan',
  A2_DAILY_LOSS_DISTANCE: 'Proche de la perte max du jour',
  A3_ENTRY_DAY_STARTED: 'Entrée avec la perte max déjà entamée',
  B_REVENGE: 'Trade de vengeance',
  C1_LOSS_STREAK: 'Pertes d’affilée',
  C2_OVER_DAILY_LIMIT: 'Au-delà de ta limite de trades',
  C3_MARTINGALE: 'Taille doublée après une perte',
  D1_NEWS_WINDOW: 'Annonce à venir',
  E1_STOP_WIDENED: 'Stop éloigné',
};

/** Événement socket `behavior:alert` (affichage, `BEHAVIOR_ALERTS_UI`). */
export interface BehaviorAlertEvent {
  id: string;
  accountId: string;
  type: BehaviorAlertType;
  severity: BehaviorAlertSeverity;
  message: string;
  context: Record<string, unknown>;
}

/** `GET /behavior/config` : l'app sait si l'affichage des alertes est allumé. */
export interface BehaviorConfig {
  uiEnabled: boolean;
}

/** Détecteur coupé par le trader (`GET /behavior/mutes`). */
export interface BehaviorMute {
  detector: BehaviorMutableDetector;
  createdAt: string;
}

/** Alerte de l'historique (`GET /behavior/alerts`) avec ce qui a suivi (trades clôturés du même compte). */
export interface BehaviorAlertHistoryItem {
  id: string;
  accountId: string;
  type: BehaviorAlertType;
  severity: BehaviorAlertSeverity;
  message: string;
  createdAt: string;
  mutedByUser: boolean;
  after: { count: number; pnl: number };
}
