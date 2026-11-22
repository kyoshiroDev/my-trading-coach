import { describe, expect, it } from 'vitest';
import type { TradingAccount } from '../api/accounts.api';
import { accountExposure, drawdownTone, groupByExposure, isAtRisk } from './account-exposure.util';

type Over = { id: string; status?: TradingAccount['status']; type?: TradingAccount['type']; dd?: { pct: number; breached?: boolean } | null; daily?: { pct: number; breached?: boolean } | null; plan?: string | null; unconfirmed?: boolean; choice?: TradingAccount['planLinkChoice'] };

/** Compte minimal : seuls les champs lus par l'exposition et les groupes. */
function acct(o: Over): TradingAccount {
  return {
    id: o.id, label: o.id, status: o.status ?? 'ACTIVE', type: o.type ?? 'EVALUATION',
    propFirmPlanId: o.plan === undefined ? 'plan' : o.plan, planLinkChoice: o.choice ?? null,
    metrics: {
      drawdown: o.dd ? { pct: o.dd.pct, breached: !!o.dd.breached, margin: 0, floor: 0, maxDrawdown: 0, type: 'STATIC', source: 'plan', rule: null } : null,
      dailyLoss: o.daily ? { pct: o.daily.pct, breached: !!o.daily.breached, limit: 1000, used: 0, remaining: 0, breach: 'trading_paused_for_day', basis: 'equity', startOfDay: 0, source: 'trades', approximate: false } : null,
      drawdownUnconfirmed: !!o.unconfirmed,
    },
  } as unknown as TradingAccount;
}

describe('accountExposure (#668)', () => {
  it('plus petite marge restante : la perte max du jour peut être plus serrée que le plancher', () => {
    expect(accountExposure(acct({ id: 'a', dd: { pct: 0.6 }, daily: { pct: 0.2 } }))).toEqual({ pct: 0.2, breached: false, source: 'daily' });
    expect(accountExposure(acct({ id: 'b', dd: { pct: 0.3 }, daily: { pct: 0.9 } }))?.source).toBe('drawdown');
  });

  it('dépassé = 0 ; compte gratuit (pas de perte du jour) : plancher seul', () => {
    expect(accountExposure(acct({ id: 'a', dd: { pct: 0.4, breached: true } }))).toEqual({ pct: 0, breached: true, source: 'drawdown' });
    expect(accountExposure(acct({ id: 'b', dd: { pct: 0.4 }, daily: null }))?.pct).toBe(0.4);
  });

  it('aucune marge (sans plan, ou montant non publié) : null', () => {
    expect(accountExposure(acct({ id: 'a', dd: null }))).toBeNull();
    expect(accountExposure(acct({ id: 'b', dd: { pct: 0.5 }, unconfirmed: true }))).toBeNull();
  });

  it('« À surveiller » à 25 % ou moins, sur la marge la plus serrée', () => {
    expect(isAtRisk(acct({ id: 'a', dd: { pct: 0.8 }, daily: { pct: 0.25 } }))).toBe(true);
    expect(isAtRisk(acct({ id: 'b', dd: { pct: 0.26 } }))).toBe(false);
    expect(isAtRisk(acct({ id: 'c', dd: null }))).toBe(false);
  });
});

describe('drawdownTone : seuils existants', () => {
  it('rouge à 25 % ou dépassé, jaune à 50 %, vert au-delà', () => {
    expect(drawdownTone({ pct: 0.25, breached: false })).toBe('red');
    expect(drawdownTone({ pct: 0.9, breached: true })).toBe('red');
    expect(drawdownTone({ pct: 0.5, breached: false })).toBe('yellow');
    expect(drawdownTone({ pct: 0.51, breached: false })).toBe('green');
    expect(drawdownTone(null)).toBe('green');
  });
});

describe('groupByExposure (#668)', () => {
  it('suivis du plus exposé au moins exposé, égalité = ordre reçu ; puis sans marge, sans plan, validés / échoués', () => {
    const list = [
      acct({ id: 'safe', dd: { pct: 0.9 } }),
      acct({ id: 'perso', type: 'PERSONAL', plan: null, dd: null }),
      acct({ id: 'tie1', dd: { pct: 0.4 } }),
      acct({ id: 'failed', status: 'FAILED', dd: { pct: 0 } }),
      acct({ id: 'noplan', plan: null, dd: null }),
      acct({ id: 'hot', dd: { pct: 0.7 }, daily: { pct: 0.1 } }),
      acct({ id: 'tie2', dd: { pct: 0.4 } }),
      acct({ id: 'passed', status: 'PASSED', dd: { pct: 0.8 } }),
    ];
    const g = groupByExposure(list);
    expect(g.tracked.map((a) => a.id)).toEqual(['hot', 'tie1', 'tie2', 'safe']);
    expect(g.other.map((a) => a.id)).toEqual(['perso']);
    expect(g.noPlan.map((a) => a.id)).toEqual(['noplan']);
    expect(g.inactive.map((a) => a.id)).toEqual(['failed', 'passed']);
  });

  it('compte à règles manuelles (pas de plan) : trié avec les suivis, jamais caché en bas', () => {
    const g = groupByExposure([acct({ id: 'plan', dd: { pct: 0.8 } }), acct({ id: 'manual', plan: null, dd: { pct: 0.15 } })]);
    expect(g.tracked.map((a) => a.id)).toEqual(['manual', 'plan']);
    expect(g.noPlan).toEqual([]);
  });
});
