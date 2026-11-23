import { describe, expect, it } from 'vitest';
import bulenox from './bulenox.json';
import oneup from './oneuptrader.json';
import phidias from './phidias.json';

/* Veille du 2026-11-22 (lot 1, #1218). À réécrire si une veille suivante change ces plans. */

interface Plan {
  id: string;
  needs_review: boolean;
  notes: string | null;
  phases: { phase: string; payout: { notes: string | null } | null }[];
}
interface Firm {
  verified_at: string;
  plans: Plan[];
}

describe('veille du 2026-11-22', () => {
  it('les trois firms relues en entier portent la date de la relecture', () => {
    for (const firm of [phidias, oneup, bulenox] as Firm[]) expect(firm.verified_at).toBe('2026-11-22');
  });

  it('OneUp : retrait prioritaire payant au-delà d’un retrait par semaine, sur les 15 plans', () => {
    const plans = (oneup as Firm).plans;
    expect(plans).toHaveLength(15);
    for (const plan of plans) {
      const funded = plan.phases.find((p) => p.phase === 'funded');
      expect(funded?.payout?.notes).toContain('chaque retrait suivant dans la même semaine coûte 10 %');
    }
  });

  it('Bulenox : Qualification confirmée par le centre d’aide anglais, Momentum toujours à revoir', () => {
    const plans = (bulenox as Firm).plans;
    const qualification = plans.filter((p) => p.id.startsWith('bulenox-qualification-'));
    expect(qualification).toHaveLength(8);
    for (const plan of qualification) {
      expect(plan.needs_review).toBe(false);
      expect(JSON.stringify(plan)).not.toContain('traduction française');
    }
    for (const plan of plans.filter((p) => p.id.startsWith('bulenox-momentum-'))) expect(plan.needs_review).toBe(true);
  });
});
