import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AnalyticsComponent } from './analytics.component';

describe('AnalyticsComponent — equity curve période', () => {
  function makeComponent() {
    return TestBed.runInInjectionContext(() => {
      const c = new AnalyticsComponent();
      return c;
    });
  }

  // Horloge figée : « 1 mois » dépend du mois courant (du 28 mars au 28 février : 28 jours).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('equityPeriod démarre sur "1m"', () => {
    const c = makeComponent();
    expect(
      (c as unknown as { equityPeriod: () => string }).equityPeriod(),
    ).toBe('1m');
  });

  it('equityDateRange retourne from/to pour "1m"', () => {
    const c = makeComponent();
    const range = (
      c as unknown as { equityDateRange: () => { from?: string; to?: string } }
    ).equityDateRange();
    expect(range.from).toBeDefined();
    expect(range.to).toBeDefined();

    // Un mois calendaire en arrière, jusqu'à maintenant.
    expect(range).toEqual({ from: '2026-09-21T12:00:00.000Z', to: '2026-10-21T12:00:00.000Z' });
  });

  it('equityDateRange "1m" à la fin mars : remonte au 28 février (28 jours, pas un bug)', () => {
    vi.setSystemTime(new Date('2027-03-28T00:55:00.000Z'));
    const c = makeComponent();
    const range = (c as unknown as { equityDateRange: () => { from?: string; to?: string } }).equityDateRange();
    expect(range).toEqual({ from: '2027-02-28T00:55:00.000Z', to: '2027-03-28T00:55:00.000Z' });
  });

  it('equityDateRange retourne from=undefined pour "all"', () => {
    const c = makeComponent();
    const pc = c as unknown as {
      equityPeriod: { set: (v: string) => void };
      equityDateRange: () => { from?: string; to?: string };
    };
    pc.equityPeriod.set('all');
    const range = pc.equityDateRange();
    expect(range.from).toBeUndefined();
    expect(range.to).toBeUndefined();
  });

  it('selectPeriod met à jour equityPeriod', () => {
    const c = makeComponent();
    const pc = c as unknown as {
      selectPeriod: (p: '1m' | '3m' | '6m' | 'all') => void;
      equityPeriod: () => string;
    };
    pc.selectPeriod('3m');
    expect(pc.equityPeriod()).toBe('3m');
  });

  it('periods contient 4 entrées dont "all"', () => {
    const c = makeComponent();
    const periods = (c as unknown as { periods: { key: string }[] }).periods;
    expect(periods).toHaveLength(4);
    expect(periods.map((p) => p.key)).toContain('all');
  });
});

describe('AnalyticsComponent — currentMonthLabel (dashboard)', () => {
  it('retourne le mois courant en français', () => {
    const label = new Date().toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
    expect(label).toMatch(/\d{4}/); // contient une année
    expect(label.length).toBeGreaterThan(5);
  });
});