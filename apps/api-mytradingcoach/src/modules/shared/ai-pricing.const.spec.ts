import { describe, it, expect } from 'vitest';
import { costUsd, MODEL_PRICING, FALLBACK_RATE } from './ai-pricing.const';

describe('ai-pricing — costUsd', () => {
  it('Haiku coûte moins cher que Sonnet pour le même volume', () => {
    const haiku = costUsd('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    const sonnet = costUsd('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(haiku).toBeLessThan(sonnet);
    expect(haiku).toBeCloseTo(6, 6);   // 1 (input) + 5 (output)
    expect(sonnet).toBeCloseTo(18, 6); // 3 (input) + 15 (output)
  });

  it('modèle inconnu → tarif fallback (le plus cher), jamais sous-estimé', () => {
    const unknown = costUsd('mystery-model-9', 1_000_000, 1_000_000);
    const fallback = (FALLBACK_RATE.input + FALLBACK_RATE.output);
    expect(unknown).toBeCloseTo(fallback, 6);
    expect(MODEL_PRICING['mystery-model-9']).toBeUndefined();
  });

  it('coût proportionnel au volume', () => {
    expect(costUsd('claude-sonnet-4-6', 0, 0)).toBe(0);
    expect(costUsd('claude-sonnet-4-6', 500_000, 100_000)).toBeCloseTo(
      (500_000 * 3 + 100_000 * 15) / 1_000_000,
      6,
    );
  });
});
