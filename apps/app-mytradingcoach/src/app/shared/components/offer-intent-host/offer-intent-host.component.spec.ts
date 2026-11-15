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

function setup(opts: { user: User; premium: boolean; founderAvailable: boolean | null; intent?: OfferIntent }) {
  const pending = signal<OfferIntent | null>(opts.intent ?? { plan: 'founder', promo: null, cta: 'email' });
  const intent = {
    pending,
    requested: signal<{ cta: string } | null>(null),
    clear: vi.fn(() => pending.set(null)),
    keepPromoOnly: vi.fn(() => {
      const p = pending();
      pending.set(p?.promo ? { ...p, plan: null } : null);
    }),
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
    expect(intent.pending()).toBeNull(); // sans code partenaire, l'intention est effacée
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

/**
 * B3 (#1013, décision du 14/11) : tout nouvel inscrit a 14 jours de Premium offert. Offre fondateur
 * fermée ou complète, le lien d'offre était effacé en entier, code partenaire compris : plus aucun
 * code partenaire ne marchait après les 200 places. Seul `plan=founder` est oublié.
 */
describe('OfferIntentHostComponent : code partenaire gardé quand le fondateur est fermé (B3)', () => {
  it('lien fondateur + code, fondateur fermé, en essai → modale ouverte avec le code, plan fondateur oublié', () => {
    const { show, intent } = setup({
      user: {}, premium: true, founderAvailable: false, intent: { plan: 'founder', promo: 'TRADER10', cta: 'email' },
    });
    expect(intent.clear).not.toHaveBeenCalled();
    expect(intent.keepPromoOnly).toHaveBeenCalled();
    expect(intent.pending()).toEqual({ plan: null, promo: 'TRADER10', cta: 'email' });
    expect(show()).toBe(true);
  });

  it('lien avec un code seul, fondateur fermé, en essai → modale ouverte', () => {
    const { show, intent } = setup({
      user: {}, premium: true, founderAvailable: false, intent: { plan: null, promo: 'TRADER10', cta: null },
    });
    expect(intent.clear).not.toHaveBeenCalled();
    expect(show()).toBe(true);
  });
});

/** B4 (#1013) : en pause, le cadenas était un bouton mort (modale jamais ouverte). */
describe('OfferIntentHostComponent : abonnement en pause (B4)', () => {
  it.each(['past_due', 'unpaid'])('%s : la modale s’ouvre (elle propose « Confirmer mon paiement »)', (status) => {
    const { show } = setup({
      user: { stripeSubscriptionStatus: status }, premium: false, founderAvailable: false,
      intent: { plan: null, promo: null, cta: null },
    });
    expect(show()).toBe(true);
  });
});
