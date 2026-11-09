import { describe, expect, it } from 'vitest';
import { closedTradeSteps, maxDrawdownOfCumulative, maxDrawdownOfTrades, type DrawdownTrade } from './max-drawdown';
import { computeTradeStats } from './trade-stats';

const t = (closedAt: string, pnl: number | null, commission = 0): DrawdownTrade => ({ closedAt, pnl, commission });

/**
 * Cas réel du compte Lucid 50k (prompt drawdown-max-par-trade). Heures en UTC.
 * Vendredi 06/11 : −268,00 (08:22), −267,50 (08:45), +447,00 (22:45).
 * Lundi 09/11 : +1 406,50 et −253,60, dans les deux ordres.
 */
const FRIDAY = [t('2026-11-06T08:22:00Z', -268), t('2026-11-06T08:45:00Z', -267.5), t('2026-11-06T22:45:00Z', 447)];
const MONDAY_GAIN_FIRST = [...FRIDAY, t('2026-11-09T09:00:00Z', 1406.5), t('2026-11-09T10:00:00Z', -253.6)];
const MONDAY_LOSS_FIRST = [...FRIDAY, t('2026-11-09T09:00:00Z', -253.6), t('2026-11-09T10:00:00Z', 1406.5)];

describe('maxDrawdownOfTrades — cas réel', () => {
  it('vendredi seul : le creux est −268 − 267,5 = −535,50, pas la clôture du jour (−88,50)', () => {
    // Solde après chaque trade : −268 ; −535,5 ; −88,5. Sommet = départ (0).
    const r = maxDrawdownOfTrades(FRIDAY);
    expect(r.maxDrawdown).toBe(-535.5);
    expect(r.series).toEqual([0, -268, -535.5, -88.5]);
    expect(r.peakIndex).toBe(0);
    expect(r.troughIndex).toBe(2);
  });

  it('lundi gain puis perte : nouveau sommet 1 318 puis −253,60, le max reste −535,50', () => {
    // Cumul : −268 ; −535,5 ; −88,5 ; 1 318 ; 1 064,4. Drawdown : … ; 0 ; −253,6.
    const r = maxDrawdownOfTrades(MONDAY_GAIN_FIRST);
    expect(r.series).toEqual([0, -268, -535.5, -88.5, 0, -253.6]);
    expect(r.maxDrawdown).toBe(-535.5);
  });

  it('lundi perte puis gain : −88,5 − 253,6 = −342,10 sous le départ, le max reste −535,50', () => {
    // Cumul : −268 ; −535,5 ; −88,5 ; −342,1 ; 1 064,4.
    const r = maxDrawdownOfTrades(MONDAY_LOSS_FIRST);
    expect(r.series).toEqual([0, -268, -535.5, -88.5, -342.1, 0]);
    expect(r.maxDrawdown).toBe(-535.5);
  });

  it('ordre de clôture, pas ordre de la liste', () => {
    expect(maxDrawdownOfTrades([...MONDAY_GAIN_FIRST].reverse())).toEqual(maxDrawdownOfTrades(MONDAY_GAIN_FIRST));
  });

  it('non-régression des autres chiffres sur le même jeu : P&L 1 064,40, win rate 40 %, profit factor 2,35', () => {
    const stats = computeTradeStats(MONDAY_GAIN_FIRST);
    expect(stats.totalPnl).toBe(1064.4);
    expect(stats.winRate).toBe(40); // 2 gagnants / 5
    // (447 + 1 406,5) / (268 + 267,5 + 253,6) = 1 853,5 / 789,1 = 2,3488…
    const gains = 447 + 1406.5;
    const losses = 268 + 267.5 + 253.6;
    expect(Math.round((gains / losses) * 100) / 100).toBe(2.35);
  });
});

describe('maxDrawdownOfTrades — cas limites', () => {
  it('aucun trade : 0, pas de sommet ni de creux', () => {
    expect(maxDrawdownOfTrades([])).toEqual({ maxDrawdown: 0, series: [0], peakIndex: null, troughIndex: null });
  });

  it('un seul trade perdant : son montant ; gagnant : 0', () => {
    expect(maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', -120)]).maxDrawdown).toBe(-120);
    expect(maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', 120)]).maxDrawdown).toBe(0);
  });

  it('que des gains : 0', () => {
    const r = maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', 10), t('2026-11-06T09:00:00Z', 20), t('2026-11-06T10:00:00Z', 5)]);
    expect(r.maxDrawdown).toBe(0);
    expect(r.peakIndex).toBeNull();
  });

  it('que des pertes : la somme (−10 − 20 − 5 = −35)', () => {
    const r = maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', -10), t('2026-11-06T09:00:00Z', -20), t('2026-11-06T10:00:00Z', -5)]);
    expect(r.maxDrawdown).toBe(-35);
    expect(r.troughIndex).toBe(3);
  });

  it('sommets égaux : le drawdown part du dernier sommet atteint', () => {
    // Cumul : 100 ; 40 ; 100 ; 30 → sommets 100 (1) et 100 (3), plus forte baisse 100 → 30 = −70.
    const r = maxDrawdownOfTrades([
      t('2026-11-06T08:00:00Z', 100), t('2026-11-06T09:00:00Z', -60),
      t('2026-11-06T10:00:00Z', 60), t('2026-11-06T11:00:00Z', -70),
    ]);
    expect(r.maxDrawdown).toBe(-70);
    expect(r.peakIndex).toBe(3);
    expect(r.troughIndex).toBe(4);
  });

  it('trades du même instant : une seule étape (somme), aucun creux inventé', () => {
    // −300 et +300 à la même seconde : l'ordre est inconnu → étape nette 0, drawdown 0.
    const same = [t('2026-11-06T08:00:00Z', -300), t('2026-11-06T08:00:00Z', 300)];
    const steps = closedTradeSteps(same);
    expect(steps).toEqual([{ date: '2026-11-06T08:00:00.000Z', cumulativePnl: 0, pnl: 0, trades: 2 }]);
    expect(maxDrawdownOfTrades(same).maxDrawdown).toBe(0);
    expect(maxDrawdownOfTrades([...same].reverse()).maxDrawdown).toBe(0);
  });

  it('frais déduits : brut −100 avec 4,50 de frais = −104,50 ; brut +1 avec 1,90 de frais = perte', () => {
    const r = maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', -100, 4.5), t('2026-11-06T09:00:00Z', 1, 1.9)]);
    // Cumul net : −104,5 ; −105,4.
    expect(r.series).toEqual([0, -104.5, -105.4]);
    expect(r.maxDrawdown).toBe(-105.4);
  });

  it('trade ouvert (pnl absent) : hors calcul', () => {
    expect(maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', -50), t('2026-11-06T09:00:00Z', null)]).series).toEqual([0, -50]);
  });

  it('pas de dérive flottante : 0,1 + 0,2 − 0,3 reste à 0', () => {
    const r = maxDrawdownOfTrades([t('2026-11-06T08:00:00Z', 0.1), t('2026-11-06T09:00:00Z', 0.2), t('2026-11-06T10:00:00Z', -0.3)]);
    expect(r.series).toEqual([0, 0, 0, -0.3]);
  });
});

describe('maxDrawdownOfCumulative', () => {
  it('lit une courbe cumulée déjà calculée (points de l’API)', () => {
    expect(maxDrawdownOfCumulative([-268, -535.5, -88.5, 1318, 1064.4]).maxDrawdown).toBe(-535.5);
  });
});
