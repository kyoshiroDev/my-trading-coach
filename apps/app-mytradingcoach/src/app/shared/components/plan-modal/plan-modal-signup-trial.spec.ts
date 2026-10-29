import { describe, it, expect, vi, beforeAll } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import * as angularCore from '@angular/core';
import { PlanModalComponent } from './plan-modal.component';
import { BillingApi } from '@app/core/api/billing.api';
import { BillingService } from '@app/core/services/billing.service';
import { OffersStore } from '@app/core/stores/offers.store';
import { UserStore } from '@app/core/stores/user.store';
import TEMPLATE from './plan-modal.component.html?raw';

// Fenêtre des offres pendant l'essai d'inscription (#769) : aucune promesse d'essai de 30 jours
// (`trialUsed`), et la date de fin du Premium offert avec le paiement dès la souscription.

const resolveComponentResources = (angularCore as Record<string, unknown>)['ɵresolveComponentResources'] as (
  resolver: (url: string) => Promise<{ text(): Promise<string> }>,
) => Promise<void>;

beforeAll(async () => {
  await resolveComponentResources(() => Promise.resolve({ text: () => Promise.resolve('') } as unknown as Response));
});

async function setup(user: { daysLeft: number | null; trialEndsAt: string | null; offered?: boolean }, firstChargeAt: string | null = null) {
  TestBed.configureTestingModule({
    imports: [PlanModalComponent],
    providers: [
      { provide: BillingApi, useValue: { offers: vi.fn(), validatePartnerCode: vi.fn() } },
      { provide: BillingService, useValue: { startCheckout: vi.fn() } },
      {
        provide: OffersStore,
        useValue: {
          offers: signal(firstChargeAt ? { founder: { firstChargeAt } } : null), status: signal('loaded'), founderAvailable: computed(() => false),
          isFounder: computed(() => false), partner: computed(() => null), load: vi.fn(), refresh: vi.fn(),
        },
      },
      {
        provide: UserStore,
        useValue: {
          trialAvailable: signal(false),
          signupTrialDaysLeft: signal(user.daysLeft),
          isOfferedPremium: signal(user.offered ?? false),
          user: signal({ id: 'u1', trialEndsAt: user.trialEndsAt }),
        },
      },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  TestBed.overrideComponent(PlanModalComponent, { set: { template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string } });
  await TestBed.compileComponents();
  const fixture = TestBed.createComponent(PlanModalComponent);
  const inputs = fixture.componentInstance as unknown as Record<string, unknown>;
  inputs['preset'] = signal(null);
  inputs['cta'] = signal('modale');
  fixture.detectChanges();
  return fixture.componentInstance as unknown as {
    offeredPremiumEnd: () => string | null;
    trialFor: (c: string) => boolean;
    founderChargeDate: () => string | null;
  };
}

describe('Fenêtre des offres pendant l’essai d’inscription (#769)', () => {
  it('date de fin (JJ/MM) pendant l’essai, aucun essai Stripe promis', async () => {
    const c = await setup({ daysLeft: 5, trialEndsAt: '2026-11-16T10:00:00.000Z' });
    expect(c.offeredPremiumEnd()).toBe('16/11');
    expect(c.trialFor('premium')).toBe(false);
  });

  it('réservation fondateur : date du premier prélèvement donnée par l’API (#769, B1)', async () => {
    expect((await setup({ daysLeft: 9, trialEndsAt: '2026-11-16T10:00:00.000Z' }, '2026-11-16T10:00:00.000Z')).founderChargeDate()).toBe('16/11');
  });

  it('dates en heure de Paris, quel que soit le fuseau du navigateur (23 h 30 UTC = lendemain à Paris)', async () => {
    const c = await setup({ daysLeft: 9, trialEndsAt: '2026-11-15T23:30:00.000Z' }, '2026-11-15T23:30:00.000Z');
    expect(c.offeredPremiumEnd()).toBe('16/11');
    expect(c.founderChargeDate()).toBe('16/11');
  });

  it('pas de date de l’API (moins de 48 h, hors essai) : paiement immédiat', async () => {
    expect((await setup({ daysLeft: 1, trialEndsAt: '2026-11-16T10:00:00.000Z' })).founderChargeDate()).toBeNull();
  });

  it('Premium offert par l’admin : même ligne (paiement immédiat, jours offerts non reportés)', async () => {
    const c = await setup({ daysLeft: null, trialEndsAt: '2026-11-16T10:00:00.000Z', offered: true });
    expect(c.offeredPremiumEnd()).toBe('16/11');
    expect(c.founderChargeDate()).toBeNull(); // l'API ne donne pas de date : prélèvement immédiat
  });

  it('sans Premium offert : pas de ligne', async () => {
    const c = await setup({ daysLeft: null, trialEndsAt: '2026-11-16T10:00:00.000Z' });
    expect(c.offeredPremiumEnd()).toBeNull();
  });

  it('la ligne du gabarit dit la vérité : paiement dès la souscription, jours offerts non reportés', () => {
    const note = TEMPLATE.slice(TEMPLATE.indexOf('plan-trial-note'), TEMPLATE.indexOf('</p>', TEMPLATE.indexOf('plan-trial-note')));
    expect(TEMPLATE).toContain("@if (offeredPremiumEnd() && !(choice() === 'founder' && founderChargeDate()))");
    expect(note.replace(/\s+/g, ' ')).toContain(
      'Si tu t\'abonnes maintenant, tu paies dès aujourd\'hui et les jours offerts restants ne sont pas reportés.',
    );
  });
});

describe('Carte fondateur pendant le Premium offert (#769, B1)', () => {
  it('réservation : texte de la carte, ligne d’en-tête, bouton et ligne d’essai masquée', () => {
    const flat = TEMPLATE.replace(/\s+/g, ' ');
    expect(flat).toContain("Réserve ta place maintenant, tu ne paies qu'à la fin de ton essai (le {{ d }})");
    expect(flat).toContain('Aucun prélèvement avant le {{ d }} · satisfait ou remboursé {{ PRICING.founder.refundDays }} jours ensuite');
    expect(flat).toContain("{{ founderChargeDate() ? 'Réserver ma place →' : 'Devenir fondateur →' }}");
    // Ligne sous le bouton : jamais « facturé aujourd'hui » quand le prélèvement est reporté (vu en local le 28/10).
    const hint = flat.slice(flat.indexOf('plan-modal-hint'));
    const deferred = hint.indexOf("@if (choice() === 'founder' && founderChargeDate(); as d) {");
    expect(deferred).toBeGreaterThan(-1);
    expect(hint.slice(deferred, hint.indexOf('} @else if', deferred))).toContain('à partir du {{ d }}');
    expect(hint.slice(deferred, hint.indexOf('} @else if', deferred))).not.toContain('facturé aujourd');
  });
});

