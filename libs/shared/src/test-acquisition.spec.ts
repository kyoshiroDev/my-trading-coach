import { describe, expect, it } from 'vitest';
import { testPatternToLike, TEST_ACQUISITION_PATTERNS } from './test-acquisition';

// Le filtre lui-même (exact ou préfixe, jamais « contient ») est vérifié en SQL sur une vraie base :
// apps/api-mytradingcoach/src/common/stats/test-acquisition.int-spec.ts.
describe('campagnes de test (#1029) : motifs → LIKE', () => {
  it('préfixe = %, exact sinon, jokers échappés', () => {
    expect(testPatternToLike('test-*')).toBe('test-%');
    expect(testPatternToLike('ami')).toBe('ami');
    expect(testPatternToLike('TEST')).toBe('test');
    expect(testPatternToLike('a_b%*')).toBe('a\\_b\\%%');
    expect(TEST_ACQUISITION_PATTERNS.map(testPatternToLike)).toEqual(['test', 'test-%', 'ami']);
  });
});
