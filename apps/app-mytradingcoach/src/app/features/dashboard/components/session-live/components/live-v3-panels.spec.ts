import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import type { EcoEvent } from '@mtc/shared';
import type { SessionTrade } from '@app/core/api/session.api';
import { MoneyService } from '@app/core/services/money.service';
import { LiveBarComponent } from './live-bar/live-bar.component';
import { LiveNextEventComponent } from './live-next-event/live-next-event.component';
import { LiveClosedTradesComponent } from './live-closed-trades/live-closed-trades.component';
import BAR_TEMPLATE from './live-bar/live-bar.component.html?raw';
import CLOSED_TEMPLATE from './live-closed-trades/live-closed-trades.component.html?raw';
import { MoneyPipe } from '@app/shared/pipes/money.pipe';

/** Bandeau, prochaine annonce et trades clôturés de la session live v3 (#593). */

const fmt = (v: number, o?: { sign?: boolean }) => `${o?.sign && v > 0 ? '+' : ''}${v} $`;
const money = { formatFor: (_: unknown, v: number, o?: { sign?: boolean }) => fmt(v, o), format: fmt };

function render<T>(cmp: new (...a: never[]) => T, inputs: Record<string, unknown>, template?: string, imports: unknown[] = []) {
  TestBed.configureTestingModule({ providers: [{ provide: MoneyService, useValue: money }] });
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
  beforeEach(() => TestBed.resetTestingModule());
  const ev = (time: string, isReleased = false): EcoEvent => ({
    time, name: 'ISM Services PMI', impact: 'high', country: 'US', currency: 'USD',
    actual: null, estimate: null, previous: null, isReleased,
  });

  it('aucune annonce restante aujourd’hui : la ligne disparaît', () => {
    const { el } = render(LiveNextEventComponent, { events: [ev('00:00', true)] });
    expect(el.querySelector('[data-testid="live-next-event"]')).toBeNull();
  });

  it('annonce à venir : nom, heure, impact et compte à rebours', () => {
    const { text } = render(LiveNextEventComponent, { events: [ev('23:59')] });
    expect(text('live-next-event')).toContain('23:59');
    expect(text('live-next-event')).toContain('impact fort');
    expect(text('live-next-event-countdown')).toMatch(/^(dans \d+ (min|h \d{2})|maintenant)$/);
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
    expect(text('live-closed-title')).toBe('CLÔTURÉS · 2 · 1 GAGNANT');
    const rows = el.querySelectorAll('[data-testid="live-closed-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('TP');
    expect(rows[1].textContent).toContain('SL');
  });

  it('aucun trade clôturé : une ligne grise', () => {
    const { text } = render(LiveClosedTradesComponent, { trades: [] }, CLOSED_TEMPLATE, [MoneyPipe]);
    expect(text('live-closed-empty')).toBe('Aucun trade clôturé pour l\'instant');
  });

  it('« Saisir un trade à la main » prévient le parent', () => {
    const { el, fixture } = render(LiveClosedTradesComponent, { trades: [] }, CLOSED_TEMPLATE, [MoneyPipe]);
    const spy = vi.fn();
    fixture.componentInstance.manualEntry.subscribe(spy);
    (el.querySelector('[data-testid="live-manual-entry"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
  });
});
