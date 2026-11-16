/**
 * F7 (#1047) : courbes et calendrier des Statistiques étaient chargés par des `subscribe` qui ne
 * s'annulaient pas. Une réponse en retard (compte A, ou mois précédent) arrivant après la bonne
 * s'affichait sous l'étiquette du choix courant ; une erreur du calendrier gardait les données
 * de l'ancien choix, sans message.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AnalyticsComponent } from './analytics.component';
import { UserStore } from '../../core/stores/user.store';

type Cmp = {
  reload(): void;
  onMonthChange(e: { year: number; month: number }): void;
  selectPeriod(p: '1m' | '3m' | '6m' | 'all'): void;
  calData(): unknown;
  equityData(): unknown;
  loadError(): boolean;
};

describe('Statistiques : réponses en retard ignorées (F7 #1047)', () => {
  let http: HttpTestingController;
  let c: Cmp;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: UserStore, useValue: { isPremium: signal(true), isDemo: signal(false), user: signal({ id: 'u1' }), startingCapital: () => 0 } },
      ],
    });
    c = TestBed.runInInjectionContext(() => new AnalyticsComponent()) as unknown as Cmp;
    TestBed.tick();
    http = TestBed.inject(HttpTestingController);
  });

  const pending = (part: string) => http.match((r) => r.url.includes(part)).filter((r) => !r.cancelled);

  it('calendrier : octobre demandé puis novembre, la réponse d’octobre arrive en dernier → novembre reste affiché', () => {
    for (const r of pending('/activity/')) r.flush({ data: null });
    c.onMonthChange({ year: 2026, month: 10 });
    c.onMonthChange({ year: 2026, month: 11 });

    const [nov] = pending('/activity/2026/11');
    nov.flush({ data: { month: 'nov' } });
    const oct = http.match((r) => r.url.includes('/activity/2026/10'));
    for (const r of oct) if (!r.cancelled) r.flush({ data: { month: 'oct' } });

    expect(c.calData()).toEqual({ month: 'nov' });
  });

  it('calendrier en erreur : anciennes données retirées et erreur signalée', () => {
    for (const r of pending('/activity/')) r.flush({ data: { month: 'ancien' } });
    c.onMonthChange({ year: 2026, month: 11 });
    pending('/activity/2026/11')[0].flush('boom', { status: 500, statusText: 'Server Error' });

    expect(c.calData()).toBeNull();
    expect(c.loadError()).toBe(true);
  });

  it('courbes : période changée deux fois, la première réponse arrive en dernier → la seconde reste', () => {
    for (const r of pending('/equity-curve/')) r.flush({ data: null });
    c.selectPeriod('3m');
    const first = pending('/equity-curve/');
    c.selectPeriod('all');
    const second = pending('/equity-curve/').filter((r) => !first.includes(r));

    for (const r of second) r.flush({ data: { period: 'all' } });
    for (const r of first) if (!r.cancelled) r.flush({ data: { period: '3m' } });

    expect(c.equityData()).toEqual({ period: 'all' });
  });
});

// F8 (#1047) : reload() (compte passé échoué ou archivé en « Tous les comptes », bouton
// « Réessayer ») ne rechargeait pas le calendrier : ses trades y restaient.
describe('Statistiques : reload() recharge aussi le calendrier (F8 #1047)', () => {
  it('le mois affiché est redemandé', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: UserStore, useValue: { isPremium: signal(true), isDemo: signal(false), user: signal({ id: 'u1' }), startingCapital: () => 0 } },
      ],
    });
    const cmp = TestBed.runInInjectionContext(() => new AnalyticsComponent()) as unknown as Cmp;
    TestBed.tick();
    const http = TestBed.inject(HttpTestingController);
    for (const r of http.match((x) => x.url.includes('/activity/'))) if (!r.cancelled) r.flush({ data: null });

    cmp.reload();

    expect(http.match((x) => x.url.includes('/activity/')).filter((r) => !r.cancelled)).toHaveLength(1);
  });
});
