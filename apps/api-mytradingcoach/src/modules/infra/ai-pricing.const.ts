import type Anthropic from '@anthropic-ai/sdk';

/**
 * Modèles Claude utilisés par l'API, par usage. Changer de modèle se fait ICI uniquement
 * (et son tarif dans MODEL_PRICING ci-dessous, vérifié par ai-pricing.const.spec.ts).
 */
export const AI_MODELS = {
  /** Analyses personnelles : coach, débrief, patterns, insights, import CSV inconnu. */
  analysis: 'claude-sonnet-4-6',
  /** Tâches courtes et fréquentes : traductions, contexte marché, calendrier éco. */
  fast: 'claude-haiku-5-5',
} as const;

/**
 * Réglage « sans réflexion » par modèle, appliqué par AnthropicClientService quand l'appel ne
 * précise pas `thinking`. Haiku 5.5 réfléchit par défaut (Haiku 4.5 non) : la réflexion
 * consomme `max_tokens` (nos plafonds sont dimensionnés pour la seule réponse) et se paie
 * en tokens de sortie. On garde donc le comportement d'avant.
 */
export const AI_THINKING_OFF: Record<string, Anthropic.ThinkingConfigParam> = {
  [AI_MODELS.fast]: { type: 'disabled' },
};

// Tarifs API Anthropic en USD par million de tokens (source : https://www.anthropic.com/pricing).
export interface ModelRate {
  input: number;
  output: number;
  /** Tarif appliqué à tout l'appel quand le prompt dépasse `aboveInputTokens` (Haiku 5.5). */
  longPrompt?: { aboveInputTokens: number; input: number; output: number };
}

export const MODEL_PRICING: Record<string, ModelRate> = {
  [AI_MODELS.analysis]: { input: 3, output: 15 },
  [AI_MODELS.fast]: {
    input: 0.1,
    output: 0.5,
    longPrompt: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 },
  },
};

// Fallback prudent (le plus cher) si un modèle inconnu apparaît, pour ne jamais sous-estimer.
export const FALLBACK_RATE: ModelRate = { input: 3, output: 15 };

/**
 * @param promptTokens taille totale du prompt (entrée + cache lu + cache écrit), qui choisit le
 *                     palier de prix. Par défaut `inputTokens`.
 */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  promptTokens = inputTokens,
): number {
  const base = MODEL_PRICING[model] ?? FALLBACK_RATE;
  const rate =
    base.longPrompt && promptTokens > base.longPrompt.aboveInputTokens ? base.longPrompt : base;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
