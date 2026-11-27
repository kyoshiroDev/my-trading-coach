import { describe, expect, it } from 'vitest';
import { floorLockText } from './floor-lock.util';

const money = (v: number) => `USD ${v}`;
const base = { locked: false, lockedBy: null, payoutLockedSince: null, locksAt: 52_100, lockedFloor: 50_100, locksOnFirstPayout: null } as const;

describe('floorLockText (#696)', () => {
  it('seuil seulement', () => {
    expect(floorLockText(base, money)).toBe('se fige à USD 50100 quand le solde atteint USD 52100');
  });

  it('seuil ou première demande de payout', () => {
    expect(floorLockText({ ...base, locksOnFirstPayout: 'request' }, money)).toBe(
      'se fige à USD 50100 quand le solde atteint USD 52100, ou dès ta première demande de payout',
    );
  });

  it('sans seuil, au premier payout approuvé (MFF Pro)', () => {
    expect(floorLockText({ ...base, locksAt: null, locksOnFirstPayout: 'approval' }, money)).toBe(
      'se fige à USD 50100 dès ton premier payout approuvé',
    );
  });

  it('figé par le seuil ou depuis un payout', () => {
    expect(floorLockText({ ...base, locked: true, lockedBy: 'threshold' }, money)).toBe('figé');
    expect(
      floorLockText({ ...base, locked: true, lockedBy: 'payout', payoutLockedSince: '2026-10-02', locksOnFirstPayout: 'payout' }, money),
    ).toBe('figé depuis ton payout du 02/10/2026');
  });

  it('Topstep XFA (#1247) : niveau figé à 0, jamais pris pour une absence', () => {
    expect(floorLockText({ ...base, locksAt: 2_000, lockedFloor: 0, locksOnFirstPayout: 'payout' }, money)).toBe(
      'se fige à USD 0 quand le solde atteint USD 2000, ou dès ton premier payout',
    );
  });

  it('plan qui ne fige jamais : rien', () => {
    expect(floorLockText({ ...base, locksAt: null, lockedFloor: null }, money)).toBeNull();
  });
});
