import { describe, it, expect } from 'vitest';
import { sessionsWinRate } from './sessions-win-rate.util';

describe('sessionsWinRate — win rate sur les trades des séances (#947)', () => {
  it('pondéré par les trades décisifs, pas une moyenne des séances', () => {
    // 9W/1L + 0W/1L + séance de BE : 9 / 11 = 81,8 %. L'ancienne moyenne donnait (90 + 0 + 0) / 3 = 30 %.
    const rate = sessionsWinRate([
      { wins: 9, losses: 1 },
      { wins: 0, losses: 1 },
      { wins: 0, losses: 0 },
    ]);
    expect(rate).toBeCloseTo(81.82, 2);
  });

  it('aucun trade décisif : inconnu (null), pas 0 %', () => {
    expect(sessionsWinRate([{ wins: 0, losses: 0 }])).toBeNull();
    expect(sessionsWinRate([])).toBeNull();
  });
});
