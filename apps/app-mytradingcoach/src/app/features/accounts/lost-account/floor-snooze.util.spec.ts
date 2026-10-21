import { describe, expect, it } from 'vitest';
import { FLOOR_SNOOZE_KEY, FLOOR_SNOOZE_MS, floorBannerAccounts, readSnoozes, snoozeFloor } from './floor-snooze.util';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

const NOW = 1_800_000_000_000;

describe('« Pas maintenant » (masquage 24 h par compte)', () => {
  it('masque CE compte pour 24 h et l\'enregistre', () => {
    const st = memoryStorage();
    const s = snoozeFloor(st, 'a1', NOW);
    expect(s).toEqual({ a1: NOW + FLOOR_SNOOZE_MS });
    expect(JSON.parse(st.data[FLOOR_SNOOZE_KEY])).toEqual({ a1: NOW + FLOOR_SNOOZE_MS });
  });

  it('les masquages expirés disparaissent à la lecture', () => {
    const st = memoryStorage({ [FLOOR_SNOOZE_KEY]: JSON.stringify({ old: NOW - 1, live: NOW + 10 }) });
    expect(readSnoozes(st, NOW)).toEqual({ live: NOW + 10 });
  });

  it('stockage absent, illisible ou qui lève → aucun masquage, sans erreur', () => {
    expect(readSnoozes(null, NOW)).toEqual({});
    expect(readSnoozes(memoryStorage({ [FLOOR_SNOOZE_KEY]: '{pas du json' }), NOW)).toEqual({});
    const throwing = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('plein'); } };
    expect(readSnoozes(throwing, NOW)).toEqual({});
    expect(snoozeFloor(throwing, 'a1', NOW)).toEqual({ a1: NOW + FLOOR_SNOOZE_MS });
  });
});

describe('floorBannerAccounts', () => {
  const accounts = [
    { id: 'a', floorReached: true },
    { id: 'b', floorReached: false },
    { id: 'c', floorReached: true },
    { id: 'd' },
  ];

  it('seulement les comptes au plancher estimé atteint, hors masqués', () => {
    expect(floorBannerAccounts(accounts, {}, NOW).map((a) => a.id)).toEqual(['a', 'c']);
    expect(floorBannerAccounts(accounts, { a: NOW + 1 }, NOW).map((a) => a.id)).toEqual(['c']);
  });

  it('un masquage échu ne cache plus le bandeau', () => {
    expect(floorBannerAccounts(accounts, { a: NOW }, NOW).map((a) => a.id)).toEqual(['a', 'c']);
  });
});
