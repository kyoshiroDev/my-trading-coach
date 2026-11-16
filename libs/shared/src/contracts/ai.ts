/** Analyse IA des insights : formes JSON de /ai/insights et /ai/cooldown (front + API). */

/** Type d'un insight : force, faiblesse ou comportement récurrent. */
export type InsightType = 'strength' | 'weakness' | 'pattern';

/** Badge affiché sur la carte d'un insight. */
export type InsightBadge = 'Force' | 'Attention' | 'Pattern';

export interface InsightItem {
  type: InsightType;
  title: string;
  description: string;
  badge: InsightBadge;
}

/** Réponse de `POST /ai/insights`. */
export interface InsightsResponse {
  insights: InsightItem[];
  topPattern: string;
  emotionInsight: string;
}

/**
 * Réponse de `GET /ai/cooldown` : délai restant avant la prochaine analyse et dernière analyse
 * réussie, gardée pendant ce délai (C4 #1046).
 */
export interface InsightsCooldownResponse {
  cooldownSeconds: number;
  insights: InsightsResponse | null;
}
