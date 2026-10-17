import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { BillingApi, type BillingOffers } from '../api/billing.api';
import { OffersStore } from './offers.store';
import { UserStore } from './user.store';

const OFFERS: BillingOffers = {
  founderOffer: { open: true, seatsLeft: 150, seatsTotal: 200 },
  founder: { isFounder: false, number: null, interval: null, since: null, eligible: true, ineligibleReason: null, refundUntil: null },
  partner: null,
  subscription: { interval: null, status: null },
};

describe('OffersStore — état du chargement (#578)', () => {
  let responses: Subject<{ data: BillingOffers }>[];
  const user = signal<{ id: string; isDemo?: boolean } | null>(null);
  const make = () => TestBed.inject(OffersStore);

  beforeEach(() => {
    responses = [];
    user.set({ id: 'u1' });
    TestBed.configureTestingModule({
      providers: [
        { provide: UserStore, useValue: { user } },
        {
          provide: BillingApi,
          useValue: {
            offers: () => {
              const r = new Subject<{ data: BillingOffers }>();
              responses.push(r);
              return r;
            },
          },
        },
      ],
    });
  });

  it('idle → loading → loaded', () => {
    const store = make();
    expect(store.status()).toBe('idle');
    store.load();
    expect(store.status()).toBe('loading');
    responses[0].next({ data: OFFERS });
    expect(store.status()).toBe('loaded');
    expect(store.founderAvailable()).toBe(true);
  });

  it('échec → error, puis refresh (« Réessayer ») → loading → loaded', () => {
    const store = make();
    store.load();
    responses[0].error(new Error('réseau'));
    expect(store.status()).toBe('error');
    expect(store.offers()).toBeNull();
    store.refresh();
    expect(store.status()).toBe('loading');
    responses[1].next({ data: OFFERS });
    expect(store.status()).toBe('loaded');
  });

  it('rafraîchissement d’offres déjà chargées : elles restent utilisables (pas de retour à loading)', () => {
    const store = make();
    store.load();
    responses[0].next({ data: OFFERS });
    store.refresh();
    expect(store.status()).toBe('loaded');
    responses[1].error(new Error('réseau'));
    expect(store.status()).toBe('loaded');
    expect(store.offers()).toEqual(OFFERS);
  });

  it('pas connecté ou compte démo : rien demandé, reste idle', () => {
    user.set(null);
    const store = make();
    store.load();
    user.set({ id: 'demo', isDemo: true });
    store.load();
    expect(responses).toHaveLength(0);
    expect(store.status()).toBe('idle');
  });

  it('autre compte : les offres du précédent ne servent pas, retour à loading', () => {
    const store = make();
    store.load();
    responses[0].next({ data: OFFERS });
    user.set({ id: 'u2' });
    store.load();
    expect(store.offers()).toBeNull();
    expect(store.status()).toBe('loading');
  });
});
