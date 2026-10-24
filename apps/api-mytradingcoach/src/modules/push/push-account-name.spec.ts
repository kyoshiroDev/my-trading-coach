import { describe, it, expect } from 'vitest';
import { accountPushName, formatAccountSize } from './push-account-name';

describe('formatAccountSize', () => {
  it.each([[50_000, '50K'], [150_000, '150K'], [7_500, '7,5K'], [1_000_000, '1M']])('%d → %s', (n, s) => {
    expect(formatAccountSize(n)).toBe(s);
  });
});

describe('accountPushName', () => {
  it('compte inconnu : « ton compte »', () => {
    expect(accountPushName([], 'x')).toBe('ton compte');
  });
});
