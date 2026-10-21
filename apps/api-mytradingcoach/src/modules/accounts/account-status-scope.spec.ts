import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  INACTIVE_ACCOUNT_STATUSES,
  activeAccountsWhere,
  excludesInactiveAccounts,
  inactiveAccountsTradeSql,
  inactiveAccountsTradeWhere,
  parseIncludeInactive,
} from './account-status-scope';

/**
 * Règle unique du compte perdu : échoués et archivés hors des agrégats « tous les comptes »,
 * validés comptés, compte précis toujours lisible. L'équivalence Prisma ↔ SQL sur une vraie base
 * est vérifiée par `account-status-scope.int-spec.ts`.
 */
describe('account-status-scope', () => {
  it('inactifs = FAILED et ARCHIVED ; PASSED et ACTIVE comptés', () => {
    expect([...INACTIVE_ACCOUNT_STATUSES].sort()).toEqual(['ARCHIVED', 'FAILED']);
  });

  it('exclut par défaut, pas pour un compte précis ni avec includeInactive', () => {
    expect(excludesInactiveAccounts({})).toBe(true);
    expect(excludesInactiveAccounts({ accountId: 'acc-1' })).toBe(false);
    expect(excludesInactiveAccounts({ includeInactive: true })).toBe(false);
    expect(excludesInactiveAccounts({ accountId: 'acc-1', includeInactive: true })).toBe(false);
  });

  it('Prisma : trades sans compte gardés, comptes inactifs exclus', () => {
    expect(inactiveAccountsTradeWhere()).toEqual({
      OR: [{ accountId: null }, { account: { status: { notIn: ['FAILED', 'ARCHIVED'] } } }],
    });
    expect(inactiveAccountsTradeWhere({ accountId: 'acc-1' })).toEqual({});
    expect(inactiveAccountsTradeWhere({ includeInactive: true })).toEqual({});
  });

  it('SQL : même règle, statuts en paramètres liés', () => {
    const sql = inactiveAccountsTradeSql();
    const text = sql.text.replace(/\s+/g, ' ');
    expect(text).toContain('t."accountId" IS NULL OR NOT EXISTS');
    expect(text).toContain('"TradingAccount" ia');
    expect(sql.values).toEqual(['FAILED', 'ARCHIVED']);
    expect(inactiveAccountsTradeSql({ accountId: 'acc-1' })).toBe(Prisma.empty);
    expect(inactiveAccountsTradeSql({ includeInactive: true })).toBe(Prisma.empty);
  });

  it('comptes d’un contexte global : actifs et validés seulement', () => {
    expect(activeAccountsWhere()).toEqual({ status: { notIn: ['FAILED', 'ARCHIVED'] } });
    expect(activeAccountsWhere({ includeInactive: true })).toEqual({});
  });

  it.each([
    ['true', true], ['1', true], [true, true],
    [undefined, false], ['false', false], ['0', false], ['', false], ['yes', false],
  ])('includeInactive=%s → %s', (value, expected) => {
    expect(parseIncludeInactive(value)).toBe(expected);
  });
});
