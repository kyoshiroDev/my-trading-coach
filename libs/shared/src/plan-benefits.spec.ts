import { describe, it, expect } from 'vitest';
import { ACCOUNT_LIMITS } from './pricing';
import { PLAN_BENEFITS } from './plan-benefits';
import { SIGNUP_PITCH_POINTS } from './signup-pitch';
import { PROP_FIRM_COUNT } from './prop-firm-rules/catalog-count';

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

  it('les alertes et l’anti-tilt disent leur condition réelle (app ouverte ou notification, Tradovate connecté)', () => {
    for (const id of ['loss_alerts', 'anti_tilt']) {
      const text = PLAN_BENEFITS.premium.find((b) => b.id === id)!.text;
      expect(text, id).toContain('app ouverte ou en notification');
      expect(text, id).toContain('Tradovate connecté');
    }
  });

  it('le nombre de comptes gratuits vient de ACCOUNT_LIMITS', () => {
    expect(PLAN_BENEFITS.free.find((b) => b.id === 'prop_firm_live')!.text).toMatch(new RegExp(`^${ACCOUNT_LIMITS.free} compte`));
  });
});

describe('SIGNUP_PITCH_POINTS', () => {
  it('une ligne Premium = une ligne de PLAN_BENEFITS.premium, et rien d’autre n’est marqué Premium', () => {
    const premiumIds = PLAN_BENEFITS.premium.map((b) => b.id);
    for (const p of SIGNUP_PITCH_POINTS) {
      if (p.premium) expect(premiumIds, p.text).toContain(p.benefitId);
      else expect(p.benefitId, p.text).toBeUndefined();
    }
    expect(SIGNUP_PITCH_POINTS.filter((p) => p.premium).map((p) => p.benefitId)).toEqual(['anti_tilt', 'weekly_debrief']);
  });

  it('l’alerte après une perte dit sa condition réelle, comme PLAN_BENEFITS', () => {
    const text = SIGNUP_PITCH_POINTS.find((p) => p.benefitId === 'anti_tilt')!.text;
    expect(text).toContain('app ouverte ou en notification');
    expect(text).toContain('Tradovate connecté');
  });

  it('le nombre de prop firms vient du catalogue', () => {
    expect(SIGNUP_PITCH_POINTS.some((p) => p.text.includes(`${PROP_FIRM_COUNT} prop firms`))).toBe(true);
  });
});
