import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { OfferIntentHostComponent } from './offer-intent-host.component';
import { OfferIntentService, type OfferIntent } from '@app/core/services/offer-intent.service';
import { UserStore } from '@app/core/stores/user.store';
import { OffersStore } from '@app/core/stores/offers.store';

// Modale ouverte par un lien d'offre (#525, campagne fondateur) : un compte déjà Premium ne la
// voit que si le fondateur lui est accessible, sinon elle ne lui proposerait que Premium à 49 €.

type User = { isDemo?: boolean; stripeSubscriptionStatus?: string | null };

function setup(opts: { user: User; premium: boolean; founderAvailable: boolean | null }) {
  const pending = signal<OfferIntent | null>({ plan: 'founder', promo: null, cta: 'email' });
  const intent = {
    pending,
    requested: signal<{ cta: string } | null>(null),
    clear: vi.fn(() => pending.set(null)),
  };
  // null = offres pas encore chargées.
  const offersSig = signal<object | null>(opts.founderAvailable === null ? null : {});
  const offers = {
    offers: offersSig,
    founderAvailable: computed(() => !!offersSig() && opts.founderAvailable === true),
    load: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: OfferIntentService, useValue: intent },
      { provide: UserStore, useValue: { user: signal(opts.user), isPremium: signal(opts.premium) } },
      { provide: OffersStore, useValue: offers },
    ],
  });
  TestBed.overrideComponent(OfferIntentHostComponent, { set: { template: '', imports: [] } });
  const fixture = TestBed.createComponent(OfferIntentHostComponent);
  fixture.detectChanges();
  TestBed.tick();
  const show = (fixture.componentInstance as unknown as { show: () => boolean }).show;
  return { show, intent, offers };
}

describe('OfferIntentHostComponent : lien vers l’offre fondateur', () => {
  it('compte gratuit → modale ouverte', () => {
    const { show } = setup({ user: {}, premium: false, founderAvailable: false });
    expect(show()).toBe(true);
  });

  it('déjà Premium, fondateur accessible (essai, Premium offert) → modale ouverte', () => {
    const { show, offers } = setup({ user: {}, premium: true, founderAvailable: true });
    expect(offers.load).toHaveBeenCalled();
    expect(show()).toBe(true);
  });

  it('déjà Premium, fondateur inaccessible (admin, ancien fondateur…) → rien, intention oubliée', () => {
    const { show, intent } = setup({ user: {}, premium: true, founderAvailable: false });
    expect(show()).toBe(false);
    expect(intent.clear).toHaveBeenCalled();
  });

  it('déjà Premium, offres pas encore chargées → rien ne s’ouvre en attendant', () => {
    const { show, intent } = setup({ user: {}, premium: true, founderAvailable: null });
    expect(show()).toBe(false);
    expect(intent.clear).not.toHaveBeenCalled();
  });

  it('abonné qui paie déjà → rien', () => {
    const { show } = setup({ user: { stripeSubscriptionStatus: 'active' }, premium: true, founderAvailable: true });
    expect(show()).toBe(false);
  });
});
