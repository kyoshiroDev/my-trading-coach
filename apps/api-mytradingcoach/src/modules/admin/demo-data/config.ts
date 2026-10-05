// Paramètres du compte démo : identité, comptes prop firm, instruments, profils de setups, hasard seedé.
import { AccountType, DrawdownType } from '@prisma/client';

export const DEMO_EMAIL = 'demo@mytradingcoach.app';
export const DEMO_NAME = 'Lucas Mercier';

/** Fenêtre de génération : 6 semaines (la vue « 1M » par défaut du dashboard reste pleine). */
export const DEMO_WINDOW_DAYS = 42;

/**
 * Deux comptes prop firm en USD. Contrat de cohérence, à ne pas casser :
 *   Σ startingBalance des comptes ACTIVE === STARTING_CAPITAL (50 000 + 50 000)
 * (`dashboard.baseCapital` et `accounts.trackedCapital` somment les `startingBalance`).
 *
 * Chaque compte est relié à un plan du catalogue prop firm (`propFirmPlanId`) : la marge de
 * drawdown suit alors les règles officielles du plan (trailing EOD, verrouillage). Les champs
 * manuels reprennent les mêmes valeurs, au cas où le plan serait absent de la base.
 */
export const DEMO_ACCOUNTS = [
  {
    key: 'apex' as const,
    label: 'Apex 50k · Éval',
    broker: 'Apex Trader Funding',
    type: AccountType.EVALUATION,
    accountSize: 50_000,
    startingBalance: 50_000,
    profitTarget: 3_000,
    maxDrawdown: 2_000,
    drawdownType: DrawdownType.TRAILING,
    propFirmPlanId: 'apex-eod-50k',
  },
  {
    key: 'tradeify' as const,
    label: 'Tradeify 50k · Funded',
    broker: 'Tradeify',
    type: AccountType.FUNDED,
    accountSize: 50_000,
    startingBalance: 50_000,
    profitTarget: null,
    maxDrawdown: 2_000,
    drawdownType: DrawdownType.TRAILING,
    propFirmPlanId: 'tradeify-select-flex-50k',
  },
];
export type AccountKey = (typeof DEMO_ACCOUNTS)[number]['key'];
/** Perte journalière du plan `apex-eod-50k` (catalogue) : rejouée par le journal de risque démo. */
export const APEX_DAILY_LOSS_LIMIT = 1_000;
export const STARTING_CAPITAL = DEMO_ACCOUNTS.reduce((s, a) => s + a.startingBalance, 0);

/** Futures d'indices US : $ par point, frais aller-retour par contrat (commission + exchange + NFA). */
export const INSTRUMENTS = {
  MNQ: { base: 19_850, ptVal: 2, fee: 1.24, stop: [10, 20] },
  MES: { base: 5_620, ptVal: 5, fee: 1.24, stop: [3, 6] },
  NQ: { base: 19_850, ptVal: 20, fee: 4.5, stop: [8, 15] },
  ES: { base: 5_620, ptVal: 50, fee: 4.5, stop: [2.5, 5] },
} as const;
export type Sym = keyof typeof INSTRUMENTS;
export const TICK = 0.25;

/**
 * Profils de setups : win rate BRUT visé, sortie gagnante / perdante en multiples du stop, part
 * des trades avec stop. Contrastés volontairement : Breakout est l'edge du trader, Reversal le
 * perd, et Scalping gagne en brut mais perd en net (petits gains, frais sur 6 contrats).
 */
export const SETUP_PROFILES = {
  Breakout: { share: 0.17, wr: 0.64, win: [1.3, 2.0], loss: [0.7, 1.0], stopRate: 0.8, tf: '5m' },
  Pullback: { share: 0.2, wr: 0.6, win: [1.1, 1.8], loss: [0.7, 1.0], stopRate: 0.8, tf: '5m' },
  Range: { share: 0.15, wr: 0.47, win: [0.9, 1.4], loss: [0.7, 1.0], stopRate: 0.7, tf: '15m' },
  Reversal: { share: 0.12, wr: 0.4, win: [1.2, 2.0], loss: [0.8, 1.1], stopRate: 0.7, tf: '15m' },
  News: { share: 0.1, wr: 0.52, win: [1.2, 2.4], loss: [0.8, 1.35], stopRate: 0.6, tf: '1m' },
  Scalping: { share: 0.26, wr: 0.62, win: [0.35, 0.6], loss: [0.4, 0.7], stopRate: 0.2, tf: '1m' },
} as const;
export type SetupTitle = keyof typeof SETUP_PROFILES;

// PRNG déterministe (mulberry32).
export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rand = () => number;
export const between = (r: Rand, [a, b]: readonly [number, number] | readonly number[]) => a + r() * (b - a);
export const toTick = (v: number) => Math.max(TICK, Math.round(v / TICK) * TICK);
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const pick = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
