import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, Type, signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { EcoSocketService } from '@app/core/services/eco-socket.service';
import { EcoCalendarApi } from '@app/core/api/eco-calendar.api';
import type { EcoEvent } from '@mtc/shared';
import type { SessionTrade } from '@app/core/api/session.api';
import { MoneyService } from '@app/core/services/money.service';
import { LiveBarComponent } from './live-bar/live-bar.component';
import { LiveNextEventComponent } from './live-next-event/live-next-event.component';
import { LiveClosedTradesComponent } from './live-closed-trades/live-closed-trades.component';
import BAR_TEMPLATE from './live-bar/live-bar.component.html?raw';
import CLOSED_TEMPLATE from './live-closed-trades/live-closed-trades.component.html?raw';
import NEXT_TEMPLATE from './live-next-event/live-next-event.component.html?raw';
import { MoneyPipe } from '@app/shared/pipes/money.pipe';

/** Bandeau, prochaine annonce et trades clôturés de la session live v3 (#593). */

const fmt = (v: number, o?: { sign?: boolean }) => `${o?.sign && v > 0 ? '+' : ''}${v} $`;
const money = { formatFor: (_: unknown, v: number, o?: { sign?: boolean }) => fmt(v, o), format: fmt };

const releases$ = new Subject<EcoEvent[]>();
const ecoApi = {
  refreshAnalysis: vi.fn(() => of({ data: { events: [] } })),
  analyzeResult: vi.fn(() => of({ data: {
    interpretation: 'Inflation au-dessus du consensus. Pression sur le Nasdaq.',
    assetSentiments: [{ asset: 'NQ', sentiment: 'bear', shortReason: 'taux plus hauts' }],
  } })),
};

function render<T>(cmp: Type<T>, inputs: Record<string, unknown>, template?: string, imports: unknown[] = []) {
  TestBed.configureTestingModule({
    providers: [
      { provide: MoneyService, useValue: money },
      { provide: EcoSocketService, useValue: { newReleases$: releases$ } },
      { provide: EcoCalendarApi, useValue: ecoApi },
    ],
  });
  TestBed.overrideComponent(cmp, {
    set: {
      ...(template ? { template } : {}),
      imports: imports as never[], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA],
    },
  });
  const fixture = TestBed.createComponent(cmp);
  // Entrées signal non alimentées en JIT (cf. angular.md) : remplacées avant le premier rendu.
  const c = fixture.componentInstance as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(inputs)) c[k] = signal(v);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, el, text };
}

