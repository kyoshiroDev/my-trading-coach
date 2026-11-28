import { describe, it, expect } from 'vitest';
import { billingInterval, withBillingInterval } from './billing-interval.util';

describe('billingInterval (#1156)', () => {
  it.each([
    ['month', 'month'],
    ['year', 'year'],
    [null, null],
    ['week', null],
    ['', null],
  ] as const)('%s → %s', (value, expected) => {
    expect(billingInterval(value)).toBe(expected);
  });

  it('withBillingInterval garde les autres champs', () => {
    expect(withBillingInterval({ id: 'u1', stripeInterval: 'day' })).toEqual({ id: 'u1', stripeInterval: null });
  });
});
