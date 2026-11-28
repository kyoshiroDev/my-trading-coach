import type { DemoDay } from './model';

/**
 * Alertes de comportement passées dans la démo (#671) : visibles dans « Alertes de la semaine » du Débrief
 * hebdo et dans le Profil (détecteur coupé). Module PUR (seed sous tsx). Sur la journée Apex la plus récente
 * hors journée du jour qui compte au moins 3 trades perdants : une alerte « Trade de vengeance » (moyenne,
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

export function behaviorAlertsExample(days: readonly DemoDay[]): DemoBehaviorAlert[] {
  const day = [...days]
    .filter((d) => d.account === 'apex' && d.kind !== 'today')
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
      message: `Nouvelle entrée ${second.asset} : 40 s après la perte (d’habitude 3 min), ${second.quantity + 1} contrats (d’habitude ${second.quantity}).`,
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
