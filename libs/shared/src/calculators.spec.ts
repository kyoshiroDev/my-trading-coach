import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CALCULATOR_MAX_AMOUNT, positionSize, propFirmMargin, riskReward } from './calculators';

const eod = { kind: 'trailing_eod' as const, amount: 2000, startingBalance: 50_000, locksAt: null, lockedFloor: null };
const val = <T>(r: { ok: true; value: T } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('propFirmMargin', () => {
  it('statique : plancher fixe, marge = solde − plancher', () => {
    const r = val(propFirmMargin({ rule: { ...eod, kind: 'static' }, balance: 50_400, peakBalance: 51_000 }));
    expect(r).toMatchObject({ floor: 48_000, marginToFloor: 2400, dailyRemaining: null, nearest: 2400, limitedBy: 'floor', breached: false });
  });
  it('trailing : le plancher suit le plus haut', () => {
    expect(val(propFirmMargin({ rule: eod, balance: 50_400, peakBalance: 51_000 })).floor).toBe(49_000);
    // Sans plus haut saisi : plus grand du départ et du solde.
    expect(val(propFirmMargin({ rule: eod, balance: 50_400 })).floor).toBe(48_400);
  });
  it('EOD : le solde en séance peut dépasser le plus haut de clôture ; intraday : refusé', () => {
    expect(val(propFirmMargin({ rule: eod, balance: 50_800, peakBalance: 50_500 }))).toMatchObject({ floor: 48_500, marginToFloor: 2300 });
    expect(propFirmMargin({ rule: { ...eod, kind: 'trailing_intraday' }, balance: 50_800, peakBalance: 50_500 }).ok).toBe(false);
    expect(val(propFirmMargin({ rule: { ...eod, kind: 'trailing_intraday' }, balance: 50_400, peakBalance: 51_000 })).floor).toBe(49_000);
  });
  it('résultat du jour invalide refusé même sans perte du jour max', () => {
    expect(propFirmMargin({ rule: eod, balance: 50_000, dayResult: Number.NaN }).ok).toBe(false);
  });
  it('plancher figé au verrouillage', () => {
    const r = val(propFirmMargin({ rule: { ...eod, locksAt: 52_100, lockedFloor: 50_100 }, balance: 52_500, peakBalance: 53_000 }));
    expect(r).toMatchObject({ floor: 50_100, locked: true, marginToFloor: 2400 });
  });
  it('solde sous la limite : marge négative et dépassement signalé', () => {
    const r = val(propFirmMargin({ rule: eod, balance: 47_500, peakBalance: 50_000 }));
    expect(r.marginToFloor).toBe(-500);
    expect(r.breached).toBe(true);
  });
  it('perte du jour : la marge la plus proche est retenue, les gains du jour ne comptent pas', () => {
    const r = val(propFirmMargin({ rule: eod, balance: 49_700, peakBalance: 50_000, dailyLossLimit: 1000, dayResult: -300 }));
    expect(r).toMatchObject({ marginToFloor: 1700, dailyRemaining: 700, nearest: 700, limitedBy: 'daily', breached: false });
    expect(val(propFirmMargin({ rule: eod, balance: 50_300, dailyLossLimit: 1000, dayResult: 300 })).dailyRemaining).toBe(1000);
    expect(val(propFirmMargin({ rule: eod, balance: 49_000, peakBalance: 50_000, dailyLossLimit: 1000, dayResult: -1000 })).breached).toBe(true);
  });
  it('refuse les entrées invalides (négatives, nulles, non numériques, trop grandes, incohérentes)', () => {
    const bad = (input: Parameters<typeof propFirmMargin>[0]) => expect(propFirmMargin(input).ok).toBe(false);
    bad({ rule: { ...eod, amount: 0 }, balance: 50_000 });
    bad({ rule: { ...eod, amount: -100 }, balance: 50_000 });
    bad({ rule: { ...eod, startingBalance: 0 }, balance: 50_000 });
    bad({ rule: { ...eod, amount: 60_000 }, balance: 50_000 });
    bad({ rule: eod, balance: -1 });
    bad({ rule: eod, balance: Number.NaN });
    bad({ rule: eod, balance: Number.POSITIVE_INFINITY });
    bad({ rule: eod, balance: CALCULATOR_MAX_AMOUNT + 1 });
    bad({ rule: { ...eod, kind: 'trailing_intraday' }, balance: 50_000, peakBalance: 49_000 });
    bad({ rule: eod, balance: 50_000, peakBalance: -1 });
    bad({ rule: eod, balance: 50_000, dailyLossLimit: 0 });
    bad({ rule: eod, balance: 50_000, dailyLossLimit: -5 });
    bad({ rule: eod, balance: 50_000, dayResult: Number.NaN });
  });
  it('solde nul accepté (compte vidé)', () => {
    expect(val(propFirmMargin({ rule: eod, balance: 0 })).breached).toBe(true);
  });
});

describe('positionSize', () => {
  it('risque en $ : contrats arrondis vers le bas', () => {
    expect(val(positionSize({ mode: 'amount', risk: 200, stopTicks: 40, tickValue: 0.5 }))).toEqual({ riskAmount: 200, riskPerContract: 20, contracts: 10, actualRisk: 200 });
    expect(val(positionSize({ mode: 'amount', risk: 250, stopTicks: 40, tickValue: 5 }))).toEqual({ riskAmount: 250, riskPerContract: 200, contracts: 1, actualRisk: 200 });
  });
  it('risque en % du compte', () => {
    expect(val(positionSize({ mode: 'percent', risk: 1, accountSize: 50_000, stopTicks: 20, tickValue: 12.5 }))).toEqual({ riskAmount: 500, riskPerContract: 250, contracts: 2, actualRisk: 500 });
  });
  it('risque plus petit qu’un contrat : 0 contrat, pas une erreur', () => {
    expect(val(positionSize({ mode: 'amount', risk: 50, stopTicks: 20, tickValue: 5 })).contracts).toBe(0);
  });
  it('valeur du tick à plus de 2 décimales : contrats calculés sur la valeur exacte (ZT 7,8125 $)', () => {
    expect(val(positionSize({ mode: 'amount', risk: 234.38, stopTicks: 3, tickValue: 7.8125 }))).toEqual({ riskAmount: 234.38, riskPerContract: 23.44, contracts: 10, actualRisk: 234.38 });
  });
  it('compte trop grand en mode pourcentage : refusé', () => {
    expect(positionSize({ mode: 'percent', risk: 1, accountSize: CALCULATOR_MAX_AMOUNT * 2, stopTicks: 10, tickValue: 1 }).ok).toBe(false);
  });
  it('pas d’erreur d’arrondi flottant (0,1 + 0,2)', () => {
    expect(val(positionSize({ mode: 'amount', risk: 0.3, stopTicks: 1, tickValue: 0.1 })).contracts).toBe(3);
  });
  it('très grandes valeurs : refus au-delà du plafond, calcul juste en dessous', () => {
    expect(positionSize({ mode: 'amount', risk: CALCULATOR_MAX_AMOUNT * 10, stopTicks: 1, tickValue: 1 }).ok).toBe(false);
    expect(val(positionSize({ mode: 'amount', risk: CALCULATOR_MAX_AMOUNT, stopTicks: 1, tickValue: 1 })).contracts).toBe(CALCULATOR_MAX_AMOUNT);
  });
  it('refuse risque, stop, tick ou compte nuls ou négatifs, et plus de 100 %', () => {
    const bad = (input: Parameters<typeof positionSize>[0]) => expect(positionSize(input).ok).toBe(false);
    bad({ mode: 'amount', risk: 0, stopTicks: 10, tickValue: 1 });
    bad({ mode: 'amount', risk: -10, stopTicks: 10, tickValue: 1 });
    bad({ mode: 'amount', risk: 100, stopTicks: 0, tickValue: 1 });
    bad({ mode: 'amount', risk: 100, stopTicks: -3, tickValue: 1 });
    bad({ mode: 'amount', risk: 100, stopTicks: 10, tickValue: 0 });
    bad({ mode: 'percent', risk: 1, accountSize: 0, stopTicks: 10, tickValue: 1 });
    bad({ mode: 'percent', risk: 1, accountSize: null, stopTicks: 10, tickValue: 1 });
    bad({ mode: 'percent', risk: 101, accountSize: 50_000, stopTicks: 10, tickValue: 1 });
    bad({ mode: 'amount', risk: Number.NaN, stopTicks: 10, tickValue: 1 });
  });
});

describe('riskReward', () => {
  it('achat et vente', () => {
    expect(val(riskReward({ side: 'LONG', entry: 100, stop: 95, target: 110 }))).toEqual({ risk: 5, reward: 10, ratio: 2, breakEvenWinRate: 33.3 });
    expect(val(riskReward({ side: 'SHORT', entry: 100, stop: 104, target: 94 }))).toEqual({ risk: 4, reward: 6, ratio: 1.5, breakEvenWinRate: 40 });
  });
  it('refuse un stop ou un objectif du mauvais côté, un stop égal à l’entrée, des prix nuls ou négatifs', () => {
    const bad = (input: Parameters<typeof riskReward>[0]) => expect(riskReward(input).ok).toBe(false);
    bad({ side: 'LONG', entry: 100, stop: 105, target: 110 });
    bad({ side: 'LONG', entry: 100, stop: 95, target: 90 });
    bad({ side: 'SHORT', entry: 100, stop: 95, target: 90 });
    bad({ side: 'LONG', entry: 100, stop: 100, target: 110 });
    bad({ side: 'LONG', entry: 0, stop: -1, target: 10 });
    bad({ side: 'LONG', entry: -100, stop: -110, target: -90 });
    bad({ side: 'LONG', entry: 100, stop: 95, target: Number.NaN });
    bad({ side: 'LONG', entry: CALCULATOR_MAX_AMOUNT * 2, stop: 1, target: CALCULATOR_MAX_AMOUNT * 3 });
  });
  it('rendement trop petit pour un ratio lisible : erreur plutôt que 0', () => {
    expect(riskReward({ side: 'LONG', entry: 100, stop: 90, target: 100.01 }).ok).toBe(false);
  });
});

describe('landing · outils gratuits (#1071, phase 4)', () => {
  const landing = resolve(import.meta.dirname, '../../../apps/landing-mytradingcoach/src');
  const read = (p: string) => readFileSync(resolve(landing, p), 'utf8');
  const tools = ['pages/outils/marge-prop-firm.astro', 'pages/outils/taille-de-position.astro', 'pages/outils/risque-rendement.astro'];

  it('mention « à titre informatif » affichée par le gabarit commun de chaque outil', () => {
    expect(read('components/ToolLayout.astro')).toContain("export const TOOL_DISCLAIMER = 'Outil de calcul à titre informatif, pas un conseil d’investissement.'");
    expect(read('components/ToolLayout.astro')).toContain('{TOOL_DISCLAIMER}');
    for (const f of [...tools, 'pages/outils/index.astro']) expect(read(f), f).toContain('<ToolLayout');
  });

  it('calcul dans le navigateur : aucun envoi, aucun stockage, aucun cookie, calculs de @mtc/shared', () => {
    for (const f of [...tools, 'lib/tool-format.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|indexedDB/);
    }
    expect(read(tools[0])).toContain("import { DRAWDOWN_LABELS, propFirmMargin } from '@mtc/shared'");
    expect(read(tools[1])).toContain("import { positionSize } from '@mtc/shared'");
    expect(read(tools[2])).toContain("import { riskReward } from '@mtc/shared'");
  });

  it('règles du calculateur de marge filtrées comme les pages règles, lien depuis les pages règles', () => {
    expect(read('data/margin-tool-plans.ts')).toContain('firmPlanExclusionReason(');
    expect(read('pages/regles-prop-firm/index.astro')).toContain('href="/outils/marge-prop-firm"');
    expect(read('pages/regles-prop-firm/[slug].astro')).toContain('href="/outils/marge-prop-firm"');
  });
});
