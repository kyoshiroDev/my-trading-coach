import { describe, it, expect } from 'vitest';
import type { LiveBrokerState } from '@mtc/shared';
import { ageLabel, laggingBrokerPanel, liveTotals } from './live-position.util';

const broker = (o: Partial<LiveBrokerState> = {}): LiveBrokerState => ({
  openPositions: [], positionsAt: null, openPnl: 0, openPnlAt: null, ...o,
});
const position = { asset: 'MNQ', side: 'LONG' as const, quantity: 1, entryPrice: 21_500, since: null };

describe('liveTotals', () => {
  it('position ouverte : total = réalisé + latent du broker', () => {
    expect(liveTotals(303.4, broker({ openPositions: [position], openPnl: -42.5 }))).toEqual({
      realized: 303.4, latent: -42.5, total: 260.9, hasPosition: true,
    });
  });

  it('latent inconnu avec une position ouverte → ni latent ni total inventés', () => {
    expect(liveTotals(100, broker({ openPositions: [position], openPnl: null }))).toMatchObject({
      latent: null, total: null, hasPosition: true,
    });
  });

  it('à plat → latent 0, total = réalisé', () => {
    expect(liveTotals(100, broker({ openPnl: null }))).toMatchObject({ latent: 0, total: 100, hasPosition: false });
  });

  it('compte non synchronisé → pas de latent', () => {
    expect(liveTotals(100, null)).toMatchObject({ latent: null, total: null, hasPosition: false });
  });
});

describe('ageLabel', () => {
  const now = new Date('2026-10-06T14:10:00Z').getTime();
  it('seconde près sous la minute, puis minutes et heures', () => {
    expect(ageLabel(null, now)).toBe('jamais lu');
    expect(ageLabel('2026-10-06T14:09:58Z', now)).toBe("à l'instant");
    expect(ageLabel('2026-10-06T14:09:20Z', now)).toBe('il y a 40 s');
    expect(ageLabel('2026-10-06T14:07:00Z', now)).toBe('il y a 3 min');
    expect(ageLabel('2026-10-06T12:00:00Z', now)).toBe('il y a 2 h');
  });
});

describe('laggingBrokerPanel', () => {
  it('relit le panneau dont le relevé broker est le plus ancien', () => {
    expect(laggingBrokerPanel('2026-10-09T14:12:50.000Z', '2026-10-09T14:12:20.000Z')).toBe('account');
    expect(laggingBrokerPanel('2026-10-09T14:12:20.000Z', '2026-10-09T14:12:50.000Z')).toBe('live');
  });

  it('même relevé, ou date manquante / illisible → rien à relire', () => {
    expect(laggingBrokerPanel('2026-10-09T14:12:50.000Z', '2026-10-09T14:12:50.000Z')).toBeNull();
    expect(laggingBrokerPanel(null, '2026-10-09T14:12:50.000Z')).toBeNull();
    expect(laggingBrokerPanel('2026-10-09T14:12:50.000Z', undefined)).toBeNull();
    expect(laggingBrokerPanel('x', '2026-10-09T14:12:50.000Z')).toBeNull();
  });
});
