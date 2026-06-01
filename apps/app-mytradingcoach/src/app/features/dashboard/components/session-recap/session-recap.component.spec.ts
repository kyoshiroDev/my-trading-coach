import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SessionRecapComponent } from './session-recap.component';

function makeInstance() {
  return TestBed.runInInjectionContext(() => new SessionRecapComponent());
}

describe('SessionRecapComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  describe('winRateDisplay()', () => {
    it('retourne — si aucun trade (stats nulles)', () => {
      const c = makeInstance();
      TestBed.flushEffects();
      expect((c as unknown as { winRateDisplay: () => string }).winRateDisplay()).toBe('—');
    });
  });

  describe('sessionDuration()', () => {
    it('retourne — sans session', () => {
      const c = makeInstance();
      TestBed.flushEffects();
      const dur = (c as unknown as { sessionDuration: () => string }).sessionDuration();
      expect(dur).toBe('—');
    });
  });
});
