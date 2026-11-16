/**
 * Épingles (F10 #1047) : la mise à jour affichée avant l'envoi n'était jamais annulée quand
 * l'enregistrement échouait (API en panne, compte démo en lecture seule).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { EcoCalendarComponent } from './eco-calendar.component';
import { EcoCalendarApi } from '../../core/api/eco-calendar.api';
import { UserStore } from '../../core/stores/user.store';
import { ToastService } from '../../core/services/toast.service';
import { DebriefApi } from '../../core/api/debrief.api';
import { SessionMorningComponent } from '../dashboard/components/session-morning/session-morning.component';
import type { EcoEvent } from '@mtc/shared';

function ev(date: string, name: string): EcoEvent {
  return {
    date, time: '10:00', name, impact: 'high', country: 'US', currency: 'USD',
    actual: null, estimate: null, previous: null, isReleased: false, unit: null,
  };
}

function setup(api: Partial<Record<keyof EcoCalendarApi, unknown>>) {
  const full = {
    getPins: vi.fn(() => of({ data: [] })),
    getPinnedUpcoming: vi.fn(() => of({ data: [] })),
    getEventsRange: vi.fn(() => of({ data: [] })),
    savePins: vi.fn(() => of({ data: [] })),
    analyzeResult: vi.fn(() => of({ data: null })),
    getReleaseAnalyses: vi.fn(() => of({ data: {} })),
    ...api,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: EcoCalendarApi, useValue: full },
      { provide: UserStore, useValue: { user: signal(null) } },
      { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
    ],
  });
  TestBed.overrideComponent(EcoCalendarComponent, {
    set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(EcoCalendarComponent);
  fixture.detectChanges();
  return { cmp: fixture.componentInstance as any, api: full };
}

describe('Calendrier éco : épingle non enregistrée (F10 #1047)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('enregistrement en échec : l’épingle reprend son état d’avant', () => {
    const { cmp } = setup({ savePins: vi.fn(() => throwError(() => new Error('500'))) });
    const event = ev('2026-11-16', 'CPI');

    cmp.togglePin(event);

    expect(cmp.isPinned(event)).toBe(false);
  });
});

describe('Carte du matin : désépinglage non enregistré (F10 #1047)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('enregistrement en échec : l’annonce revient dans la sélection', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: EcoCalendarApi, useValue: { getPins: vi.fn(() => of({ data: ['CPI:USD', 'NFP:USD'] })), savePins: vi.fn(() => throwError(() => new Error('500'))) } },
        { provide: DebriefApi, useValue: {} },
        { provide: UserStore, useValue: { user: signal(null), isDemo: signal(false), isPremium: signal(true) } },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(SessionMorningComponent, {
      set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(SessionMorningComponent);
    // Épingles du serveur : CPI et NFP (getPins).
    fixture.detectChanges();
    const cmp = fixture.componentInstance as any;

    cmp.unpinEvent({ name: 'CPI', currency: 'USD' });

    expect(cmp.isEventPinned({ name: 'CPI', currency: 'USD' })).toBe(true);
  });
});
