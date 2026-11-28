import { describe, expect, it } from 'vitest';
import { freezeClock } from '../../../test/freeze-clock';
import { behaviorAlertsExample } from './behavior-alerts-example';
import type { DemoDay, DemoTrade } from './model';

freezeClock(new Date('2026-11-27T12:00:00Z'));

const trade = (iso: string, pnl: number): DemoTrade => ({
  account: 'apex', asset: 'NQ', setup: 'Breakout', side: 'LONG', entry: 20_000, exit: 19_990, stopLoss: null, takeProfit: null,
  riskReward: null, quantity: 2, pnl, commission: 4.5, emotion: null, timeframe: '1m', session: 'NEW_YORK',
  tradedAt: new Date(iso), notes: null, daysAgo: 3, executionScore: null, executionGrade: null, executionMethod: null,
} as DemoTrade);
const day = (trades: DemoTrade[], o: Partial<DemoDay> = {}): DemoDay =>
  ({ daysAgo: 3, account: 'apex', moodStart: 'CALM', moodEnd: 'CALM', kind: 'normal', trades, ...o } as DemoDay);

describe('démo : alertes de comportement passées (#671)', () => {
  it('journée Apex avec 3 pertes : ambre avant la 2ᵉ, rouge avant la 3ᵉ, textes au format des détecteurs', () => {
    const d = day([trade('2026-11-24T15:00:00Z', -100), trade('2026-11-24T15:20:00Z', -80), trade('2026-11-24T15:40:00Z', -60), trade('2026-11-24T16:00:00Z', 50)]);
    const [b, c] = behaviorAlertsExample([d]);
    expect(b).toMatchObject({ type: 'B_REVENGE', severity: 'medium', createdAt: new Date('2026-11-24T15:17:00Z') });
    expect(b.message).toBe('Nouvelle entrée NQ\u00a0: 40 s après la perte (d’habitude 3 min), 3 contrats (d’habitude 2).');
    expect(c).toMatchObject({ type: 'C1_LOSS_STREAK', severity: 'high', message: 'Nouvelle entrée après 3 pertes d’affilée dans la séance.', createdAt: new Date('2026-11-24T15:38:00Z') });
  });

  it('moins de 3 pertes, ou journée du jour : aucun exemple', () => {
    expect(behaviorAlertsExample([day([trade('2026-11-24T15:00:00Z', -100), trade('2026-11-24T15:20:00Z', -80)])])).toEqual([]);
    expect(behaviorAlertsExample([day([trade('2026-11-24T15:00:00Z', -1), trade('2026-11-24T15:01:00Z', -1), trade('2026-11-24T15:02:00Z', -1)], { kind: 'today' })])).toEqual([]);
  });
});
