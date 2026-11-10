import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { EcoCalendarComponent } from './eco-calendar.component';
import { EcoCalendarApi } from '../../core/api/eco-calendar.api';
import { UserStore } from '../../core/stores/user.store';
import type { EcoEvent } from '@mtc/shared';

function ev(partial: Partial<EcoEvent>): EcoEvent {
  return {
    date: '2026-06-11', time: '10:00', name: 'Event', impact: 'medium',
    country: '', currency: 'USD', actual: null, estimate: null, previous: null,
    isReleased: false, unit: null, ...partial,
  };
}

interface SetupOpts {
  events?: EcoEvent[];
  user?: { tradingSessions?: string[]; isDemo?: boolean } | null;
  analysis?: { interpretation: string; assetSentiments: { asset: string; sentiment: 'bull' | 'bear' | 'neutral'; shortReason: string }[] };
}

function setup(opts: SetupOpts = {}) {
  const day = { date: '2026-06-11', events: opts.events ?? [] };
  const api = {
    getPins: vi.fn(() => of({ data: [] })),
    getPinnedUpcoming: vi.fn(() => of({ data: [] })),
    getEventsRange: vi.fn(() => of({ data: [day] })),
    savePins: vi.fn(() => of({ data: [] })),
    analyzeResult: vi.fn(() => of({ data: opts.analysis ?? { interpretation: 'interp', assetSentiments: [] } })),
  };
  const userStore = {
    user: signal(opts.user ?? null),
  };

  TestBed.configureTestingModule({
    providers: [
      { provide: EcoCalendarApi, useValue: api },
      { provide: UserStore, useValue: userStore },
    ],
  });
  // En JIT (vitest), templateUrl/styleUrl ne sont pas résolus → on teste la logique
  // de classe avec un template minimal.
  TestBed.overrideComponent(EcoCalendarComponent, {
    set: {
      template: '<div></div>',
      styleUrls: [],
      styleUrl: undefined as unknown as string,
      imports: [],
      schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(EcoCalendarComponent);
  fixture.detectChanges();
   
  return { fixture, cmp: fixture.componentInstance as any, api };
}

describe('EcoCalendarComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('regroupement par session de devise', () => {
    it('classe JPY→asie, EUR→europe, USD→us (par devise, pas par heure)', () => {
      const { cmp } = setup({
        events: [
          ev({ currency: 'JPY', time: '02:00' }),
          ev({ currency: 'EUR', time: '14:15' }),   // 14:15 mais EUR ⇒ europe
          ev({ currency: 'USD', time: '14:30' }),
          ev({ currency: 'USD', time: '16:00' }),
        ],
      });
      const counts = cmp.tabCounts();
      expect(counts).toEqual({ all: 4, asia: 1, europe: 1, us: 2 });
    });

    it('PHP → asie ; devise inconnue de nuit → asie et non plus europe', () => {
      const { cmp } = setup({
        events: [
          ev({ currency: 'PHP', time: '03:00' }),
          ev({ currency: 'XYZ', time: '02:30' }),
          ev({ currency: 'XYZ', time: '10:00' }),
          ev({ currency: 'XYZ', time: '15:00' }),
        ],
      });
      expect(cmp.tabCounts()).toEqual({ all: 4, asia: 2, europe: 1, us: 1 });
    });
  });

  describe('onglet par défaut depuis tradingSessions', () => {
    it('une seule session connue (NEW_YORK) → onglet us', () => {
      const { cmp } = setup({ user: { tradingSessions: ['NEW_YORK'] } });
      expect(cmp.sessionTab()).toBe('us');
    });
    it('LONDON → europe', () => {
      const { cmp } = setup({ user: { tradingSessions: ['LONDON'] } });
      expect(cmp.sessionTab()).toBe('europe');
    });
    it('plusieurs sessions → Tous', () => {
      const { cmp } = setup({ user: { tradingSessions: ['LONDON', 'NEW_YORK'] } });
      expect(cmp.sessionTab()).toBe('all');
    });
    it('aucune session → Tous', () => {
      const { cmp } = setup({ user: { tradingSessions: [] } });
      expect(cmp.sessionTab()).toBe('all');
    });
  });

  describe('tabbedEvents — cumul onglet + filtre impact', () => {
    it('filtre par session et par impact', () => {
      const { cmp } = setup({
        events: [
          ev({ currency: 'EUR', impact: 'high', name: 'BCE' }),
          ev({ currency: 'EUR', impact: 'medium', name: 'PMI EUR' }),
          ev({ currency: 'USD', impact: 'high', name: 'NFP' }),
        ],
      });
      cmp.setSessionTab('europe');
      expect(cmp.tabbedEvents().map((e: EcoEvent) => e.name).sort()).toEqual(['BCE', 'PMI EUR']);
      cmp.filterImpact.set('high');
      expect(cmp.tabbedEvents().map((e: EcoEvent) => e.name)).toEqual(['BCE']);
    });
  });

  describe('toggleAnalysis — lazy + cache', () => {
    it('un seul appel réseau, déplie/replie, re-ouverture sans nouvel appel', () => {
      const { cmp, api } = setup({ analysis: { interpretation: 'IPP conforme', assetSentiments: [{ asset: 'USD', sentiment: 'bear', shortReason: 'r' }] } });
      const target = ev({ name: 'IPP', impact: 'high', isReleased: true, currency: 'USD' });

      cmp.toggleAnalysis(target);                        // 1er dépliage → 1 appel
      expect(api.analyzeResult).toHaveBeenCalledTimes(1);
      expect(cmp.isOpen(target)).toBe(true);
      expect(cmp.analysisFor(target)?.interpretation).toBe('IPP conforme');

      cmp.toggleAnalysis(target);                        // replie
      expect(cmp.isOpen(target)).toBe(false);

      cmp.toggleAnalysis(target);                        // ré-ouverture → cache, pas de nouvel appel
      expect(api.analyzeResult).toHaveBeenCalledTimes(1);
      expect(cmp.isOpen(target)).toBe(true);
    });

    it('ccySent prend le sentiment de la devise de l\'event', () => {
      const { cmp } = setup({ analysis: { interpretation: 'x', assetSentiments: [{ asset: 'EUR', sentiment: 'bull', shortReason: 'r' }] } });
      const target = ev({ name: 'BCE', impact: 'high', isReleased: true, currency: 'EUR' });
      expect(cmp.ccySent(target)).toBe('neutral');       // avant chargement
      cmp.toggleAnalysis(target);
      expect(cmp.ccySent(target)).toBe('bull');          // après chargement
    });
  });

  describe('analyse sans clic (#920)', () => {
    it("annonce forte publiée aujourd'hui : analyse chargée et dépliée au chargement de la semaine", () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-11T16:00:00Z'));
      try {
        const nfp = ev({ name: 'NFP', impact: 'high', isReleased: true, actual: 210 });
        const { cmp, api } = setup({ events: [nfp, ev({ name: 'ISM', impact: 'medium', isReleased: true }), ev({ name: 'CPI', impact: 'high' })] });
        expect(api.analyzeResult).toHaveBeenCalledTimes(1);
        expect(api.analyzeResult).toHaveBeenCalledWith('NFP');
        expect(cmp.isOpen(nfp)).toBe(true);
        expect(cmp.analysisFor(nfp)?.interpretation).toBe('interp');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('iaState', () => {
    it('fort publié → ready, fort non publié → wait, moyen → na', () => {
      const { cmp } = setup();
      expect(cmp.iaState(ev({ impact: 'high', isReleased: true }))).toBe('ready');
      expect(cmp.iaState(ev({ impact: 'high', isReleased: false }))).toBe('wait');
      expect(cmp.iaState(ev({ impact: 'medium', isReleased: true }))).toBe('na');
    });

    it('intervention forte sans chiffre → talk, jamais analysée', () => {
      const { cmp } = setup();
      expect(cmp.iaState(ev({ impact: 'high', hasResult: false }))).toBe('talk');
    });
  });

  describe('interventions sans chiffre (#920)', () => {
    it('statut neutre avant et après, ligne « passée » distincte de « publiée », aucune analyse chargée', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-11T19:45:00Z')); // 21:45 Paris
      try {
        const talk = ev({ name: 'Powell', impact: 'high', time: '20:30', hasResult: false, status: 'past' });
        const fed = ev({ name: 'Fed', impact: 'high', time: '20:00', isReleased: true, actual: 3.75, status: 'released' });
        const { cmp, api } = setup({ events: [talk, fed] });
        const states = Object.fromEntries(
          cmp.tableRows().filter((r: { kind: string }) => r.kind === 'ev').map((r: { event: EcoEvent; state: string }) => [r.event.name, r.state]),
        );
        expect(states).toEqual({ Powell: 'past', Fed: 'published' });
        expect(api.analyzeResult).toHaveBeenCalledWith('Fed');
        expect(api.analyzeResult).not.toHaveBeenCalledWith('Powell');
        expect(cmp.talkStatus(talk, false)).toBe(
          "Intervention prévue à 20:30, volatilité possible. Pas de résultat chiffré, pas d'analyse automatique.",
        );
        expect(cmp.talkStatus(talk, true)).toBe(
          "Intervention passée (20:30). Pas de résultat chiffré, pas d'analyse automatique.",
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('analyse sans clic · compte démo (#920)', () => {
    it("démo : aucun chargement ni dépliage d'office (POST refusé en lecture seule), le clic reste possible", () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-11T16:00:00Z'));
      try {
        const nfp = ev({ name: 'NFP', impact: 'high', isReleased: true, actual: 210 });
        const { cmp, api } = setup({ events: [nfp], user: { isDemo: true } });
        expect(api.analyzeResult).not.toHaveBeenCalled();
        expect(cmp.isOpen(nfp)).toBe(false);
        cmp.toggleAnalysis(nfp);
        expect(api.analyzeResult).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
