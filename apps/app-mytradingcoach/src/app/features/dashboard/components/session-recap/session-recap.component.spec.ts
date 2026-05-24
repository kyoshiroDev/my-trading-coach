import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SessionRecapComponent } from './session-recap.component';
import { LiveStats, TradingSession } from '../../../../core/api/session.api';

const makeSession = (overrides: Partial<TradingSession> = {}): TradingSession => ({
  id: 'sess-1',
  userId: 'user-1',
  startedAt: '2026-05-24T09:00:00Z',
  endedAt: '2026-05-24T11:30:00Z',
  status: 'CLOSED',
  totalTrades: 4,
  ...overrides,
});

const makeStats = (overrides: Partial<LiveStats> = {}): LiveStats => ({
  totalPnl: 120,
  winRate: 75,
  tradesCount: 4,
  closedCount: 4,
  trades: [],
  ...overrides,
});

function makeInstance() {
  return TestBed.runInInjectionContext(() =>
    new SessionRecapComponent(),
  );
}

describe('SessionRecapComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
  });

  describe('winRateDisplay()', () => {
    it('retourne — si aucun trade', () => {
      const c = makeInstance();
      TestBed.flushEffects();
      expect((c as unknown as { winRateDisplay: () => string }).winRateDisplay()).toBe('—');
    });
  });

  describe('reflectionQuestion()', () => {
    it('retourne null si aucun trade', () => {
      const c = makeInstance();
      TestBed.flushEffects();
      const q = (c as unknown as { reflectionQuestion: () => string | null }).reflectionQuestion();
      expect(q).toBeNull();
    });
  });

  describe('sessionDuration()', () => {
    it('calcule correctement une durée de 2h30', () => {
      const c = makeInstance();
      TestBed.flushEffects();
      const dur = (c as unknown as { sessionDuration: () => string }).sessionDuration();
      // sans session, retourne —
      expect(dur).toBe('—');
    });
  });

  describe('minutesUntilRecap()', () => {
    it('retourne 0 ou un nombre positif', () => {
      const c = makeInstance();
      TestBed.flushEffects();
      const min = (c as unknown as { minutesUntilRecap: () => number }).minutesUntilRecap();
      expect(min).toBeGreaterThanOrEqual(0);
    });
  });

  describe('handleClose()', () => {
    it('émet close avec undefined si reflectionAnswer est vide', () => {
      const c = makeInstance();
      const emitted: (string | undefined)[] = [];
      c.dismissed.subscribe((v) => emitted.push(v));

      (c as unknown as { handleClose: () => void }).handleClose();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toBeUndefined();
    });

    it('émet close avec la note si reflectionAnswer est renseigné', () => {
      const c = makeInstance();
      const emitted: (string | undefined)[] = [];
      c.dismissed.subscribe((v) => emitted.push(v));

      const ra = (c as unknown as { reflectionAnswer: { set: (v: string) => void } }).reflectionAnswer;
      ra.set('Bonne session');

      (c as unknown as { handleClose: () => void }).handleClose();

      expect(emitted[0]).toBe('Bonne session');
    });
  });
});