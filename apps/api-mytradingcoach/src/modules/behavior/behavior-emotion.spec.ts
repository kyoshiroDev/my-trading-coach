import { describe, it, expect } from 'vitest';
import { emotionAfterLossDraft } from './behavior-emotion';

const AT = new Date('2026-11-24T15:10:00Z');
const loss = { tradedAt: new Date('2026-11-24T15:02:00Z'), pnl: -100, commission: 2 };

describe('F1 émotion après une perte (#671)', () => {
  it('Revenge ou Peur dans les 15 min après une perte nette : signal', () => {
    expect(emotionAfterLossDraft('REVENGE', AT, loss)).toMatchObject({
      type: 'F1_EMOTION_AFTER_LOSS', message: 'Émotion Revenge saisie 8 min après une perte.', context: { emotion: 'REVENGE', lastLoss: -102 },
    });
    expect(emotionAfterLossDraft('FEAR', AT, loss)?.message).toBe('Émotion Peur saisie 8 min après une perte.');
  });

  it('autre émotion, aucune, trade précédent gagnant ou au-delà de 15 min : rien', () => {
    expect(emotionAfterLossDraft('CONFIDENT', AT, loss)).toBeNull();
    expect(emotionAfterLossDraft(null, AT, loss)).toBeNull();
    expect(emotionAfterLossDraft('REVENGE', AT, { ...loss, pnl: 50 })).toBeNull();
    expect(emotionAfterLossDraft('REVENGE', AT, { ...loss, pnl: 1, commission: 0 })).toBeNull();
    expect(emotionAfterLossDraft('REVENGE', new Date('2026-11-24T15:18:00Z'), loss)).toBeNull();
    expect(emotionAfterLossDraft('REVENGE', AT, null)).toBeNull();
  });
});
