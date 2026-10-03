import { describe, it, expect } from 'vitest';
import { progressTitle, requirementLabel } from './account-progress.util';
import type { AccountProgress, ProgressRequirement } from '../../core/api/accounts.api';

const p = (o: Partial<AccountProgress>): AccountProgress =>
  ({ kind: 'objective', remaining: 0, done: false, requirements: [], cycleAfter: null, unconfirmed: false, ...o });
const r = (o: Partial<ProgressRequirement>): ProgressRequirement =>
  ({ key: 'profit', met: false, current: 0, required: 0, unit: 'usd', ...o });

describe('progression — libellés', () => {
  it('titre : reste à faire, ou fait', () => {
    expect(progressTitle(p({ remaining: 1_240 }), 'USD')).toBe('Objectif : il te reste $1,240');
    expect(progressTitle(p({ done: true }), 'USD')).toBe('Objectif atteint');
    expect(progressTitle(p({ kind: 'payout', remaining: 400 }), 'USD')).toBe('Prochain payout : il te manque $400');
    expect(progressTitle(p({ kind: 'payout', done: true }), 'USD')).toBe('Payout possible');
    expect(progressTitle(p({ remaining: 0 }), 'USD')).toBe('Objectif : profit atteint, conditions restantes');
  });

  it('exigences en clair', () => {
    expect(requirementLabel(r({ current: 1_800, required: 3_000 }), 'USD')).toBe('Profit $1,800 / $3,000');
    expect(requirementLabel(r({ key: 'trading_days', current: 2, required: 4, unit: 'days' }), 'USD')).toBe('Jours tradés 2 / 4');
    expect(requirementLabel(r({ key: 'consistency', current: 0.645, required: 0.5, unit: 'pct' }), 'USD')).toBe('Meilleur jour 65 % du profit (max 50 %)');
    expect(requirementLabel(r({ key: 'winning_days', current: 3, required: 5, unit: 'days', threshold: 150 }), 'USD')).toBe('Jours ≥ $150 : 3 / 5');
    expect(requirementLabel(r({ key: 'winning_days', current: 1, required: 5, unit: 'days', threshold: null }), 'USD')).toBe('Jours gagnants : 1 / 5');
    expect(requirementLabel(r({ key: 'safety_net', current: 1_700, required: 2_100 }), 'USD')).toBe('Solde $1,700 / $2,100 (seuil de retrait)');
  });
});
