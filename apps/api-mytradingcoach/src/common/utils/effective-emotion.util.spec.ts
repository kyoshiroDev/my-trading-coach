import { describe, it, expect } from 'vitest';
import { EmotionState, MoodState } from '@prisma/client';
import {
  effectiveEmotion,
  isRiskyEmotion,
  isHealthyEmotion,
} from './effective-emotion.util';

describe('effectiveEmotion', () => {
  it('override du trade prioritaire sur l\'humeur de session', () => {
    expect(
      effectiveEmotion({ emotion: EmotionState.REVENGE, tradeSession: { moodStart: MoodState.FOCUSED } }),
    ).toBe('REVENGE');
  });

  it('sans override → humeur de la journée (moodStart)', () => {
    expect(
      effectiveEmotion({ emotion: null, tradeSession: { moodStart: MoodState.CONFIDENT } }),
    ).toBe('CONFIDENT');
  });

  it('sans override ni session → null (non renseignée)', () => {
    expect(effectiveEmotion({ emotion: null, tradeSession: null })).toBeNull();
    expect(effectiveEmotion({ emotion: null })).toBeNull();
    expect(effectiveEmotion({})).toBeNull();
  });

  it('session sans moodStart → null', () => {
    expect(effectiveEmotion({ emotion: null, tradeSession: { moodStart: null } })).toBeNull();
  });
});

describe('isRiskyEmotion', () => {
  it('STRESSED / REVENGE / FEAR / TIRED sont à risque', () => {
    for (const e of ['STRESSED', 'REVENGE', 'FEAR', 'TIRED']) {
      expect(isRiskyEmotion(e)).toBe(true);
    }
  });
  it('les émotions saines ne sont pas à risque', () => {
    for (const e of ['CONFIDENT', 'FOCUSED', 'NEUTRAL']) {
      expect(isRiskyEmotion(e)).toBe(false);
    }
  });
  it('null / undefined → false', () => {
    expect(isRiskyEmotion(null)).toBe(false);
    expect(isRiskyEmotion(undefined)).toBe(false);
  });
});

describe('isHealthyEmotion', () => {
  it('CONFIDENT / FOCUSED / NEUTRAL sont saines', () => {
    for (const e of ['CONFIDENT', 'FOCUSED', 'NEUTRAL']) {
      expect(isHealthyEmotion(e)).toBe(true);
    }
  });
  it('les émotions à risque ne sont pas saines', () => {
    for (const e of ['STRESSED', 'REVENGE', 'FEAR', 'TIRED']) {
      expect(isHealthyEmotion(e)).toBe(false);
    }
  });
  it('null → ni saine ni risquée', () => {
    expect(isHealthyEmotion(null)).toBe(false);
    expect(isRiskyEmotion(null)).toBe(false);
  });
});