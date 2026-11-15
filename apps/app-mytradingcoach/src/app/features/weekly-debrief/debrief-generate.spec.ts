/**
 * Débrief : le bouton dit quelle semaine il génère (F5 #1047), et l'écran ne relance plus
 * l'API toutes les 15 s quand le trader n'a encore aucun débrief (F6 #1047).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DebriefComponent } from './debrief.component';
import { UserStore } from '../../core/stores/user.store';
import TEMPLATE from './debrief.component.html?raw';

describe('Débrief : bouton de génération (F5 #1047)', () => {
  it('le bouton nomme la semaine générée : la semaine en cours', () => {
    expect(TEMPLATE).toContain("'Générer le débrief de cette semaine'");
    expect(TEMPLATE).toContain('Clique sur « Générer le débrief de cette semaine »');
  });
});

describe('Débrief : un seul chargement à l’ouverture (F6 #1047)', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UserStore, useValue: { isPremium: () => true, isDemo: () => false } },
      ],
    });
    TestBed.overrideComponent(DebriefComponent, {
      set: { imports: [], template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
  });
  afterEach(() => {
    http?.verify();
    vi.useRealTimers();
  });

  it('aucun débrief encore (null) : pas de nouvelle requête 15 s plus tard', () => {
    const fixture = TestBed.createComponent(DebriefComponent);
    http = TestBed.inject(HttpTestingController);
    vi.advanceTimersByTime(0);
    http.expectOne((r) => r.url.endsWith('/debrief/current')).flush({ data: null });
    // Requêtes annexes du composant (comptes) : hors sujet ici.
    for (const req of http.match((r) => r.url.endsWith('/accounts'))) req.flush({ data: [] });

    vi.advanceTimersByTime(60_000);

    http.expectNone((r) => r.url.endsWith('/debrief/current'));
    expect((fixture.componentInstance as unknown as { isLoading: () => boolean }).isLoading()).toBe(false);
  });
});
