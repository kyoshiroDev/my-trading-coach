import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of } from 'rxjs';
import type { LiveBrokerState } from '@mtc/shared';
import type { SessionTrade } from '@app/core/api/session.api';
import type { InstrumentDto } from '@app/core/api/trades.api';
import { LivePositionComponent } from './live-position.component';
import { TradovateApi } from '@app/core/api/tradovate.api';
import { SessionStore } from '@app/core/stores/session.store';
import { MoneyService } from '@app/core/services/money.service';
import TEMPLATE from './live-position.component.html?raw';

/** « Trade en cours » de la session live v3, sur son VRAI template. */

const broker = (o: Partial<LiveBrokerState> = {}): LiveBrokerState => ({
  openPositions: [{ asset: 'MNQ', side: 'LONG', quantity: 2, entryPrice: 21500.25, since: null, stopPrice: null, targetPrice: null }],
  positionsAt: new Date().toISOString(),
  openPnl: -42.5,
  openPnlAt: new Date(Date.now() - 40_000).toISOString(),
  ...o,
});

const INSTRUMENTS: InstrumentDto[] = [
  { symbol: 'MNQ', label: 'MNQ', category: 'FUTURES_US', tickValue: 0.5, tickSize: 0.25 },
  { symbol: 'NQ', label: 'NQ', category: 'FUTURES_US', tickValue: 5, tickSize: 0.25 },
  { symbol: 'ES', label: 'ES', category: 'FUTURES_US', tickValue: 12.5, tickSize: 0.25 },
  { symbol: 'MES', label: 'MES', category: 'FUTURES_US', tickValue: 1.25, tickSize: 0.25 },
];

const manual = (o: Partial<SessionTrade> = {}): SessionTrade => ({
  id: 't1', asset: 'MNQ', side: 'LONG', entry: 18540, exit: null, stopLoss: 18500, takeProfit: 18620,
  quantity: 2, pnl: null, emotion: 'FOCUSED', tags: [], tradedAt: new Date(Date.now() - 6 * 60_000).toISOString(), sessionId: 's',
  ...o,
});

function setup(b: LiveBrokerState | null, openTrades: SessionTrade[] = []) {
  const api = { refreshBalance: vi.fn(() => of({ data: {} })) };
  const session = { refreshLive: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: TradovateApi, useValue: api },
      { provide: SessionStore, useValue: session },
      { provide: MoneyService, useValue: { formatFor: (_: unknown, v: number, o?: { sign?: boolean }) => `${o?.sign && v > 0 ? '+' : ''}${v} $` } },
    ],
  });
  TestBed.overrideComponent(LivePositionComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(LivePositionComponent);
  // Entrées signal non alimentées en JIT (cf. angular.md) : remplacées avant le premier rendu.
  const c = fixture.componentInstance as unknown as Record<string, unknown>;
  c['broker'] = signal(b);
  c['openTrades'] = signal(openTrades);
  c['instruments'] = signal(INSTRUMENTS);
  c['accountId'] = signal('acc-tv');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, el, text, api, session };
}

