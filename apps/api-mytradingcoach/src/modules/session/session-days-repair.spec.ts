import { describe, it, expect } from 'vitest';
import { misplacedTrades, planSessionMoves, type RepairSession, type RepairTrade } from './session-days-repair';

// Journées CME : le 10/11 va du 09/11 17:00 Chicago (23:00 UTC, heure d'hiver) au 10/11 23:00 UTC.
const S_10: RepairSession = { id: 's10', userId: 'u', accountId: 'a', startedAt: new Date('2026-11-10T14:00:00Z') };
const S_05: RepairSession = { id: 's05', userId: 'u', accountId: 'a', startedAt: new Date('2026-11-05T14:00:00Z') };
const S_05_B: RepairSession = { id: 's05b', userId: 'u', accountId: 'b', startedAt: new Date('2026-11-05T15:00:00Z') };
const S_05_ALL: RepairSession = { id: 's05all', userId: 'u', accountId: null, startedAt: new Date('2026-11-05T16:00:00Z') };
const S_05_OTHER_USER: RepairSession = { id: 's05x', userId: 'x', accountId: 'a', startedAt: new Date('2026-11-05T14:00:00Z') };

const trade = (id: string, tradedAt: string, over: Partial<RepairTrade> = {}): RepairTrade => ({
  id, userId: 'u', sessionId: 's10', accountId: 'a', tradedAt: new Date(tradedAt), emotion: null, ...over,
});
const map = (...s: RepairSession[]) => new Map(s.map((x) => [x.id, x]));

describe('misplacedTrades (#1000)', () => {
  it('garde les trades de la journée CME de la séance, même la veille au soir après 17:00 Chicago', () => {
    const ok = [trade('t1', '2026-11-10T20:00:00Z'), trade('t2', '2026-11-09T23:30:00Z')];
    expect(misplacedTrades(ok, map(S_10))).toEqual([]);
  });

  it('relève les trades d’une autre journée, y compris juste après la fin de la journée', () => {
    const t = [trade('old', '2026-11-05T15:00:00Z'), trade('next', '2026-11-10T23:30:00Z'), trade('ok', '2026-11-10T15:00:00Z')];
    expect(misplacedTrades(t, map(S_10)).map((x) => x.id)).toEqual(['old', 'next']);
  });
});

describe('planSessionMoves (#1000)', () => {
  it('vers la séance unique de la journée du trade, même compte', () => {
    const [m] = planSessionMoves([trade('t', '2026-11-05T15:00:00Z')], [S_10, S_05, S_05_B, S_05_OTHER_USER]);
    expect(m).toEqual({ tradeId: 't', userId: 'u', from: 's10', to: 's05', inheritedEmotion: true, ambiguous: false });
  });

  it('aucune séance ce jour-là → sorti de toute séance', () => {
    const [m] = planSessionMoves([trade('t', '2026-11-03T15:00:00Z')], [S_10, S_05]);
    expect(m).toMatchObject({ to: null, ambiguous: false });
  });

  it('plusieurs séances compatibles (dont une sans compte) → sorti, jamais deviné', () => {
    const [m] = planSessionMoves([trade('t', '2026-11-05T15:00:00Z')], [S_10, S_05, S_05_ALL]);
    expect(m).toMatchObject({ to: null, ambiguous: true });
  });

  it('deux séances du même compte le même jour → sorti, compté ambigu', () => {
    const second: RepairSession = { ...S_05, id: 's05pm', startedAt: new Date('2026-11-05T19:00:00Z') };
    const [m] = planSessionMoves([trade('t', '2026-11-05T15:00:00Z')], [S_10, S_05, second]);
    expect(m).toMatchObject({ to: null, ambiguous: true });
  });

  it('séance sans compte (ancienne donnée) : compatible avec tous les comptes', () => {
    const [m] = planSessionMoves([trade('t', '2026-11-05T15:00:00Z', { accountId: 'c' })], [S_10, S_05_ALL, S_05]);
    expect(m.to).toBe('s05all');
  });

  it('émotion saisie : rien d’hérité', () => {
    const [m] = planSessionMoves([trade('t', '2026-11-05T15:00:00Z', { emotion: 'CALM' })], [S_05]);
    expect(m.inheritedEmotion).toBe(false);
  });
});
