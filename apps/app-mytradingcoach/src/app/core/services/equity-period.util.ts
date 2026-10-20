import { EquityPoint, PeriodBefore } from '../api/analytics.api';

/**
 * Ancrage d'une courbe sur la période affichée (fonctions pures, testées dans
 * `equity-period.util.spec.ts`). Les points de l'API sont le P&L cumulé DEPUIS le début de la
 * période : il faut savoir d'où part le solde et quel sommet existait déjà avant.
 */

export const NO_HISTORY: PeriodBefore = { pnl: 0, peak: 0 };

/** P&L net de la période (dernier point cumulé), 0 sans point. */
export function periodPnl(points: EquityPoint[]): number {
  return points.length ? points[points.length - 1].cumulativePnl : 0;
}

/**
 * Solde au début de la période = solde actuel − P&L de la période. La courbe finit donc sur le
 * solde affiché par le sélecteur de compte et Mes comptes (y compris celui du broker).
 */
export function periodStartCapital(currentBalance: number, points: EquityPoint[]): number {
  return currentBalance - periodPnl(points);
}

/**
 * Drawdown jour par jour (≤ 0), point de départ compris : clôture de journée moins le plus haut
 * des clôtures DEPUIS L'OUVERTURE DU COMPTE (sommet d'avant la période inclus, solde de départ
 * compris), comme la règle EOD des prop firms et la marge de Mes comptes. La période peut donc
 * commencer déjà en drawdown.
 */
export function anchoredDrawdown(points: EquityPoint[], before: PeriodBefore = NO_HISTORY): number[] {
  let peak = Math.max(0, before.peak, before.pnl);
  const start = before.pnl - peak;
  return [
    start,
    ...points.map((p) => {
      const profit = before.pnl + p.cumulativePnl;
      if (profit > peak) peak = profit;
      return profit - peak;
    }),
  ];
}

/** Plus fort drawdown d'une série (≤ 0), 0 si vide. */
export function maxDrawdownOf(series: number[]): number {
  return series.length ? Math.min(0, ...series) : 0;
}

/** Comptes d'une vue : de quoi lire un solde sans dépendre du store (specs, calcul pur). */
interface BalanceAccount {
  status: string;
  metrics: { startingBalance?: number | null; currentBalance?: number | null };
}

/**
 * Solde de la vue courante, miroir du sélecteur de compte et de Mes comptes : le compte
 * sélectionné, sinon la somme des comptes non archivés. `null` sans compte → l'appelant décide
 * du repli (capital du profil). `currentBalance` = celui du broker pour un compte connecté.
 */
export function viewBalance(
  selected: BalanceAccount | null,
  accounts: BalanceAccount[],
  key: 'startingBalance' | 'currentBalance',
): number | null {
  if (selected) return selected.metrics[key] ?? 0;
  const active = accounts.filter((a) => a.status !== 'ARCHIVED');
  return active.length ? active.reduce((s, a) => s + (a.metrics[key] ?? 0), 0) : null;
}