describe('Session live v3 — trade en cours (#598)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('position broker : sens, actif, contrats, entrée, latent et prix au relevé', () => {
    const { text } = setup(broker());
    expect(text('live-position-row')).toContain('LONG');
    expect(text('live-position-row')).toContain('MNQ');
    expect(text('live-position-row')).toContain('2 contrats');
    expect(text('live-latent')).toBe('-42.5 $');
    // 21500,25 − 42,5 / (2 × 2 $/pt) = 21489,625 → arrondi au centième
    expect(text('live-price')).toMatch(/^prix 21\s?489,63 · relevé à \d{2}:\d{2}:\d{2}$/);
  });

  it('position broker sans stop : repli, aucune valeur inventée, mention Tradovate', () => {
    const { el, text } = setup(broker());
    expect(el.querySelector('[data-testid="live-bar"]')?.getAttribute('data-mode')).toBe('fallback');
    expect(text('live-bar-sl')).toBe('');
    expect(text('live-bar-tp')).toBe('');
    expect(el.querySelector('[data-testid="live-bar-rr"]')).toBeNull();
    expect(text('live-no-stop')).toBe('Aucun stop détecté chez Tradovate');
    expect(el.querySelector('[data-testid="close-trade"]'), 'lecture seule Tradovate').toBeNull();
  });

  it('position broker avec bracket lu chez Tradovate (#601) : barre complète, montants et R/R', () => {
    const p = { ...broker().openPositions[0], entryPrice: 21500, stopPrice: 21480, targetPrice: 21540 };
    const { el, text } = setup(broker({ openPositions: [p] }));
    expect(el.querySelector('[data-testid="live-bar"]')?.getAttribute('data-mode')).toBe('full');
    expect(text('live-bar-sl')).toContain('-80 $'); // 20 pts × 2 contrats × 2 $ le point (MNQ)
    expect(text('live-bar-tp')).toContain('+160 $');
    expect(text('live-bar-rr')).toBe('Risque/rendement 1 : 2 · stop à 20 pts');
    expect(el.querySelector('[data-testid="live-no-stop"]')).toBeNull();
  });

  it('plusieurs positions : pas de prix déduit (latent du compte entier)', () => {
    const b = broker({ openPositions: [...broker().openPositions, { asset: 'ES', side: 'SHORT', quantity: 1, entryPrice: 5900, since: null, stopPrice: null, targetPrice: null }] });
    const { el } = setup(b);
    expect(el.querySelector('[data-testid="live-price"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid="live-position-row"]').length).toBe(2);
  });

  it('latent inconnu : message honnête, aucun chiffre inventé', () => {
    const { el } = setup(broker({ openPnl: null, openPnlAt: null }));
    expect(el.querySelector('[data-testid="live-latent-na"]')).not.toBeNull();
    expect(el.textContent).toContain('Latent indisponible pour ce compte');
    expect(el.querySelector('[data-testid="live-bar-dot"]')).toBeNull();
  });

  it.each([
    ['MNQ', '-80 $', '+160 $'],
    ['NQ', '-800 $', '+1600 $'],
    ['ES', '-2000 $', '+4000 $'],
    ['MES', '-200 $', '+400 $'],
  ])('trade saisi %s avec SL et TP : barre complète, montants et R/R', (asset, sl, tp) => {
    const { el, text } = setup(null, [manual({ asset, stopLoss: 18520, takeProfit: 18580 })]);
    expect(el.querySelector('[data-testid="live-bar"]')?.getAttribute('data-mode')).toBe('full');
    expect(text('live-bar-sl')).toContain(sl);
    expect(text('live-bar-tp')).toContain(tp);
    expect(text('live-bar-rr')).toBe('Risque/rendement 1 : 2 · stop à 20 pts');
  });

  it('trade saisi sans SL : repli, seul le TP', () => {
    const { el, text } = setup(null, [manual({ stopLoss: null })]);
    expect(el.querySelector('[data-testid="live-bar"]')?.getAttribute('data-mode')).toBe('target'); // entrée → TP seulement
    expect(text('live-bar-sl')).toBe('');
    expect(text('live-bar-tp')).toContain('TP 18');
    expect(text('live-no-stop')).toBe('Aucun stop saisi pour ce trade');
  });

  it('trade saisi : « Clôturer ce trade » demande le prix de sortie et prévient le parent', () => {
    const { el, fixture } = setup(null, [manual()]);
    const spy = vi.fn();
    fixture.componentInstance.tradeClosed.subscribe(spy);
    (el.querySelector('[data-testid="close-trade"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = el.querySelector('[data-testid="trade-exit-price"]') as HTMLInputElement;
    input.value = '18620';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="trade-close-type"]')?.textContent).toContain('TP détecté');
    (el.querySelector('.lp-close-ok') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith({ tradeId: 't1', exitPrice: 18620 });
  });

  it('aucune position : carte compacte d’une ligne', () => {
    const { el, text } = setup(broker({ openPositions: [], openPnl: 0 }));
    expect(el.querySelector('[data-testid="live-position"]')).toBeNull();
    expect(text('live-position-none')).toBe('Aucune position ouverte');
  });

  it('« Actualiser » relit le broker puis les stats de la session', () => {
    const { el, api, session } = setup(broker());
    (el.querySelector('.lp-refresh') as HTMLButtonElement).click();
    expect(api.refreshBalance).toHaveBeenCalledWith('acc-tv');
    expect(session.refreshLive).toHaveBeenCalled();
  });
});
