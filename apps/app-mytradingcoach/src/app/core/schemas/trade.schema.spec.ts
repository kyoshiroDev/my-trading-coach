import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { CreateTradeSchema } from './trade.schema';

// CSP (#1068) : la CSP de l'app n'autorise pas l'eval ; zod doit valider sans `new Function`.
describe('CreateTradeSchema sous CSP', () => {
  const valid = {
    asset: 'NQ',
    side: 'LONG',
    entry: 21000,
    setupId: 'setup-1',
    session: 'NEW_YORK',
    timeframe: '5m',
  };

  it('le chargement du schéma passe zod en validation sans eval (jitless)', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('la validation reste la même : trade valide accepté, clé inconnue retirée', () => {
    const result = CreateTradeSchema.safeParse({ ...valid, inconnue: 1, exit: null });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('inconnue');
    expect(result.data?.exit).toBeUndefined();
  });

  it('la validation reste la même : entry manquant refusé', () => {
    const result = CreateTradeSchema.safeParse({ ...valid, entry: null });
    expect(result.success).toBe(false);
  });
});
