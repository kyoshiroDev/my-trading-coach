/**
 * Score : carte Streak branchée sur l'activité réelle, carte Badges toujours masquée (décisions du
 * 25/10/2026). Rendu réel du composant (gabarit réel, requêtes simulées), compte Premium normal ET
 * compte démo : 35 pastilles colorées d'après `GET /analytics/activity/range`, série calculée, aucun
 * badge ; erreur de chargement → message + « Réessayer » ; compte gratuit → aucune requête d'activité.
 * Les règles fines (jours ouvrés, seuils, série) sont testées dans streak.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LucideDynamicIcon } from '@lucide/angular';
import { todayParis } from '@mtc/shared';
import { ScoringComponent, computeScore } from './scoring.component';
import { decalerJour, joursOuvres } from './streak';
import { AuthService } from '../../core/auth/auth.service';
import TEMPLATE from './scoring.component.html?raw';

type T = Parameters<typeof computeScore>[0][number];
const trade = (i: number): T => ({
  pnl: i % 2 ? 50 : -30, riskReward: 1.5, emotion: null, effectiveEmotion: null, setupId: 's1',
  tradedAt: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T10:00:00.000Z`,
});

const PREMIUM = { id: 'u1', email: 'p@example.test', plan: 'PREMIUM', role: 'USER', isDemo: false };
const DEMO = { id: 'u2', email: 'demo@example.test', plan: 'PREMIUM', role: 'USER', isDemo: true };
const FREE = { id: 'u3', email: 'f@example.test', plan: 'FREE', role: 'USER', isDemo: false };
const COMPTES = [['Premium', PREMIUM], ['démo', DEMO]] as const;

// Activité : les 3 derniers jours ouvrés tradés (1, 3 et 7 trades), le 4e sans trade → série de 3.
const AUJOURDHUI = todayParis();
const [, j3, j2, j1] = joursOuvres(AUJOURDHUI, 4);
const ACTIVITE = [{ date: j3, tradesCount: 1 }, { date: j2, tradesCount: 3 }, { date: j1, tradesCount: 7 }];

describe('Score : Streak réel, Badges masqués', () => {
  let http: HttpTestingController;

  async function rendre(user: object, opts: { trades?: number; activite?: 'ok' | 'vide' | 'erreur' } = {}) {
    // Le JIT des specs ne résout pas `templateUrl` : vrai gabarit (?raw), sans la feuille de style.
    TestBed.overrideComponent(ScoringComponent, {
      set: { template: TEMPLATE, styleUrl: undefined, styles: [], imports: [LucideDynamicIcon], schemas: [NO_ERRORS_SCHEMA] },
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentUser: signal(user), isAuthenticated: signal(true) } },
      ],
    });
    const fixture = TestBed.createComponent(ScoringComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.url.includes('/trades')).flush({ data: { data: Array.from({ length: opts.trades ?? 12 }, (_, i) => trade(i)) } });
    if (opts.activite) {
      const req = http.expectOne((r) => r.url.includes('/analytics/activity/range'));
      if (opts.activite === 'erreur') req.flush('boom', { status: 500, statusText: 'Server Error' });
      else req.flush({ data: { days: opts.activite === 'vide' ? [] : ACTIVITE } });
    }
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, fixture };
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => http?.verify());

  it.each(COMPTES)('compte %s : 35 pastilles réelles, série calculée, aucun badge', async (_, user) => {
    const { el } = await rendre(user, { activite: 'ok' });
    const dots = [...el.querySelectorAll('.streak-card .streak-dot')];
    expect(dots).toHaveLength(35);
    expect(dots.slice(-4).map((d) => [...d.classList].find((c) => c.startsWith('niveau-')))).toEqual(
      ['niveau-0', 'niveau-1', 'niveau-2', 'niveau-4'],
    );
    expect(dots.at(-1)?.getAttribute('title')).toContain('7 trades');
    expect(dots.at(-4)?.getAttribute('title')).toContain('aucun trade');
    expect(el.querySelector('.streak-info')?.textContent?.replace(/\s+/g, ' ')).toContain('3 jours ouvrés consécutifs');
    expect(el.querySelector('.badges-card')).toBeNull();
    expect(el.textContent).not.toContain('Badges obtenus');
  });

  it('demande les bons jours : un an ouvré, un jour de marge de chaque côté', async () => {
    TestBed.overrideComponent(ScoringComponent, {
      set: { template: TEMPLATE, styleUrl: undefined, styles: [], imports: [LucideDynamicIcon], schemas: [NO_ERRORS_SCHEMA] },
    });
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { currentUser: signal(PREMIUM), isAuthenticated: signal(true) } }],
    });
    const fixture = TestBed.createComponent(ScoringComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.url.includes('/trades')).flush({ data: { data: [] } });
    const req = http.expectOne((r) => r.url.includes('/analytics/activity/range'));
    const url = new URL(req.request.urlWithParams, 'http://x');
    expect(url.searchParams.get('from')).toBe(decalerJour(joursOuvres(AUJOURDHUI, 260)[0], -1));
    expect(url.searchParams.get('to')).toBe(decalerJour(AUJOURDHUI, 1));
    req.flush({ data: { days: [] } });
  });

  it('aucune activité : 35 pastilles au niveau 0, « 0 jour ouvré consécutif »', async () => {
    const { el } = await rendre(PREMIUM, { activite: 'vide' });
    const dots = [...el.querySelectorAll('.streak-dot')];
    expect(dots).toHaveLength(35);
    expect(dots.every((d) => d.classList.contains('niveau-0'))).toBe(true);
    expect(el.querySelector('.streak-info')?.textContent?.replace(/\s+/g, ' ')).toContain('0 jour ouvré consécutif');
  });

  it('erreur de chargement : message et bouton « Réessayer », pas de série inventée', async () => {
    const { el } = await rendre(PREMIUM, { activite: 'erreur' });
    expect(el.querySelector('.streak-card mtc-error-state')).not.toBeNull();
    expect(el.querySelector('.streak-dot')).toBeNull();
    expect(el.textContent).not.toContain('Série actuelle');
  });

  it('compte gratuit : paywall, aucune requête d’activité', async () => {
    const { el } = await rendre(FREE);
    expect(el.querySelector('.premium-paywall')).not.toBeNull();
    http.expectNone((r) => r.url.includes('/analytics/activity/range'));
  });

  it.each(COMPTES)('compte %s, moins de 10 trades : le conseil reste affiché', async (_, user) => {
    const { el } = await rendre(user, { trades: 3, activite: 'ok' });
    expect(el.querySelector('.advice-banner')?.textContent).toContain('3/10');
    expect(el.querySelector('.badges-card')).toBeNull();
  });
});
