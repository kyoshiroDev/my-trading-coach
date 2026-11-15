import { describe, expect, it } from 'vitest';
import { isTestAcquisition, isTestAcquisitionValue, testPatternToLike, TEST_ACQUISITION_PATTERNS } from './test-acquisition';

describe('campagnes de test (#1029)', () => {
  it('exclut les campagnes de test vues en prod, garde la vraie newsletter', () => {
    expect(isTestAcquisition({ source: 'ninjatrader', medium: 'newsletter', campaign: 'test-prod-essai' })).toBe(true);
    expect(isTestAcquisition({ source: 'instagram', medium: 'paid', campaign: 'test-greg4' })).toBe(true);
    expect(isTestAcquisition({ source: 'ami', medium: 'test', campaign: 'lecture' })).toBe(true);
    expect(isTestAcquisition({ source: 'ninjatrader', medium: 'newsletter', campaign: 'newsletter-novembre-2026' })).toBe(false);
    expect(isTestAcquisition({ source: 'instagram', medium: 'paid', campaign: 'gratuit-reel' })).toBe(false);
    expect(isTestAcquisition({ source: null, medium: null, campaign: null })).toBe(false);
  });

  it('préfixe seulement, jamais « contient »', () => {
    expect(isTestAcquisitionValue('contest')).toBe(false);
    expect(isTestAcquisitionValue('latest-promo')).toBe(false);
    expect(isTestAcquisitionValue('testament')).toBe(false);
    expect(isTestAcquisitionValue('TEST-Greg')).toBe(true);
    expect(isTestAcquisitionValue('test')).toBe(true);
  });

  it('ami est exact', () => {
    expect(isTestAcquisitionValue('amis-trading')).toBe(false);
    expect(isTestAcquisitionValue('miami')).toBe(false);
    expect(isTestAcquisitionValue('Ami')).toBe(true);
  });

  it('traduit les motifs en LIKE avec les jokers échappés', () => {
    expect(testPatternToLike('test-*')).toBe('test-%');
    expect(testPatternToLike('ami')).toBe('ami');
    expect(testPatternToLike('a_b%*')).toBe('a\\_b\\%%');
    expect(TEST_ACQUISITION_PATTERNS.map(testPatternToLike)).toEqual(['test', 'test-%', 'ami']);
  });
});
