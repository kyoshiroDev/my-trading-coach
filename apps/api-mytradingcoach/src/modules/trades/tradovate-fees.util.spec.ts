import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  cashHistoryFeesByFill,
  fillsReportStamps,
  isTradovateFeeType,
  performanceFillStamps,
} from './tradovate-fees.util';

// Frais Tradovate complets (#783). Fixtures : export réel du compte « test NT8 » du 27/10/2026
// (numéro de compte remplacé). 34 côtés-contrat ES à 2,18 $ : commission 0,59, Exchange 1,38,
// Clearing 0,19, NFA 0,02 → 74,12 $, dont 20,06 $ de commission seulement.

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
const cash = fixture('tradovate-fees-2026-10-27-cash-history.csv');
const fills = fixture('tradovate-fees-2026-10-27-fills.csv');
const perf = fixture('tradovate-fees-2026-10-27-performance.csv');

const qtyByFill = new Map(
  fills.split(/\r?\n/).slice(1).filter(Boolean).map((l) => {
    const c = l.split(',');
    return [c[10], Number(c[16])] as const; // Fill ID, Quantity
  }),
);

describe('cashHistoryFeesByFill : tous les frais, rattachés à leur fill', () => {
  it('fills du rapport Fills : 74,12 $ attribués, aucune ligne orpheline', () => {
    const r = cashHistoryFeesByFill(cash, fillsReportStamps(fills))!;
    expect(r.expected).toBe(74.12);
    expect(r.orphans).toBe(0);
    expect(+[...r.feeByFill.values()].reduce((s, v) => s + v, 0).toFixed(2)).toBe(74.12);
  });

  it('chaque fill porte 2,18 $ par contrat, y compris deux fills dans la même seconde', () => {
    const r = cashHistoryFeesByFill(cash, fillsReportStamps(fills))!;
    expect(r.feeByFill.size).toBe(30);
    for (const [id, fee] of r.feeByFill) expect(fee, id).toBe(+(2.18 * qtyByFill.get(id)!).toFixed(2));
  });

  it('contre-épreuve : la commission seule (ancien calcul) ne fait que 20,06 $', () => {
    const r = cashHistoryFeesByFill(cash, fillsReportStamps(fills))!;
    const commissionOnly = cash
      .split(/\r?\n/)
      .filter((l) => l.includes(' Commission,'))
      .reduce((s, l) => s + Math.abs(Number(l.split(',')[4])), 0);
    expect(+commissionOnly.toFixed(2)).toBe(20.06);
    expect(r.expected).not.toBe(20.06);
  });

  it('fills lus dans l’export Performance (import CSV) : même résultat', () => {
    const r = cashHistoryFeesByFill(cash, performanceFillStamps(perf))!;
    expect(r.expected).toBe(74.12);
    expect(r.orphans).toBe(0);
    expect(r.feeByFill.size).toBe(30);
  });

  it('contre-épreuve : l’ancienne jointure « Transaction ID − 1 » ne trouve aucun fill ici', () => {
    const ids = new Set(fillsReportStamps(fills).map((f) => f.id));
    const commissions = cash.split(/\r?\n/).filter((l) => l.includes(' Commission,'));
    expect(commissions.filter((l) => ids.has(String(Number(l.split(',')[1]) - 1)))).toHaveLength(0);
  });

  it('fill inconnu (position encore ouverte, hors du lot) : ses frais restent orphelins, jamais sur un autre fill', () => {
    const stamps = fillsReportStamps(fills).filter((f) => f.id !== '718793600007');
    const r = cashHistoryFeesByFill(cash, stamps)!;
    expect(r.orphans).toBe(4);
    expect(r.expected).toBe(74.12);
    expect(+[...r.feeByFill.values()].reduce((s, v) => s + v, 0).toFixed(2)).toBe(71.94);
  });

  it('pas un Cash History → null', () => {
    expect(cashHistoryFeesByFill('a,b,c\n1,2,3', fillsReportStamps(fills))).toBeNull();
    expect(cashHistoryFeesByFill('', fillsReportStamps(fills))).toBeNull();
  });
});

describe('isTradovateFeeType', () => {
  it.each(['Commission', ' Exchange Fee', 'Clearing Fee', 'Nfa Fee', 'Brokerage Fee', 'Routing Fee'])('%s : frais', (t) => {
    expect(isTradovateFeeType(t)).toBe(true);
  });
  it.each(['Trade Paired', 'Fund Transaction', 'ChallengePayout', 'Manual Adjustment', 'Feedback'])('%s : pas un frais', (t) => {
    expect(isTradovateFeeType(t)).toBe(false);
  });
});
