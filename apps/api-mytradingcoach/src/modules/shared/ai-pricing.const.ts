// Tarifs API Anthropic en USD par million de tokens.
// ⚠️ À VÉRIFIER / METTRE À JOUR depuis https://www.anthropic.com/pricing (source de vérité).
// Sonnet 4.6 = valeurs déjà utilisées dans l'ancien logger. Haiku 4.5 = à confirmer.
export interface ModelRate {
  input: number;
  output: number;
}

export const MODEL_PRICING: Record<string, ModelRate> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 }, // ⚠️ confirmer le tarif courant
};

// Fallback prudent (le plus cher) si un modèle inconnu apparaît, pour ne jamais sous-estimer.
export const FALLBACK_RATE: ModelRate = { input: 3, output: 15 };

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rate = MODEL_PRICING[model] ?? FALLBACK_RATE;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
