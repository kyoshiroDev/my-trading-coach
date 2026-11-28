import { describe, it, expect } from 'vitest';
import { behaviorTone, type LiveBehaviorAlert } from './behavior-tone';

const MIN = 60_000;
const a = (o: Partial<LiveBehaviorAlert>): LiveBehaviorAlert => ({
  id: 'x', accountId: 'acc', type: 'B_REVENGE', severity: 'medium', message: 'm', context: {}, receivedAt: 0, ...o,
});

describe('behaviorTone (#671)', () => {
  it('aucune alerte : rien', () => {
    expect(behaviorTone([])).toBeNull();
  });

  it('gravité moyenne seule : ambre ; haute : rouge', () => {
    expect(behaviorTone([a({})])).toEqual({ tone: 'amber', escalated: false });
    expect(behaviorTone([a({ severity: 'high' })])).toEqual({ tone: 'red', escalated: false });
  });

  it('2ᵉ détecteur du même compte dans les 30 min : rouge, « 2ᵉ signal »', () => {
    expect(behaviorTone([a({ id: '1', receivedAt: 0 }), a({ id: '2', type: 'C2_OVER_DAILY_LIMIT', receivedAt: 29 * MIN })])).toEqual({ tone: 'red', escalated: true });
  });

  it('même détecteur, autre compte ou plus de 30 min : pas d’aggravation', () => {
    expect(behaviorTone([a({ id: '1' }), a({ id: '2', receivedAt: 5 * MIN })])?.tone).toBe('amber');
    expect(behaviorTone([a({ id: '1', accountId: 'b' }), a({ id: '2', type: 'C3_MARTINGALE', receivedAt: 5 * MIN })])?.tone).toBe('amber');
    expect(behaviorTone([a({ id: '1' }), a({ id: '2', type: 'C3_MARTINGALE', receivedAt: 31 * MIN })])?.tone).toBe('amber');
  });
});
