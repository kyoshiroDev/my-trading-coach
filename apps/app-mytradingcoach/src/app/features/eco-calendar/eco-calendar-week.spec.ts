/**
 * Calendrier éco, navigation par semaine (F9 #1047) : une réponse en retard (semaine S+1) arrivée
 * après celle de S+2 s'affichait sous le titre de S+2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { Subject, of } from 'rxjs';
import { EcoCalendarComponent } from './eco-calendar.component';
import { EcoCalendarApi } from '../../core/api/eco-calendar.api';
import { UserStore } from '../../core/stores/user.store';
import { ToastService } from '../../core/services/toast.service';
import type { EcoEvent } from '@mtc/shared';

type Range = { data: { date: string; events: EcoEvent[] }[] };

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

describe('Calendrier éco : semaine affichée (F9 #1047)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('S+1 puis S+2 demandées vite, la réponse de S+1 arrive en dernier → S+2 reste affichée', () => {
    const responses: Subject<Range>[] = [];
    const { cmp } = setup({
      getEventsRange: vi.fn(() => { const s = new Subject<Range>(); responses.push(s); return s; }),
    });
    responses[0].next({ data: [] }); responses[0].complete(); // semaine courante

    cmp.nextWeek(); // S+1
    cmp.nextWeek(); // S+2
    responses[2].next({ data: [{ date: 'S+2', events: [ev('S+2', 'Semaine +2')] }] });
    responses[2].complete();
    responses[1].next({ data: [{ date: 'S+1', events: [ev('S+1', 'Semaine +1')] }] });
    responses[1].complete();

    expect(cmp.dayGroups().map((g: { date: string }) => g.date)).toEqual(['S+2']);
  });
});
