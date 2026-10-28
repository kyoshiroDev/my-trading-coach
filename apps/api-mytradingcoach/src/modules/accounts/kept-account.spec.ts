import { describe, it, expect } from 'vitest';
import { AccountStatus } from '@prisma/client';
import { overFreeLimitIds, resolveKeptAccountId } from './kept-account';

const d = (day: number) => new Date(Date.UTC(2026, 9, day));
const rows = [
  { id: 'b', status: AccountStatus.ACTIVE, createdAt: d(5) },
  { id: 'a', status: AccountStatus.ACTIVE, createdAt: d(1) },
  { id: 'c', status: AccountStatus.ACTIVE, createdAt: d(9) },
  { id: 'old', status: AccountStatus.ARCHIVED, createdAt: d(0) },
];

describe('resolveKeptAccountId (#769)', () => {
  it('le compte choisi s’il est encore actif', () => {
    expect(resolveKeptAccountId(rows, 'c')).toBe('c');
  });
  it('sinon le plus ancien compte ACTIVE (choix absent, périmé ou compte archivé)', () => {
    expect(resolveKeptAccountId(rows, null)).toBe('a');
    expect(resolveKeptAccountId(rows, 'supprime')).toBe('a');
    expect(resolveKeptAccountId(rows, 'old')).toBe('a');
  });
  it('aucun compte actif → null', () => {
    expect(resolveKeptAccountId([rows[3]], null)).toBeNull();
  });
});

describe('overFreeLimitIds (#769)', () => {
  it('gratuit : tous les ACTIVE sauf le compte gardé ; les comptes inactifs ne comptent pas', () => {
    expect([...overFreeLimitIds(rows, 'c', false)].sort()).toEqual(['a', 'b']);
  });
  it('Premium : aucun compte en trop', () => {
    expect(overFreeLimitIds(rows, null, true).size).toBe(0);
  });
  it('un seul compte actif : rien en trop', () => {
    expect(overFreeLimitIds([rows[0], rows[3]], null, false).size).toBe(0);
  });
});
