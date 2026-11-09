import { describe, it, expect } from 'vitest';
import { dailyRecapTemplate, debriefReadyTemplate } from './index';

/** E-mails : P&L fractionnaire arrondi au plus proche, centimes sous 1 $ (jamais « -$1 » pour -0,80 $). */
describe('e-mails : montants fractionnaires', () => {
  const CASES: [number, string][] = [
    [-0.8, '-$0.80'],
    [-0.5, '-$0.50'],
    [49911.5, '+$49,912'],
    [49999.2, '+$49,999'],
    [0.49, '+$0.49'],
    [-0.01, '-$0.01'],
  ];

  it.each(CASES)('récap du jour (%d)', (pnl, shown) => {
    const { subject, html } = dailyRecapTemplate({
      userName: 'Trader', date: new Date('2026-11-09T18:00:00Z'), pnl, winRate: 50, tradesCount: 1,
      aiOneLiner: null, currency: 'USD', appUrl: 'https://app.example',
    });
    expect(subject).toContain(shown);
    expect(html).toContain(shown);
  });

  it.each(CASES)('débrief hebdo (%d)', (totalPnl, shown) => {
    const { subject, html } = debriefReadyTemplate({
      userName: 'Trader', weekNumber: 45, winRate: 50, totalPnl, totalTrades: 1, currency: 'USD', appUrl: 'https://app.example',
    });
    expect(subject).toContain(shown);
    expect(html).toContain(shown);
  });
});
