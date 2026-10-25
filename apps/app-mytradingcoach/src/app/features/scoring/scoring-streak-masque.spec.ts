/**
 * Cartes « Badges obtenus » et « Streak & activité » masquées tant que leurs données sont inventées
 * (STREAK_ET_BADGES_VISIBLES = false, décision du 25/10/2026). Rendu réel du composant, compte Premium
 * normal ET compte démo : aucune des deux cartes ; la carte du score reste, sur toute la largeur, et le
 * conseil des 10 trades (données réelles) reste affiché quand il y a moins de 10 trades.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LucideDynamicIcon } from '@lucide/angular';
import { ScoringComponent, computeScore } from './scoring.component';
import { AuthService } from '../../core/auth/auth.service';
import TEMPLATE from './scoring.component.html?raw';

type T = Parameters<typeof computeScore>[0][number];
const trade = (i: number): T => ({
  pnl: i % 2 ? 50 : -30, riskReward: 1.5, emotion: null, effectiveEmotion: null, setupId: 's1',
  tradedAt: `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T10:00:00.000Z`,
});

const COMPTES = [
  ['Premium', { id: 'u1', email: 'p@example.test', plan: 'PREMIUM', role: 'USER', isDemo: false }],
  ['démo', { id: 'u2', email: 'demo@example.test', plan: 'PREMIUM', role: 'USER', isDemo: true }],
] as const;

describe('Score : cartes Streak et Badges masquées', () => {
  let http: HttpTestingController;

  async function rendre(user: (typeof COMPTES)[number][1], nbTrades: number): Promise<HTMLElement> {
    // Le JIT des specs ne résout pas `templateUrl` : vrai gabarit (?raw), sans la feuille de style.
    // Topbar, modale de plan et état d'erreur hors sujet : seul le contenu de la page compte ici.
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
    http.expectOne((r) => r.url.includes('/trades')).flush({ data: { data: Array.from({ length: nbTrades }, (_, i) => trade(i)) } });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => http?.verify());

  it.each(COMPTES)('compte %s : ni Streak ni Badges, score sur toute la largeur', async (_, user) => {
    const el = await rendre(user, 12);
    expect(el.querySelector('.grid-2 > .card'), 'carte du score absente').not.toBeNull();
    expect(el.querySelector('.streak-card')).toBeNull();
    expect(el.querySelector('.streak-dot')).toBeNull();
    expect(el.querySelector('.badges-card')).toBeNull();
    expect(el.querySelector('.badges-grid')).toBeNull();
    expect(el.textContent).not.toContain('Série actuelle');
    expect(el.textContent).not.toContain('Badges obtenus');
    expect(el.querySelector('.grid-2')?.classList.contains('une-colonne')).toBe(true);
    // 12 trades : plus de conseil, donc plus de colonne de droite du tout (pas de bloc vide).
    expect(el.querySelector('.right-col')).toBeNull();
  });

  it.each(COMPTES)('compte %s, moins de 10 trades : le conseil reste affiché', async (_, user) => {
    const el = await rendre(user, 3);
    expect(el.querySelector('.advice-banner')?.textContent).toContain('3/10');
    expect(el.querySelector('.streak-card')).toBeNull();
    expect(el.querySelector('.badges-card')).toBeNull();
  });
});
