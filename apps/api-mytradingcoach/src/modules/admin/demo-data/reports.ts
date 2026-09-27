// Aides aux débriefs et récaps démo : texte dérivé des vrais chiffres générés.
import { Plan } from '@prisma/client';
import { formatMoney } from '@mtc/shared';
import { DEMO_NAME, STARTING_CAPITAL } from './config';
import { type DemoTrade, net } from './model';

// ── Débriefs & récaps (texte dérivé des VRAIS chiffres générés) ────────────

export function isoWeek(d: Date): { week: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}
export const usd = (v: number) => formatMoney(v, 'USD', { decimals: 0 });

export function setupRanking(trades: DemoTrade[]) {
  const by = new Map<string, number>();
  for (const t of trades) by.set(t.setup, (by.get(t.setup) ?? 0) + net(t));
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

export const PROFILE = {
  isDemo: true, plan: Plan.PREMIUM, name: DEMO_NAME,
  onboardingCompleted: true, startingCapital: STARTING_CAPITAL,
  tradingStyle: 'Day trading', tradingStrategy: ['Price Action', 'ICT', 'Order Flow'],
  tradingSessions: ['LONDON', 'NEW_YORK'], tradesPerDayMin: 2, tradesPerDayMax: 4,
  strategyDescription: "Je trade les futures d'indices US (MNQ, MES, parfois NQ/ES) sur deux comptes prop firm. Breakouts et pullbacks sur l'ouverture de Londres et de New York. Règles : 4 trades max par jour, stop systématique, R:R minimum 1.5.",
  tradingAssets: ['MNQ', 'MES', 'NQ', 'ES'], favoriteAsset: 'MNQ',
  market: 'Futures', goal: 'Passer mon éval Apex sans casser mes règles',
  notificationsEmail: false, debriefAutomatic: false,
};

