import { describe, it, expect } from 'vitest';
import { ACCOUNT_LIMITS } from './pricing';
import { PLAN_BENEFITS } from './plan-benefits';

describe('PLAN_BENEFITS', () => {
  const all = [...PLAN_BENEFITS.free, ...PLAN_BENEFITS.premium];

  it('4 à 6 lignes par plan, ids uniques', () => {
    for (const list of [PLAN_BENEFITS.free, PLAN_BENEFITS.premium]) {
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(6);
    }
    expect(new Set(all.map((b) => b.id)).size).toBe(all.length);
  });

  it('aucune fonction non livrée ni hors cible : ni crypto, ni PDF mensuel', () => {
    for (const b of all) expect(b.text, b.id).not.toMatch(/crypto|mensuel|PDF/i);
  });

  it('aucune promesse : ni « le seul », ni « le premier », ni gain promis', () => {
    for (const b of all) expect(b.text, b.id).not.toMatch(/le seul|le premier|gagne|garanti/i);
  });

  it('les alertes et l’anti-tilt disent leur condition réelle (app ouverte, Tradovate connecté)', () => {
    for (const id of ['loss_alerts', 'anti_tilt']) {
      const text = PLAN_BENEFITS.premium.find((b) => b.id === id)!.text;
      expect(text, id).toContain('app ouverte');
      expect(text, id).toContain('Tradovate connecté');
    }
  });

  it('le nombre de comptes gratuits vient de ACCOUNT_LIMITS', () => {
    expect(PLAN_BENEFITS.free.find((b) => b.id === 'prop_firm_live')!.text).toMatch(new RegExp(`^${ACCOUNT_LIMITS.free} compte`));
  });
});
