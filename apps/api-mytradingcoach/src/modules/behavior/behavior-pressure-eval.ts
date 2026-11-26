import { roundCents } from '@mtc/shared';
import { quantile } from './behavior-baseline';
import type { PressureLevel } from './behavior-pressure';
import type { ReplaySession } from './behavior-replay';

/**
 * Pouvoir prédictif de la jauge (#1270, étape 1) — fonction PURE sur la sortie de `replay`.
 *
 * Deux questions, sans regarder le futur pour calculer la jauge (elle vient du rejeu) :
 * 1. Par état à l'entrée : la position, et la suite de la séance à partir d'elle, sont-elles
 *    pires que d'habitude ? (P&L moyen et médian, part de positions perdantes.)
 * 2. Par séance : les pires journées (décile bas du plus bas intrajournalier) ont-elles atteint la
 *    zone rouge, et AVANT leur plus bas ? Comparé au taux de base de séances en zone rouge.
 * Une alerte de risque n'est pas une prédiction de perte (rapport #602) : le rapport donne aussi la
 * dispersion (pire position), pas seulement la moyenne.
 */

export interface LevelStats {
  positions: number;
  meanPnl: number;
  medianPnl: number;
  lossRate: number;
  worstPnl: number;
  /** P&L de la position et des suivantes de la séance, en moyenne. */
  meanRestOfSession: number;
}

export interface PressureEvaluation {
  sessions: number;
  /** Séances hors apprentissage. */
  scoredSessions: number;
  byLevel: Record<PressureLevel, LevelStats>;
  /** Part des séances notées qui atteignent la zone rouge. */
  redSessionRate: number;
  worstDays: number;
  /** Pires journées qui atteignent la zone rouge, et celles où elle arrive au plus tard à leur plus bas. */
  worstDaysRed: number;
  worstDaysRedBeforeLow: number;
}

const LEVELS: PressureLevel[] = ['learning', 'calm', 'watch', 'red'];
/** Pires journées : décile bas du plus bas intrajournalier, comme le rapport #602. */
export const WORST_DAYS_QUANTILE = 0.1;

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

export function evaluatePressure(sessions: readonly ReplaySession[]): PressureEvaluation {
  const pnl = new Map<PressureLevel, number[]>(LEVELS.map((l) => [l, []]));
  const rest = new Map<PressureLevel, number[]>(LEVELS.map((l) => [l, []]));
  for (const s of sessions) {
    s.positions.forEach((p, i) => {
      const level = s.pressure[i]?.level ?? 'learning';
      pnl.get(level)!.push(p.pnl);
      rest.get(level)!.push(s.positions.slice(i).reduce((sum, x) => sum + x.pnl, 0));
    });
  }
  const byLevel = Object.fromEntries(
    LEVELS.map((l) => {
      const xs = pnl.get(l)!;
      return [l, {
        positions: xs.length,
        meanPnl: roundCents(mean(xs)),
        medianPnl: xs.length ? roundCents(quantile(xs, 0.5)) : 0,
        lossRate: xs.length ? Math.round((xs.filter((x) => x < 0).length / xs.length) * 1000) / 1000 : 0,
        worstPnl: xs.length ? roundCents(Math.min(...xs)) : 0,
        meanRestOfSession: roundCents(mean(rest.get(l)!)),
      } satisfies LevelStats];
    }),
  ) as Record<PressureLevel, LevelStats>;

  const scored = sessions.filter((s) => s.pressure.some((r) => r.level !== 'learning'));
  const firstRed = (s: ReplaySession) => s.pressure.findIndex((r) => r.level === 'red');
  const redSessions = scored.filter((s) => firstRed(s) >= 0);
  const cut = scored.length ? quantile(scored.map((s) => s.low), WORST_DAYS_QUANTILE) : 0;
  const worst = scored.filter((s) => s.low < 0 && s.low <= cut);
  const worstRed = worst.filter((s) => firstRed(s) >= 0);
  return {
    sessions: sessions.length,
    scoredSessions: scored.length,
    byLevel,
    redSessionRate: scored.length ? Math.round((redSessions.length / scored.length) * 1000) / 1000 : 0,
    worstDays: worst.length,
    worstDaysRed: worstRed.length,
    worstDaysRedBeforeLow: worstRed.filter((s) => firstRed(s) <= s.lowIndex).length,
  };
}
