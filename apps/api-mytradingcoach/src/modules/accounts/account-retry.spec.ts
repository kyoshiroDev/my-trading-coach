import { describe, it, expect } from 'vitest';
import { AccountStatus, AccountType, DrawdownType, PlanLinkChoice, type TradingAccount } from '@prisma/client';
import { attemptBase, isFloorReached, nextAttemptLabel, retryAccountData } from './account-retry';

describe('nextAttemptLabel (libellé de la nouvelle tentative)', () => {
  it.each([
    ['Apex 50K #1', ['Apex 50K #1'], 'Apex 50K #2'],
    ['Apex 50K', ['Apex 50K'], 'Apex 50K #2'],
    // Plus grand numéro existant + 1, même depuis une tentative plus ancienne.
    ['Apex 50K #1', ['Apex 50K #1', 'Apex 50K #2', 'Apex 50K #3'], 'Apex 50K #4'],
    ['Apex 50K #2', ['Apex 50K', 'Apex 50K #2'], 'Apex 50K #3'],
    // Trou dans la numérotation : on ne réutilise pas un numéro libre, on dépasse le plus grand.
    ['Apex 50K #1', ['Apex 50K #1', 'Apex 50K #5'], 'Apex 50K #6'],
    // Sans casse ni espaces de bord.
    ['Apex 50K #1', ['apex 50k #1', '  APEX 50K #4  '], 'Apex 50K #5'],
    // Autres bases ignorées (préfixe commun, autre firme).
    ['Apex 50K #1', ['Apex 50K #1', 'Apex 50K Rithmic #9', 'Topstep 50K #7'], 'Apex 50K #2'],
    ['Lucid 25K   #3 ', ['Lucid 25K   #3 '], 'Lucid 25K #4'],
  ])('%s parmi %j → %s', (label, existing, expected) => {
    expect(nextAttemptLabel(label, existing)).toBe(expected);
  });

  it('base sans suffixe', () => {
    expect(attemptBase('Apex 50K #12')).toBe('Apex 50K');
    expect(attemptBase('Compte #principal')).toBe('Compte #principal');
  });
});

const failed: TradingAccount = {
  id: 'acc-old',
  userId: 'u1',
  label: 'Apex 50K #1',
  broker: 'Apex',
  type: AccountType.EVALUATION,
  status: AccountStatus.FAILED,
  accountSize: 50_000,
  currency: 'USD',
  startingBalance: 50_000,
  profitTarget: 3_000,
  maxDrawdown: 2_500,
  drawdownType: DrawdownType.TRAILING,
  platform: 'rithmic',
  lastPayoutAt: new Date('2026-09-01T00:00:00.000Z'),
  propFirmPlanId: 'plan-apex-50k',
  planLinkChoice: null,
  unlistedFirm: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
} as TradingAccount;

describe('retryAccountData (contenu de la nouvelle tentative)', () => {
  it('même firme, même plan, même taille, mêmes règles ; nouveau libellé', () => {
    expect(retryAccountData(failed, 'Apex 50K #2')).toEqual({
      userId: 'u1',
      label: 'Apex 50K #2',
      broker: 'Apex',
      type: AccountType.EVALUATION,
      accountSize: 50_000,
      currency: 'USD',
      startingBalance: 50_000,
      profitTarget: 3_000,
      maxDrawdown: 2_500,
      drawdownType: DrawdownType.TRAILING,
      platform: 'rithmic',
      propFirmPlanId: 'plan-apex-50k',
      planLinkChoice: null,
      unlistedFirm: null,
    });
  });

  it('jamais copiés : id, statut, dernier payout, dates (le compte repart de zéro)', () => {
    const data = retryAccountData({ ...failed, planLinkChoice: PlanLinkChoice.UNLISTED, unlistedFirm: 'MaFirm' }, 'x');
    for (const k of ['id', 'status', 'lastPayoutAt', 'createdAt', 'updatedAt']) expect(data).not.toHaveProperty(k);
    expect(data).toMatchObject({ planLinkChoice: PlanLinkChoice.UNLISTED, unlistedFirm: 'MaFirm' });
  });
});

describe('isFloorReached (détection, aucun statut changé)', () => {
  const active = { status: AccountStatus.ACTIVE };
  it.each([
    ['actif + marge négative (plan ou règles saisies)', active, { margin: -12 }, true],
    ['actif + marge nulle', active, { margin: 0 }, true],
    ['actif + marge positive', active, { margin: 0.01 }, false],
    ['sans règle de perte maximale (aucun drawdown calculé)', active, null, false],
    ['déjà échoué', { ...active, status: AccountStatus.FAILED }, { margin: -500 }, false],
    ['validé', { ...active, status: AccountStatus.PASSED }, { margin: -500 }, false],
    ['archivé', { ...active, status: AccountStatus.ARCHIVED }, { margin: -500 }, false],
  ])('%s → %s', (_l, account, drawdown, expected) => {
    expect(isFloorReached(account, drawdown)).toBe(expected);
  });
});
