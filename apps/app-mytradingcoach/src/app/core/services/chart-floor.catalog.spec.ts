import { describe, it, expect } from 'vitest';
import {
  PROP_FIRM_CATALOG_FILES,
  drawdownFloor,
  drawdownPeakProfit,
  planDrawdownRule,
  type PropFirmMaxDrawdown,
} from '@mtc/shared';
import type { TradingAccount } from '../api/accounts.api';
import { floorSeries, planFloorOf } from './chart-series.util';

/**
 * Carte drawdown × TOUT le catalogue prop firm : chaque phase (et chaque variante de plateforme)
 * rejoue un scénario de trades générique, à l'échelle du plan (montants en multiples de son
 * drawdown). Un plan ajouté au catalogue est testé sans rien écrire.
 *
 * « Suivi du compte » = les fonctions de l'API (`planDrawdownRule`, `drawdownPeakProfit`,
 * `drawdownFloor`) ; « carte » = `planFloorOf` + `floorSeries`, nourris par le compte tel que
 * l'API le renvoie.
 */

interface CatalogPhase {
  phase: string;
  starting_balance?: number | null;
  max_drawdown: PropFirmMaxDrawdown | null;
}
interface CatalogPlan { id: string; account_size: number; currency?: string; phases: CatalogPhase[] }

const cases = (PROP_FIRM_CATALOG_FILES as { firm: { id: string }; plans: CatalogPlan[] }[]).flatMap((file) =>
  file.plans.flatMap((plan) =>
    plan.phases
      .filter((ph) => ph.max_drawdown && ph.max_drawdown.amount > 0)
      .flatMap((ph) =>
        [null, ...Object.keys(ph.max_drawdown!.platform_overrides ?? {})].map((platform) => ({
          name: `${plan.id} · ${ph.phase}${platform ? ` · ${platform}` : ''}`,
          plan,
          phase: ph as CatalogPhase & { max_drawdown: PropFirmMaxDrawdown },
          platform,
        })),
      ),
  ),
);

const pt = (i: number, cumulativePnl: number) => ({ date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(), cumulativePnl });

describe('carte drawdown sur tout le catalogue prop firm', () => {
  it('le catalogue a bien des plans à tester', () => {
    expect(cases.length).toBeGreaterThan(500);
  });

  it('le scénario couvre les trois types de drawdown et des planchers gelés', () => {
    const kinds = new Set(cases.map((c) => c.phase.max_drawdown.type));
    expect([...kinds].sort()).toEqual(['static', 'trailing_eod', 'trailing_intraday']);
    const locking = cases.filter(({ plan, phase, platform }) => {
      const start = phase.starting_balance ?? plan.account_size;
      const { rule } = planDrawdownRule(phase, { startingBalance: start, accountSize: plan.account_size, platform })!;
      return drawdownFloor(rule, 1.4 * rule.amount + 100).locked;
    });
    expect(locking.length).toBeGreaterThan(100);
  });

  it.each(cases)('$name', ({ plan, phase, platform }) => {
    const start = phase.starting_balance ?? plan.account_size;
    const resolved = planDrawdownRule(phase, { startingBalance: start, accountSize: plan.account_size, platform })!;
    expect(resolved).not.toBeNull();
    const { rule } = resolved;
    const A = rule.amount;

    // Suivi du compte, clôture après clôture (un trade par jour : plus haut EOD = plus haut cumulé).
    const track = (profits: number[]) => {
      let maxEod = -Infinity;
      return profits.map((profit) => {
        maxEod = Math.max(maxEod, profit);
        const peak = drawdownPeakProfit(rule.kind, { maxEodCumulative: maxEod, maxCumulative: maxEod }, profit);
        const { floor, locked } = drawdownFloor(rule, peak);
        return { balance: start + profit, floor, locked, peak, margin: start + profit - floor };
      });
    };
    // Monte, recule, dépasse le seuil de gel éventuel, recule, puis clôture PILE sur le plancher.
    const climb = [0.5 * A, 0.2 * A, 1.4 * A + 100, 1.1 * A];
    const before = track(climb);
    const touch = before[before.length - 1].floor - start;
    const profits = [...climb, touch];
    const steps = track(profits);
    const last = steps[steps.length - 1];
    expect(last.margin).toBeCloseTo(0, 6); // le scénario touche bien le plancher

    // Compte tel que l'API le renvoie (metrics.drawdown).
    const account = {
      id: 'acc', propFirmPlanId: plan.id, currency: plan.currency ?? 'USD',
      metrics: {
        startingBalance: start, currentBalance: last.balance, drawdownUnconfirmed: false,
        drawdown: {
          source: 'plan', maxDrawdown: A, floor: last.floor, margin: last.margin,
          pct: Math.max(0, Math.min(1, last.margin / A)), breached: last.margin <= 0,
          rule: {
            kind: rule.kind, locked: last.locked,
            locksAt: rule.locksAt,
            lockedFloor: rule.locksAt != null ? rule.lockedFloor ?? rule.locksAt - A : null,
            peakBalance: rule.kind === 'trailing_eod' ? start + last.peak : null,
          },
        },
      },
    } as unknown as TradingAccount;

    const planFloor = planFloorOf(account)!;
    expect(planFloor).not.toBeNull();
    const f = floorSeries(profits.map((p, i) => pt(i, p)), start, planFloor);

    // Limite = solde initial − drawdown du plan ; départ au solde initial.
    expect(f.limit).toBeCloseTo(start - A, 6);
    expect(f.values[0]).toBeCloseTo(start, 6);
    // Point par point : marge = celle du suivi du compte, écart courbe → limite = marge (plafonnée).
    steps.forEach((s, i) => {
      expect(f.floor[i + 1]).toBeCloseTo(s.floor, 6);
      expect(f.margin[i + 1]).toBeCloseTo(s.margin, 6);
      expect(f.values[i + 1] - f.limit).toBeCloseTo(Math.min(s.margin, A), 6);
    });
    // Dernier point : marge de l'en-tête = écart courbe → limite = suivi du compte.
    expect(planFloor.margin).toBeCloseTo(last.margin, 6);
    expect(f.values[f.values.length - 1] - f.limit).toBeCloseTo(Math.min(planFloor.margin, A), 6);
    // La courbe touche la limite exactement quand le solde touche le plancher.
    f.values.forEach((v, i) => {
      const touches = Math.abs(f.balance[i] - f.floor[i]) < 1e-6;
      expect(Math.abs(v - f.limit) < 1e-6).toBe(touches);
    });
  });
});
