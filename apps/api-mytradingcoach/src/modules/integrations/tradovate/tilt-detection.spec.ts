import { describe, it, expect } from 'vitest';
import { detectTilt, type TiltTrade } from './tilt-detection';

const at = (min: number) => new Date(Date.UTC(2026, 5, 2, 14, 0) + min * 60_000);
const t = (id: string, pnl: number, min: number, quantity: number | null = 1): TiltTrade => ({ id, pnl, quantity, tradedAt: at(min) });
const noHistory = { quantities: [], dailyCounts: [] };
const history = { quantities: Array(30).fill(2), dailyCounts: Array(12).fill(3) };
const signals = (f: ReturnType<typeof detectTilt>) => f.map((x) => x.signal);

describe('detectTilt', () => {
  it('rien sans trade, ou séance calme', () => {
    expect(detectTilt([], history, 'd')).toEqual([]);
    expect(detectTilt([t('1', -100, 0), t('2', 50, 15)], history, 'd')).toEqual([]);
  });

  it('revenge : clôture moins de 2 min après une perte (clôture à clôture, comme la note)', () => {
    const f = detectTilt([t('1', -100, 0), t('2', 30, 1.5)], noHistory, 'd');
    expect(f).toEqual([{ signal: 'revenge', ref: '2', minutes: 1.5 }]);
    expect(detectTilt([t('1', -100, 0), t('2', 30, 2)], noHistory, 'd')).toEqual([]);
  });

  it('revenge : la perte de référence est la DERNIÈRE perte de la journée', () => {
    expect(signals(detectTilt([t('1', -100, 0), t('2', 40, 5), t('3', 10, 5.5)], noHistory, 'd'))).toEqual([]);
    expect(signals(detectTilt([t('1', 40, 0), t('2', -100, 5), t('3', 10, 6)], noHistory, 'd'))).toEqual(['revenge']);
  });

  it('taille : plus de 2× la médiane juste après une perte, avec 20 trades d’historique', () => {
    const f = detectTilt([t('1', -100, 0, 2), t('2', -50, 20, 5)], history, 'd');
    expect(f).toEqual([{ signal: 'size', ref: '2', quantity: 5, medianQuantity: 2 }]);
    expect(signals(detectTilt([t('1', -100, 0, 2), t('2', -50, 20, 4)], history, 'd')), 'pile 2× : pas encore').toEqual([]);
    expect(signals(detectTilt([t('1', 100, 0, 2), t('2', -50, 20, 5)], history, 'd')), 'après un gain : non').toEqual([]);
    expect(signals(detectTilt([t('1', -100, 0, 2), t('2', -50, 20, 5)], { ...history, quantities: [2, 2] }, 'd')), 'historique trop court').toEqual([]);
  });

  it('surtrading : plus de 2× la médiane des journées et au moins 6 trades, avec 10 journées d’historique', () => {
    const seven = Array.from({ length: 7 }, (_, i) => t(String(i), 10, i * 20));
    expect(detectTilt(seven, history, '2026-06-02')).toEqual([{ signal: 'overtrading', ref: '2026-06-02', count: 7, medianCount: 3 }]);
    expect(signals(detectTilt(seven.slice(0, 6), history, 'd')), '6 = 2× la médiane : pas plus').toEqual([]);
    expect(signals(detectTilt(seven, { ...history, dailyCounts: [3, 3] }, 'd')), 'historique trop court').toEqual([]);
  });
});
