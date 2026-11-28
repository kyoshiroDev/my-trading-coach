import type { DemoDay } from './model';
import { dayAt } from './generate';
import { isoWeek } from './reports';

/**
 * Alertes de comportement passées dans la démo (#671) : visibles dans « Alertes de la semaine » du Débrief
 * hebdo et dans le Profil (détecteur coupé). Module PUR (seed sous tsx). Sur la journée Apex la plus récente
 * d'une semaine ISO terminée (même filtre que les débriefs du seed : la semaine en cours n'a pas de débrief)
 * qui compte au moins 3 trades perdants : une alerte « Trade de vengeance » (moyenne,
 * ambre) avant la 2ᵉ perte, puis « Pertes d’affilée » (haute, rouge) avant la 3ᵉ. Textes au format exact
 * des détecteurs (`behavior-detectors.ts`). Plus un détecteur coupé : « Au-delà de ta limite de trades ».
 */
export interface DemoBehaviorAlert {
  type: 'B_REVENGE' | 'C1_LOSS_STREAK';
  severity: 'medium' | 'high';
  message: string;
  createdAt: Date;
  context: Record<string, unknown>;
}

export const DEMO_MUTED_DETECTOR = 'C2_OVER_DAILY_LIMIT';

export function behaviorAlertsExample(days: readonly DemoDay[], now: Date = new Date()): DemoBehaviorAlert[] {
  const thisWeek = isoWeek(now);
  const pastWeek = (d: DemoDay) => {
    const w = isoWeek(dayAt(now, d.daysAgo, 12, 0));
    return w.week !== thisWeek.week || w.year !== thisWeek.year;
  };
  const day = [...days]
    .filter((d) => d.account === 'apex' && d.kind !== 'today' && pastWeek(d))
    .map((d) => ({ d, losses: d.trades.filter((t) => t.pnl < 0).sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime()) }))
    .filter((x) => x.losses.length >= 3)
    .sort((a, b) => b.losses[0].tradedAt.getTime() - a.losses[0].tradedAt.getTime())[0];
  if (!day) return [];
  const [, second, third] = day.losses;
  const before = (at: Date, min: number) => new Date(at.getTime() - min * 60_000);
  return [
    {
      type: 'B_REVENGE',
      severity: 'medium',
      message: `Nouvelle entrée ${second.asset}\u00a0: 40 s après la perte (d’habitude 3 min), ${second.quantity + 1} contrats (d’habitude ${second.quantity}).`,
      createdAt: before(second.tradedAt, 3),
      context: { signals: ['fast_reentry', 'size_above_p75'] },
    },
    {
      type: 'C1_LOSS_STREAK',
      severity: 'high',
      message: 'Nouvelle entrée après 3 pertes d’affilée dans la séance.',
      createdAt: before(third.tradedAt, 2),
      context: { streak: 3 },
    },
  ];
}
