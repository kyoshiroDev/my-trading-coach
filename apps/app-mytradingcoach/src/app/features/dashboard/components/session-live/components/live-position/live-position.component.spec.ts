import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { of } from 'rxjs';
import type { LiveBrokerState } from '@mtc/shared';
import { LivePositionComponent } from './live-position.component';
import { TradovateApi } from '@app/core/api/tradovate.api';
import { SessionStore } from '@app/core/stores/session.store';
import { MoneyService } from '@app/core/services/money.service';
import TEMPLATE from './live-position.component.html?raw';

/** « Trade en cours » de la session live, sur son VRAI template. */

const broker = (o: Partial<LiveBrokerState> = {}): LiveBrokerState => ({
  openPositions: [{ asset: 'MNQ', side: 'LONG', quantity: 2, entryPrice: 21500.25, since: null }],
  positionsAt: new Date().toISOString(),
  openPnl: -42.5,
  openPnlAt: new Date(Date.now() - 40_000).toISOString(),
  ...o,
});

function setup(b: LiveBrokerState, realized = 303.4) {
  const api = { refreshBalance: vi.fn(() => of({ data: {} })) };
  const session = { refreshLive: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: TradovateApi, useValue: api },
      { provide: SessionStore, useValue: session },
      { provide: MoneyService, useValue: { formatFor: (_: unknown, v: number) => `${v.toFixed(2)} $` } },
    ],
  });
  TestBed.overrideComponent(LivePositionComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(LivePositionComponent);
  // Entrées signal non alimentées en JIT (cf. angular.md) : remplacées avant le premier rendu.
  const c = fixture.componentInstance as unknown as Record<string, unknown>;
  c['broker'] = signal(b);
  c['realized'] = signal(realized);
  c['accountId'] = signal('acc-tv');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const text = (id: string) => (el.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { fixture, el, text, api, session };
}

describe('Session live — trade en cours (bêta)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('position ouverte : sens, quantité, actif, prix d’entrée ; total = réalisé + latent', () => {
    const { text, el } = setup(broker());
    expect(text('live-position-row')).toContain('▲ LONG');
    expect(text('live-position-row')).toContain('2 × MNQ');
    expect(text('live-position-row')).toContain('@ 21500.25');
    expect(text('live-latent')).toBe('-42.50 $');
    expect(text('live-total')).toBe('260.90 $');
    expect(el.textContent).toContain('il y a 40 s');
  });

  it('latent inconnu : message honnête, aucun total inventé', () => {
    const { text, el } = setup(broker({ openPnl: null, openPnlAt: null }));
    expect(el.querySelector('[data-testid="live-latent-na"]')).not.toBeNull();
    expect(el.textContent).toContain('Latent indisponible pour ce compte');
    expect(text('live-total')).toBe('');
  });

  it('« Actualiser » relit le broker puis les stats de la session', () => {
    const { el, api, session } = setup(broker());
    (el.querySelector('.lp-refresh') as HTMLButtonElement).click();
    expect(api.refreshBalance).toHaveBeenCalledWith('acc-tv');
    expect(session.refreshLive).toHaveBeenCalled();
  });
});
