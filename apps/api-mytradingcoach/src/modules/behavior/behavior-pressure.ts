import { roundCents } from '@mtc/shared';
import {
  PRESSURE_DAILY_LOSS,
  PRESSURE_MAX,
  PRESSURE_OVER_LIMIT_POINTS,
  PRESSURE_OVER_PLAN_POINTS,
  PRESSURE_PACE_HIGH_FACTOR,
  PRESSURE_PACE_HIGH_POINTS,
  PRESSURE_PACE_POINTS,
  PRESSURE_RED,
  PRESSURE_REENTRY,
  PRESSURE_SIZE_AFTER_LOSS_POINTS,
  PRESSURE_SIZE_POINTS,
  PRESSURE_STREAK,
  PRESSURE_WATCH,
} from './behavior.constants';
import { type EntryContext, detectOverDailyLimit, detectSizeOverPlan, isLearning } from './behavior-detectors';
import { isLoss } from './behavior-positions';

/**
 * Jauge de pression en séance (#1270, étape 1 : étude) — fonction PURE, aucune I/O, rien d'affiché.
 *
 * On ne lit pas une émotion : on mesure les traces qu'elle laisse dans la façon de trader, à chaque
 * nouvelle entrée, contre la référence personnelle du trader (`behavior-baseline`). La jauge agrège
 * les mêmes mesures que les détecteurs (délai de ré-entrée, taille, rythme, pertes d'affilée, perte
 * du jour consommée, règles du plan), en continu au lieu d'un seuil tout ou rien.
 *
 * Neutre (`learning`) tant que la référence est en apprentissage, comme B, C1 et C3.
 * Messages factuels (jamais « émotion détectée », jamais de conseil), sans tiret cadratin.
 */

export type PressureLevel = 'learning' | 'calm' | 'watch' | 'red';

export type PressureSignal =
  | 'fast_reentry'
  | 'size_up'
  | 'pace'
  | 'loss_streak'
  | 'daily_loss_used'
  | 'over_plan'
  | 'over_limit';

export interface PressureContribution {
  signal: PressureSignal;
  points: number;
  /** Fait mesuré, en français, pour la phrase du coach. */
  detail: string;
}

export interface PressureReading {
  level: PressureLevel;
  /** 0 à `PRESSURE_MAX` ; 0 en apprentissage. */
  score: number;
  /** Signaux retenus, du plus lourd au plus léger. */
  contributions: PressureContribution[];
  /** Phrase factuelle (les deux signaux les plus lourds), `null` si rien. */
  message: string | null;
}

const fmtDelay = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);
const fmtQty = (q: number) => String(roundCents(q)).replace('.', ',');

export const levelOf = (score: number): Exclude<PressureLevel, 'learning'> =>
  score >= PRESSURE_RED ? 'red' : score >= PRESSURE_WATCH ? 'watch' : 'calm';

export function pressureAt(ctx: EntryContext): PressureReading {
  if (isLearning(ctx.baseline)) return { level: 'learning', score: 0, contributions: [], message: null };
  const b = ctx.baseline!;
  const out: PressureContribution[] = [];
  const prev = ctx.closed[ctx.closed.length - 1];
  const afterLoss = !!prev && isLoss(prev);

  if (afterLoss && b.medianGapAfterLossMs != null && b.medianGapAfterLossMs > 0) {
    const delay = ctx.at.getTime() - prev.closedAt.getTime();
    const row = delay >= 0 ? PRESSURE_REENTRY.find((r) => delay / b.medianGapAfterLossMs! < r.below) : undefined;
    if (row) {
      out.push({
        signal: 'fast_reentry',
        points: row.points,
        detail: `entrée ${fmtDelay(delay)} après une perte (d'habitude ${fmtDelay(b.medianGapAfterLossMs)})`,
      });
    }
  }

  const size = b.sizeByAsset[ctx.entry.asset];
  if (size && ctx.entry.quantity > size.p90) {
    out.push({
      signal: 'size_up',
      points: afterLoss ? PRESSURE_SIZE_AFTER_LOSS_POINTS : PRESSURE_SIZE_POINTS,
      detail: `${fmtQty(ctx.entry.quantity)} ${ctx.entry.asset}${afterLoss ? ' juste après une perte' : ''} (d'habitude ${fmtQty(size.median)})`,
    });
  }

  const rank = ctx.closed.length + 1;
  const pace = b.positionsPerSession;
  if (pace && pace.p90 > 0 && rank > pace.p90) {
    const high = rank > PRESSURE_PACE_HIGH_FACTOR * pace.p90;
    out.push({
      signal: 'pace',
      points: high ? PRESSURE_PACE_HIGH_POINTS : PRESSURE_PACE_POINTS,
      detail: `${rank}e position de la séance (d'habitude ${fmtQty(pace.median)})`,
    });
  }

  let streak = 0;
  for (let i = ctx.closed.length - 1; i >= 0 && isLoss(ctx.closed[i]); i--) streak++;
  const streakRow = PRESSURE_STREAK.find((r) => streak >= r.from);
  if (streakRow) {
    out.push({ signal: 'loss_streak', points: streakRow.points, detail: `après ${streak} pertes d'affilée` });
  }

  if (ctx.dailyLoss && ctx.dailyLoss.limit > 0) {
    const share = ctx.dailyLoss.used / ctx.dailyLoss.limit;
    const row = PRESSURE_DAILY_LOSS.find((r) => share > r.above);
    if (row) {
      out.push({
        signal: 'daily_loss_used',
        points: row.points,
        detail: `${Math.round(share * 100)} % de la perte max du jour consommée`,
      });
    }
  }

  if (detectSizeOverPlan(ctx)) out.push({ signal: 'over_plan', points: PRESSURE_OVER_PLAN_POINTS, detail: 'taille au-dessus du maximum du plan' });
  const overLimit = detectOverDailyLimit(ctx);
  if (overLimit) {
    out.push({ signal: 'over_limit', points: PRESSURE_OVER_LIMIT_POINTS, detail: `au-delà de ta limite de ${overLimit.context['max']} positions par jour` });
  }

  out.sort((x, y) => y.points - x.points);
  const score = Math.min(PRESSURE_MAX, out.reduce((s, c) => s + c.points, 0));
  const top = out.slice(0, 2).map((c) => c.detail);
  const message = top.length ? `${top[0].charAt(0).toUpperCase()}${top[0].slice(1)}${top[1] ? ` ; ${top[1]}` : ''}.` : null;
  return { level: levelOf(score), score, contributions: out, message };
}
