/**
 * Modèles Claude utilisés par l'API, par usage. Changer de modèle se fait ICI uniquement
 * (et son tarif dans MODEL_PRICING ci-dessous, vérifié par ai-pricing.const.spec.ts).
 */
export const AI_MODELS = {
  /** Analyses personnelles : coach, débrief, patterns, insights, import CSV inconnu. */
  analysis: 'claude-sonnet-4-6',
  /** Tâches courtes et fréquentes : traductions, contexte marché, calendrier éco. */
  fast: 'claude-haiku-4-5-20251001',
} as const;

// Tarifs API Anthropic en USD par million de tokens (source : https://www.anthropic.com/pricing).
export interface ModelRate {
  input: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelRate> = {
  [AI_MODELS.analysis]: { input: 3, output: 15 },
  [AI_MODELS.fast]: { input: 1, output: 5 },
};

// Fallback prudent (le plus cher) si un modèle inconnu apparaît, pour ne jamais sous-estimer.
export const FALLBACK_RATE: ModelRate = { input: 3, output: 15 };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = MODEL_PRICING[model] ?? FALLBACK_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
