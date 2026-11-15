import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { OffersStore } from '../stores/offers.store';
import { UserStore } from '../stores/user.store';
import { PaywallCtaService } from './paywall-cta.service';

/** E3 + Q1 (#1013) : un seul libellé de paywall, fondateur proposé partout, essai « 30 jours d'essai ». */
describe('PaywallCtaService', () => {
  const founder = signal(false);
  const trial = signal(false);
  const premium = signal(false);
  let load: ReturnType<typeof vi.fn>;

  function make() {
    load = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: OffersStore, useValue: { founderAvailable: computed(() => founder()), load } },
        {
          provide: UserStore,
          useValue: { user: signal({ id: 'u1', isDemo: false }), isPremium: premium, trialAvailable: computed(() => trial()) },
        },
      ],
    });
    const s = TestBed.inject(PaywallCtaService);
    TestBed.tick();
    return s;
  }

  beforeEach(() => { founder.set(false); trial.set(false); premium.set(false); });

  it('fondateur accessible → prix fondateur', () => {
    founder.set(true);
    expect(make().label()).toBe('Passer Premium · dès 29 €/mois (offre fondateur) →');
  });

  it('essai Stripe disponible → « 30 jours d’essai », jamais « 1 mois offert »', () => {
    trial.set(true);
    expect(make().label()).toBe("Essayer Premium · 30 jours d'essai →");
  });

  it('sinon → « Passer à Premium »', () => {
    expect(make().label()).toBe('Passer à Premium →');
  });

  it('compte gratuit : offres chargées (silencieux) ; compte Premium : rien', () => {
    make();
    expect(load).toHaveBeenCalledWith({ silent: true });
    premium.set(true);
    make();
    expect(load).not.toHaveBeenCalled();
  });
});
