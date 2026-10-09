import { describe, it, expect } from 'vitest';
import { AI_MODELS, costUsd, MODEL_PRICING, FALLBACK_RATE } from './ai-pricing.const';

describe('ai-pricing — costUsd', () => {
  it('Haiku coûte moins cher que Sonnet pour le même volume', () => {
    const haiku = costUsd('claude-haiku-5-5', 1_000_000, 1_000_000, 50_000);
    const sonnet = costUsd('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(haiku).toBeLessThan(sonnet);
    expect(haiku).toBeCloseTo(0.6, 6); // 0,10 (input) + 0,50 (output)
    expect(sonnet).toBeCloseTo(18, 6); // 3 (input) + 15 (output)
  });

  it('Haiku 5.5 : tarif de base jusqu’à 100K tokens de prompt inclus', () => {
    expect(costUsd('claude-haiku-5-5', 100_000, 2_000)).toBeCloseTo(
      (100_000 * 0.1 + 2_000 * 0.5) / 1_000_000,
      9,
    );
  });

  it('Haiku 5.5 : 0,50 $ / 2,50 $ sur tout l’appel au-delà de 100K tokens de prompt', () => {
    expect(costUsd('claude-haiku-5-5', 100_001, 1_000)).toBeCloseTo(
      (100_001 * 0.5 + 1_000 * 2.5) / 1_000_000,
      9,
    );
    // Le palier se juge sur le prompt entier : peu de tokens hors cache, gros cache lu.
    expect(costUsd('claude-haiku-5-5', 1_000, 1_000, 150_000)).toBeCloseTo(
      (1_000 * 0.5 + 1_000 * 2.5) / 1_000_000,
      9,
    );
  });

  it('modèle inconnu → tarif fallback (le plus cher), jamais sous-estimé', () => {
    const unknown = costUsd('mystery-model-9', 1_000_000, 1_000_000);
    const fallback = (FALLBACK_RATE.input + FALLBACK_RATE.output);
    expect(unknown).toBeCloseTo(fallback, 6);
    expect(MODEL_PRICING['mystery-model-9']).toBeUndefined();
  });

  it('le fallback n’est moins cher qu’aucun modèle utilisé, palier long compris', () => {
    for (const model of Object.values(AI_MODELS)) {
      const rate = MODEL_PRICING[model];
      const top = rate.longPrompt ?? rate;
      expect(FALLBACK_RATE.input, model).toBeGreaterThanOrEqual(top.input);
      expect(FALLBACK_RATE.output, model).toBeGreaterThanOrEqual(top.output);
    }
  });

  it('coût proportionnel au volume', () => {
    expect(costUsd('claude-sonnet-4-6', 0, 0)).toBe(0);
    expect(costUsd('claude-sonnet-4-6', 500_000, 100_000)).toBeCloseTo(
      (500_000 * 3 + 100_000 * 15) / 1_000_000,
      6,
    );
  });

  it('chaque modèle utilisé a son tarif (sinon le coût IA affiché serait faux)', () => {
    for (const model of Object.values(AI_MODELS)) {
      expect(MODEL_PRICING[model], model).toBeDefined();
    }
  });
});