describe('Session live v3 — bandeau', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('chrono, Trades N / max et P&L total du jour', () => {
    const { text } = render(LiveBarComponent, {
      clock: { kind: 'timer', label: '01:12:38' }, totalPnl: 730, realizedPnl: 810, tradesCount: 4, tradesMax: 5,
    }, BAR_TEMPLATE);
    expect(text('live-bar-clock')).toBe('01:12:38');
    expect(text('live-bar-trades')).toBe('Trades 4 / 5');
    expect(text('live-bar-pnl')).toBe('+730 $');
  });

  it('sans limite de trades dans le profil : « Trades N »', () => {
    const { text } = render(LiveBarComponent, { clock: null, tradesCount: 2, tradesMax: null }, BAR_TEMPLATE);
    expect(text('live-bar-trades')).toBe('Trades 2');
  });

  it('latent inconnu : P&L réalisé seul, jamais un total inventé', () => {
    const { text } = render(LiveBarComponent, { clock: null, totalPnl: null, realizedPnl: -40 }, BAR_TEMPLATE);
    expect(text('live-bar-pnl')).toBe('-40 $');
  });

  it('contexte marché défilant sous le chrono : toucher = détail', () => {
    const tape = [
      { label: 'NQ', value: '18 584', change: '+0,62 %', dir: 'up' },
      { label: '10Y', value: '4,31 %', change: null, dir: 'flat' },
    ];
    const { el, fixture } = render(LiveBarComponent, { clock: null, tickerTape: tape }, BAR_TEMPLATE);
    const btn = el.querySelector('[data-testid="live-bar-tape"]') as HTMLButtonElement;
    // Deux copies pour la boucle sans saut ; la seconde est masquée aux lecteurs d'écran.
    expect(btn.querySelectorAll('.lb-tape-item').length).toBe(4);
    expect(btn.querySelector('.lb-tape-set[aria-hidden="true"]')).not.toBeNull();
    expect(btn.textContent).toContain('NQ 18 584');
    const spy = vi.fn();
    fixture.componentInstance.openContext.subscribe(spy);
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('pas de contexte marché chargé : pas de bandeau défilant', () => {
    const { el } = render(LiveBarComponent, { clock: null, tickerTape: [] }, BAR_TEMPLATE);
    expect(el.querySelector('[data-testid="live-bar-tape"]')).toBeNull();
  });

  it('chrono > 24 h : alerte et clôture à la place du compteur (#595)', () => {
    const { el, text, fixture } = render(LiveBarComponent, { clock: { kind: 'stale', since: '06/10' } }, BAR_TEMPLATE);
    expect(el.querySelector('[data-testid="live-bar-clock"]')).toBeNull();
    expect(text('live-bar-stale')).toContain('Session ouverte depuis le 06/10, clôture-la');
    const spy = vi.fn();
    fixture.componentInstance.closeSession.subscribe(spy);
    (el.querySelector('.lb-stale-close') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});

describe('Session live v3 — prochaine annonce', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    // Mardi 10:00 (marché ouvert) : le rendu ne dépend pas du jour où tournent les tests.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 13, 10, 0));
  });
  afterEach(() => vi.useRealTimers());
  const ev = (time: string, isReleased = false): EcoEvent => ({
    time, name: 'ISM Services PMI', impact: 'high', country: 'US', currency: 'USD',
    actual: null, estimate: null, previous: null, isReleased,
  });

  it('aucune annonce restante aujourd’hui : la ligne disparaît', () => {
    const { el } = render(LiveNextEventComponent, { events: [ev('00:00', true)] }, NEXT_TEMPLATE);
    expect(el.querySelector('[data-testid="live-next-event"]')).toBeNull();
  });

  it('week-end : « Marché fermé » et l’heure de réouverture, pas d’annonce', () => {
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z')); // dimanche
    const { el, text } = render(LiveNextEventComponent, { events: [ev('23:59')] }, NEXT_TEMPLATE);
    expect(el.querySelector('[data-testid="live-next-event"]')).toBeNull();
    expect(text('live-market-closed')).toMatch(/^MARCHÉ FERMÉ ?Réouverture des futures (dimanche|lundi) \d{2}:\d{2}$/);
  });

  it('couleur de la ligne : rouge si impact fort, ambre (défaut) si impact moyen', () => {
    const { el } = render(LiveNextEventComponent, { events: [ev('23:59')] }, NEXT_TEMPLATE);
    expect(el.querySelector('[data-testid="live-next-event"]')!.classList.contains('ne-high')).toBe(true);
    TestBed.resetTestingModule();
    const medium = render(LiveNextEventComponent, { events: [{ ...ev('23:59'), impact: 'medium' }] }, NEXT_TEMPLATE).el;
    expect(medium.querySelector('[data-testid="live-next-event"]')!.classList.contains('ne-high')).toBe(false);
  });

  it('plusieurs annonces à la même heure : une ligne, impact fort en tête, « +N » déplie les autres', () => {
    const { el, text, fixture } = render(LiveNextEventComponent, {
      events: [{ ...ev('23:59'), name: 'Jobless Claims', impact: 'medium' }, { ...ev('23:59'), name: 'Retail Sales MoM' }, { ...ev('23:59'), name: 'Philly Fed', impact: 'medium' }],
    }, NEXT_TEMPLATE);
    expect(el.querySelectorAll('[data-testid="live-next-event"]').length).toBe(1);
    expect(text('live-next-event')).toContain('3 ANNONCES');
    expect(text('live-next-event-more')).toBe('+2');
    expect(el.querySelector('[data-testid="live-next-event-others"]')).toBeNull();
    (el.querySelector('[data-testid="live-next-event-more"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="live-next-event-others"] li').length).toBe(2);
  });

  it('créneau à venir avec deux annonces fortes : toutes deux nommées, « +N » pour les moyennes seulement', () => {
    const { text } = render(LiveNextEventComponent, {
      events: [{ ...ev('23:59'), name: 'NFP' }, { ...ev('23:59'), name: 'Unemployment Rate' }, { ...ev('23:59'), name: 'Jobless Claims', impact: 'medium' }],
    }, NEXT_TEMPLATE);
    expect(text('live-next-event')).toContain('2 ANNONCES FORTES');
    expect(text('live-next-event')).toContain('NFP');
    expect(text('live-next-event-more')).toBe('+1');
  });

    it('annonce à venir : nom, heure, impact et compte à rebours', () => {
    const { text } = render(LiveNextEventComponent, { events: [ev('23:59')] }, NEXT_TEMPLATE);
    expect(text('live-next-event')).toContain('23:59');
    expect(text('live-next-event')).toContain('impact fort');
    expect(text('live-next-event-countdown')).toMatch(/^(dans \d+ (min|h \d{2})|maintenant)$/);
  });
});

describe('Session live v3 — annonce publiée (WebSocket éco)', () => {
  beforeEach(() => { TestBed.resetTestingModule(); vi.clearAllMocks(); });
  const released: EcoEvent = {
    time: '14:30', name: 'CPI', impact: 'high', country: 'US', currency: 'USD',
    actual: 3.4, estimate: 3.1, previous: 3.2, isReleased: true, unit: '%',
  };

  it('la ligne passe à « publiée » : chiffre vs prévision, puis 1re phrase de l’analyse IA, le reste dépliable', () => {
    const { el, text, fixture } = render(LiveNextEventComponent, { events: [] }, NEXT_TEMPLATE);
    releases$.next([released]);
    fixture.detectChanges();
    expect(text('live-release-values')).toBe('Publié 3,4% · prévu 3,1% · précédent 3,2%');
    expect(text('live-release-analysis')).toBe('Inflation au-dessus du consensus.');
    expect(el.querySelector('[data-testid="live-release-more"]')).toBeNull();
    (el.querySelector('.ne-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(text('live-release-more')).toContain('Pression sur le Nasdaq.');
    expect(text('live-release-more')).toContain('NQ baissier');
  });

  it('mêmes appels qu’avant, aucun de plus : relecture du calendrier + une analyse par annonce', () => {
    const { fixture } = render(LiveNextEventComponent, { events: [] }, NEXT_TEMPLATE);
    const spy = vi.fn();
    fixture.componentInstance.ecoCalendarRefreshed.subscribe(spy);
    releases$.next([released]);
    expect(ecoApi.refreshAnalysis).toHaveBeenCalledTimes(1);
    expect(ecoApi.analyzeResult).toHaveBeenCalledTimes(1);
    expect(ecoApi.analyzeResult).toHaveBeenCalledWith('CPI');
    expect(spy).toHaveBeenCalled();
  });

  it('plusieurs annonces publiées au même créneau : une ligne, les autres dans le dépliage, un seul « J’ai lu »', () => {
    const { el, text, fixture } = render(LiveNextEventComponent, { events: [] }, NEXT_TEMPLATE);
    releases$.next([{ ...released, name: 'Jobless Claims', impact: 'medium', actual: 220, estimate: 215, unit: 'K' }, released]);
    fixture.detectChanges();
    expect(text('live-release')).toContain('2 PUBLIÉES');
    expect(el.querySelector('[data-testid="live-release"]')!.classList.contains('ne-high')).toBe(true);
    expect(text('live-release-values')).toContain('3,4%'); // le CPI (impact fort) en tête
    (el.querySelector('.ne-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(text('live-release-others')).toContain('Jobless Claims publié 220K · prévu 215K');
    (el.querySelector('[data-testid="live-release-dismiss"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="live-release"]')).toBeNull();
  });

  it('deux annonces fortes publiées ensemble : un onglet chacune, la plus surprenante ouverte, l’autre marquée non lue', () => {
    ecoApi.analyzeResult.mockImplementation(((name: string) => of({ data: {
      interpretation: name === 'NFP' ? 'Emploi bien au-dessus des attentes. Fed patiente.' : 'Chômage stable. Peu d’effet.',
      assetSentiments: [],
    } })) as never);
    const { el, text, fixture } = render(LiveNextEventComponent, { events: [] }, NEXT_TEMPLATE);
    releases$.next([
      { ...released, name: 'Unemployment Rate', actual: 4.1, estimate: 4.2, unit: '%' },
      { ...released, name: 'NFP', actual: 254, estimate: 150, unit: 'K' },
      { ...released, name: 'Jobless Claims', impact: 'medium', actual: 220, estimate: 215, unit: 'K' },
    ]);
    fixture.detectChanges();
    const tabs = [...el.querySelectorAll('[data-testid="live-release-tab"]')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(text('live-release-values')).toContain('254K'); // NFP : la plus grosse surprise
    expect(text('live-release-analysis')).toBe('Emploi bien au-dessus des attentes.');
    expect(tabs[1].querySelector('.ne-tab-dot'), 'chômage pas encore lu').not.toBeNull();
    tabs[1].click();
    fixture.detectChanges();
    expect(text('live-release-values')).toContain('4,1%');
    expect(text('live-release-analysis')).toBe('Chômage stable.');
    expect(el.querySelector('.ne-tab-dot')).toBeNull();
    // L'annonce à impact moyen reste dans le dépliage, sans onglet
    (el.querySelector('.ne-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(text('live-release-others')).toContain('publié 220K');
    expect(ecoApi.analyzeResult).toHaveBeenCalledTimes(3); // une analyse par annonce, aucune de plus
  });

  it('« J’ai lu » : retour à l’annonce suivante', () => {
    const { el, fixture } = render(LiveNextEventComponent, { events: [] }, NEXT_TEMPLATE);
    releases$.next([released]);
    fixture.detectChanges();
    (el.querySelector('[data-testid="live-release-dismiss"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="live-release"]')).toBeNull();
  });

  it('analyse en échec : le dit, sans chiffre inventé', () => {
    ecoApi.analyzeResult.mockReturnValueOnce(throwError(() => new Error('529')) as never);
    const { el, fixture } = render(LiveNextEventComponent, { events: [] }, NEXT_TEMPLATE);
    releases$.next([released]);
    fixture.detectChanges();
    expect(el.textContent).toContain('Analyse indisponible pour le moment.');
  });
});

describe('Session live v3 — trades clôturés', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const t = (o: Partial<SessionTrade>): SessionTrade => ({
    id: Math.random().toString(), asset: 'NQ', side: 'LONG', entry: 18420, exit: 18436, stopLoss: 18400, takeProfit: 18436,
    quantity: 1, pnl: 320, commission: 0, emotion: 'FOCUSED', tags: [], tradedAt: '2026-10-17T09:42:00Z', sessionId: 's', ...o,
  });

  it('titre N · G gagnants, sortie TP/SL/Manuel ; les trades ouverts n’y sont pas', () => {
    const { el, text } = render(LiveClosedTradesComponent, {
      trades: [t({}), t({ side: 'SHORT', asset: 'ES', entry: 5905, exit: 5908, stopLoss: 5908, takeProfit: 5890, pnl: -150 }), t({ pnl: null, exit: null })],
    }, CLOSED_TEMPLATE, [MoneyPipe]);
    expect(text('live-closed-title')).toBe('TRADES CLÔTURÉS · 2 · 1 GAGNANT'); // « TRADES » masqué en mobile (CSS)
    const rows = el.querySelectorAll('[data-testid="live-closed-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('TP');
    expect(rows[1].textContent).toContain('SL');
  });

  it('aucun trade clôturé : une ligne grise', () => {
    const { text } = render(LiveClosedTradesComponent, { trades: [] }, CLOSED_TEMPLATE, [MoneyPipe]);
    expect(text('live-closed-empty')).toBe('Aucun trade clôturé pour l\'instant');
  });

  it('Trade rapide déjà affiché : pas de lien « Saisir un trade à la main »', () => {
    const { el } = render(LiveClosedTradesComponent, { trades: [], canEnterManually: false }, CLOSED_TEMPLATE, [MoneyPipe]);
    expect(el.textContent).not.toContain('Saisir un trade à la main');
  });

  it('« Saisir un trade à la main » prévient le parent', () => {
    const { el, fixture } = render(LiveClosedTradesComponent, { trades: [], canEnterManually: true }, CLOSED_TEMPLATE, [MoneyPipe]);
    const spy = vi.fn();
    fixture.componentInstance.manualEntry.subscribe(spy);
    (el.querySelector('[data-testid="live-manual-entry"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
