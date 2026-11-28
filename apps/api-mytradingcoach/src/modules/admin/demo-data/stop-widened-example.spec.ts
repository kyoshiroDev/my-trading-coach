import { describe, expect, it } from 'vitest';
import { stopWidenedExample } from './stop-widened-example';
import type { DemoDay, DemoTrade } from './model';

const trade = (o: Partial<DemoTrade>): DemoTrade => ({
  account: 'apex', asset: 'NQ', setup: 'Breakout', side: 'LONG', entry: 20_000, exit: 19_990, stopLoss: null, takeProfit: null,
  riskReward: null, quantity: 1, pnl: -200, commission: 4.5, emotion: null, timeframe: '1m', session: 'NEW_YORK',
  tradedAt: new Date('2026-11-20T15:00:00Z'), notes: null, daysAgo: 3, executionScore: null, executionGrade: null, executionMethod: null,
  ...o,
} as DemoTrade);
const day = (trades: DemoTrade[], o: Partial<DemoDay> = {}): DemoDay =>
  ({ daysAgo: 3, account: 'apex', moodStart: 'CALM', moodEnd: 'CALM', kind: 'normal', trades, ...o } as DemoDay);

describe('démo : exemple du stop éloigné (#672)', () => {
  it('dernier trade NQ perdant de l’Apex : alerte E1, deux minutes avant la clôture', () => {
    const older = trade({ tradedAt: new Date('2026-11-18T15:00:00Z') });
    const latest = trade({ side: 'SHORT', entry: 20_100, tradedAt: new Date('2026-11-21T15:00:00Z') });
    const ex = stopWidenedExample([day([older]), day([latest, trade({ pnl: 300 })])])!;
    expect(ex.trade).toBe(latest);
    expect(ex.alert).toMatchObject({
      type: 'E1_STOP_WIDENED', message: 'Stop éloigné de 6 ticks sur NQ (risque porté à 14 ticks).',
      createdAt: new Date('2026-11-21T14:58:00Z'),
      context: { side: 'SHORT', prevStop: 20_102, nextStop: 20_103.5 },
    });
  });

  it('aucun trade NQ perdant hors journée du jour : pas d’exemple', () => {
    expect(stopWidenedExample([day([trade({ pnl: 50 })]), day([trade({})], { kind: 'today' })])).toBeNull();
  });
});
