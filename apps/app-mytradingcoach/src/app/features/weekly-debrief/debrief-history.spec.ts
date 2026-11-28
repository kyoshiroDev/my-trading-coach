/**
 * Débriefs passés (#959) : l'écran n'affichait que le débrief courant ; `GET /debrief/history` n'était
 * appelé par aucun composant. Sélecteur de semaine, chargement par `GET /debrief/:year/:week`, export
 * PDF de la semaine affichée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { DatePipe } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LucideDynamicIcon } from '@lucide/angular';
import { PctPipe } from '@mtc/front-ui';
import type { DebriefHistoryItem, WeeklyDebrief } from '@mtc/shared';
import { DebriefComponent } from './debrief.component';
import { UserStore } from '../../core/stores/user.store';
import { ToastService } from '../../core/services/toast.service';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import TEMPLATE from './debrief.component.html?raw';

const debrief = (weekNumber: number, over: Partial<WeeklyDebrief> = {}): WeeklyDebrief => ({
  id: `d${weekNumber}`, weekNumber, year: 2026,
  startDate: '2026-11-16T00:00:00.000Z', endDate: '2026-11-22T23:59:59.000Z',
  aiSummary: `Résumé S${weekNumber}`, insights: { overview: { summary: `Résumé S${weekNumber}` }, accounts: [] },
  objectives: [], stats: { winRate: 50, totalPnl: 0, totalTrades: weekNumber }, generatedAt: '2026-11-23T00:00:00.000Z',
  ...over,
});
const item = (weekNumber: number): DebriefHistoryItem => ({
  id: `d${weekNumber}`, year: 2026, weekNumber,
  startDate: '2026-11-16T00:00:00.000Z', endDate: '2026-11-22T23:59:59.000Z', totalTrades: weekNumber,
});

describe('Débrief : semaines passées (#959)', () => {
  let http: HttpTestingController;
  const toast = { error: vi.fn(), success: vi.fn() };

  beforeEach(() => {
    // Dates écrites en dur ci-dessus : horloge figée (règle tests n° 1).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'));
    TestBed.resetTestingModule();
    toast.error.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UserStore, useValue: { isPremium: () => true, isDemo: () => false } },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.overrideComponent(DebriefComponent, {
      set: {
        imports: [DatePipe, LucideDynamicIcon, PnlFormatPipe, MoneyPipe, PctPipe],
        template: TEMPLATE, styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
      },
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function open(current: WeeklyDebrief | null, history?: DebriefHistoryItem[] | 'error') {
    const fixture = TestBed.createComponent(DebriefComponent);
    for (const req of http.match((r) => r.url.endsWith('/accounts'))) req.flush({ data: [] });
    http.expectOne((r) => r.url.endsWith('/debrief/current')).flush({ data: current });
    if (history === 'error') {
      http.expectOne((r) => r.url.endsWith('/debrief/history')).flush({}, { status: 500, statusText: 'Server Error' });
    } else if (history) {
      http.expectOne((r) => r.url.endsWith('/debrief/history')).flush({ data: history });
    }
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, select: () => el.querySelector<HTMLSelectElement>('[data-testid="debrief-week-select"]') };
  }

  it('une semaine par option, la semaine affichée sélectionnée', () => {
    const { select } = open(debrief(47), [item(47), item(46), item(45)]);
    const s = select()!;
    expect([...s.options].map((o) => o.value)).toEqual(['2026-47', '2026-46', '2026-45']);
    expect(s.value).toBe('2026-47');
    expect(s.options[1].textContent).toContain('Semaine 46');
    expect(s.options[1].textContent).toContain('46 trades');
  });

  it('choisir une semaine passée charge son débrief et l’affiche', () => {
    const { fixture, el, select } = open(debrief(47), [item(47), item(46)]);
    const s = select()!;
    s.value = '2026-46';
    s.dispatchEvent(new Event('change'));
    http.expectOne((r) => r.url.endsWith('/debrief/2026/46')).flush({ data: debrief(46) });
    fixture.detectChanges();
    expect(el.querySelector('.week-title')?.textContent).toContain('Semaine 46');
    expect(select()!.value).toBe('2026-46');
  });

  it('export PDF : la semaine affichée, pas la semaine en cours', () => {
    const { fixture, el, select } = open(debrief(47), [item(47), item(46)]);
    select()!.value = '2026-46';
    select()!.dispatchEvent(new Event('change'));
    http.expectOne((r) => r.url.endsWith('/debrief/2026/46')).flush({ data: debrief(46) });
    fixture.detectChanges();
    (el.querySelector('.export-btn') as HTMLButtonElement).click();
    const pdf = http.expectOne((r) => r.url.endsWith('/debrief/2026/46/pdf'));
    expect(pdf.request.responseType).toBe('blob');
    pdf.flush(new Blob(), { status: 500, statusText: 'Server Error' }); // pas de téléchargement dans le test
  });

  it('semaine introuvable : message, le débrief affiché reste', () => {
    const { fixture, el, select } = open(debrief(47), [item(47), item(46)]);
    select()!.value = '2026-46';
    select()!.dispatchEvent(new Event('change'));
    http.expectOne((r) => r.url.endsWith('/debrief/2026/46')).flush({}, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('semaine 46'));
    expect(el.querySelector('.week-title')?.textContent).toContain('Semaine 47');
  });

  it('génération pendant le chargement d’une semaine passée : le débrief généré reste affiché', () => {
    const { fixture, el, select } = open(debrief(47), [item(47), item(46)]);
    select()!.value = '2026-46';
    select()!.dispatchEvent(new Event('change'));
    const past = http.expectOne((r) => r.url.endsWith('/debrief/2026/46'));
    (fixture.componentInstance as unknown as { generateDebrief: () => void }).generateDebrief();
    http.expectOne((r) => r.url.endsWith('/debrief/generate')).flush({ data: debrief(48) });
    http.expectOne((r) => r.url.endsWith('/debrief/history')).flush({ data: [item(48), item(47), item(46)] });
    past.flush({ data: debrief(46) });
    fixture.detectChanges();
    expect(el.querySelector('.week-title')?.textContent).toContain('Semaine 48');
  });

  it('une seule semaine : pas de sélecteur', () => {
    expect(open(debrief(47), [item(47)]).select()).toBeNull();
  });

  it('historique en échec : pas de sélecteur, le débrief s’affiche', () => {
    const { el, select } = open(debrief(47), 'error');
    expect(select()).toBeNull();
    expect(el.querySelector('.week-title')?.textContent).toContain('Semaine 47');
  });

  it('aucun débrief : pas d’appel à l’historique', () => {
    open(null);
    http.expectNone((r) => r.url.endsWith('/debrief/history'));
  });
});
