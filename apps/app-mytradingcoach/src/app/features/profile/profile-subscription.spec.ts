/**
 * Bloc Profil > Abonnement : un Premium offert par l'admin (aucun abonnement Stripe) ne doit
 * pas afficher le message d'essai Stripe ni le bouton du portail (qui échouerait, pas de client
 * Stripe) ; il propose de continuer en Premium via la modale de plans.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal, NO_ERRORS_SCHEMA } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { ProfileComponent } from './profile.component';
import { UserStore } from '../../core/stores/user.store';
import { AuthService } from '../../core/auth/auth.service';
import { BillingApi, type BillingOffers } from '../../core/api/billing.api';
import { UsersApi } from '../../core/api/users.api';
import { TradesApi } from '../../core/api/trades.api';
import { SetupsStore } from '../../core/stores/setups.store';
import { AnalyticsApi } from '../../core/api/analytics.api';

// Vrai template (le bloc testé), CSS ignoré.
const TEMPLATE = readFileSync(join(__dirname, 'profile.component.html'), 'utf8');

const IN_20_DAYS = new Date(Date.now() + 20 * 86_400_000).toISOString();

const IN_5_DAYS = new Date(Date.now() + 5 * 86_400_000).toISOString();

/** Offres (#525) : rien par défaut ; `over` complète l'objet renvoyé par GET /billing/offers. */
function offers(over: Partial<BillingOffers> = {}): BillingOffers {
  return {
    founderOffer: { open: false, seatsLeft: 200, seatsTotal: 200 },
    founder: {
      isFounder: false, number: null, interval: null, since: null,
      eligible: false, ineligibleReason: 'closed', refundUntil: null,
    },
    partner: null,
    subscription: { interval: null, status: null },
    ...over,
  };
}

function render(opts: {
  offered: boolean; signup?: boolean; paying?: boolean; offers?: BillingOffers;
  /** Champs du compte à forcer (états #813) ; `premium` = accès Premium vu par le store. */
  user?: Record<string, unknown>; premium?: boolean;
}) {
  const user = {
    email: 'alex@test.com', plan: 'FREE', trialEndsAt: opts.paying ? null : IN_20_DAYS, trialUsed: true,
    stripeSubscriptionStatus: opts.paying ? 'active' : opts.offered || opts.signup ? null : 'trialing',
    notificationsEmail: true, debriefAutomatic: true, marketingConsent: false,
    ...opts.user,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({ tab: 'params' })), snapshot: { queryParamMap: convertToParamMap({ tab: 'params' }) } } },
      {
        provide: UserStore,
        useValue: {
          user: () => user,
          isPremium: () => opts.premium ?? true, isDemo: () => false, isOfferedPremium: () => opts.offered, signupTrialDaysLeft: () => (opts.signup ? 20 : null),
          trialAvailable: () => false,
          displayName: () => 'Alex', startingCapital: () => 0, refreshUser: vi.fn(),
        },
      },
      { provide: AuthService, useValue: { currentUser: signal(user), setCurrentUser: vi.fn() } },
      { provide: BillingApi, useValue: { offers: () => of({ data: opts.offers ?? offers() }) } },
      { provide: UsersApi, useValue: { getAiUsage: vi.fn(() => of({ data: null })) } },
      { provide: TradesApi, useValue: { getUserAssets: vi.fn(() => of({ data: [] })) } },
      { provide: SetupsStore, useValue: { active: signal([]), archived: signal([]), load: vi.fn(), loaded: signal(true) } },
      { provide: AnalyticsApi, useValue: { getBySetup: vi.fn(() => of({ data: [] })) } },
    ],
  });
  TestBed.overrideComponent(ProfileComponent, { set: {
      template: TEMPLATE, imports: [DatePipe, DecimalPipe], schemas: [NO_ERRORS_SCHEMA],
      styleUrls: [], styleUrl: undefined as unknown as string,
    }, });
  const fixture = TestBed.createComponent(ProfileComponent);
  (fixture.componentInstance as unknown as { activeProfileTab: { set(v: string): void } }).activeProfileTab.set('params');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Profil > Abonnement', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Premium offert : jours restants, aucun prélèvement, pas de portail Stripe', () => {
    const text = render({ offered: true }).textContent ?? '';
    expect(text).toContain('Premium offert\u00a0: il te reste 20 jours');
    expect(text).toContain('Aucun prélèvement, tu repasses en gratuit automatiquement.');
    expect(text).toContain('Continuer en Premium →');
    expect(text).not.toContain('Premier prélèvement');
    expect(text).not.toContain('annuler mon essai');
    expect(text).not.toContain('Gérer mon abonnement');
  });

  it('Essai d’inscription (#769, sans carte) : Premium offert, aucun prélèvement, pas de portail Stripe', () => {
    const text = render({ offered: false, signup: true }).textContent ?? '';
    expect(text).toContain('Premium offert\u00a0: il te reste 20 jours');
    expect(text).toContain('Aucun prélèvement, tu repasses en gratuit automatiquement.');
    expect(text).not.toContain('Premier prélèvement');
    expect(text).not.toContain('annuler mon essai');
    expect(text).not.toContain('Gérer mon abonnement');
  });

  it('Essai Stripe : comportement inchangé (premier prélèvement + portail)', () => {
    const text = render({ offered: false }).textContent ?? '';
    expect(text).toContain('Essai gratuit\u00a0: il te reste 20 jours');
    expect(text).toContain('Premier prélèvement le');
    expect(text).toContain('Gérer / annuler mon essai →');
    expect(text).not.toContain('Premium offert');
  });

  it.each([
    ['Premium offert', { offered: true }],
    ['essai d’inscription', { offered: false, signup: true }],
    ['essai Stripe', { offered: false }],
  ])('textes de l’essai (%s) : espace insécable avant les deux-points (#769)', (_l, opts) => {
    const text = render(opts).textContent ?? '';
    expect(text).toContain('Accès à tout\u00a0: Insights IA');
    expect(text).not.toMatch(/(Premium offert|Essai gratuit|Accès à tout) :/);
  });

  it('fondateur : badge numéroté, tarif bloqué, remboursement sous 14 jours, rappel avant résiliation', () => {
    const el = render({
      offered: false, paying: true,
      offers: offers({
        founder: {
          isFounder: true, number: 12, interval: 'month', since: new Date().toISOString(),
          eligible: false, ineligibleReason: 'already_founder', refundUntil: IN_5_DAYS,
        },
        subscription: { interval: 'month', status: 'active' },
      }),
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Fondateur n° 12');
    expect(text).toContain('29 €/mois bloqué tant que ton abonnement reste actif. Si tu résilies, tu perds ce tarif.');
    const refund = el.querySelector<HTMLAnchorElement>('.plan-refund a');
    expect(refund?.textContent).toContain('Satisfait ou remboursé : demander le remboursement');
    expect(refund?.href).toMatch(/^mailto:support@mytradingcoach\.app\?subject=Remboursement%20fondateur%20n%C2%B0%2012/);
    expect(text).toContain("Passer à l'annuel (290 €/an)");
    expect(text).toContain('met fin à ton tarif fondateur');
    expect(text).toContain('Gérer mon abonnement →');
  });

  it('code partenaire : conditions figées affichées, intervalle au tarif partenaire', () => {
    const text = render({
      offered: false, paying: true,
      offers: offers({
        partner: {
          code: 'TRADER10', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null, label: '',
          since: new Date().toISOString(), endsAt: null,
        },
        subscription: { interval: 'month', status: 'active' },
      }),
    }).textContent ?? '';
    expect(text).toContain('Tarif partenaire TRADER10 : 29 €/mois à vie');
    expect(text).toContain("Passer à l'annuel (290 €/an à vie)");
    expect(text).toContain('met fin à ton tarif partenaire');
  });

  it('Premium offert + places fondateur : « Continuer en Premium » annonce le tarif fondateur', () => {
    const text = render({
      offered: true,
      offers: offers({
        founderOffer: { open: true, seatsLeft: 150, seatsTotal: 200 },
        founder: {
          isFounder: false, number: null, interval: null, since: null,
          eligible: true, ineligibleReason: null, refundUntil: null,
        },
      }),
    }).textContent ?? '';
    expect(text).toContain('Continuer en Premium · dès 29 €/mois →');
  });

  it('abonné au prix normal : changement d’intervalle au prix normal, aucun rappel de tarif', () => {
    const text = render({
      offered: false, paying: true,
      offers: offers({ subscription: { interval: 'year', status: 'active' } }),
    }).textContent ?? '';
    expect(text).toContain('Passer au mensuel (49 €/mois)');
    expect(text).not.toContain('met fin à ton tarif');
  });
});

describe('Profil > Abonnement : un bloc par état d’abonnement (#813)', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const IN_1_DAY = new Date(Date.now() + 86_400_000).toISOString();
  const IN_31_DAYS = new Date(Date.now() + 31 * 86_400_000).toISOString();
  const AGO_2_DAYS = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const NO_CANCEL_WORDING = (text: string) => {
    expect(text).not.toContain('annuler mon essai');
    expect(text).not.toMatch(/rembours/i);
  };

  it('2. réservation fondateur pendant l’essai : premier prélèvement à la fin de l’essai, portail « Gérer / annuler mon essai »', () => {
    const text = render({
      offered: false,
      user: { plan: 'PREMIUM', trialSource: 'SIGNUP', trialEndsAt: IN_20_DAYS, stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: IN_20_DAYS },
    }).textContent ?? '';
    expect(text).toContain('Essai gratuit\u00a0: il te reste 20 jours');
    expect(text).toContain('Premier prélèvement le');
    expect(text).toContain('Gérer / annuler mon essai →');
  });

  it('3. réservation à moins de 48 h, payée tout de suite : renouvellement, jamais « essai »', () => {
    const el = render({
      offered: false,
      user: { plan: 'PREMIUM', trialSource: 'SIGNUP', trialEndsAt: IN_1_DAY, stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: IN_31_DAYS },
    });
    const text = el.textContent ?? '';
    expect(el.querySelector('[data-testid="plan-renewal"]')?.textContent).toContain('Renouvellement\u00a0:');
    expect(text).toContain('Gérer mon abonnement →');
    expect(text).not.toContain('Essai gratuit');
    expect(text).not.toContain('Premier prélèvement');
    expect(text).not.toContain('annuler mon essai');
  });

  it('4. essai terminé en avance (T4) ou abonnement après l’essai : renouvellement', () => {
    for (const trialEndsAt of [IN_20_DAYS, AGO_2_DAYS]) {
      TestBed.resetTestingModule();
      const text = render({
        offered: false,
        user: { plan: 'PREMIUM', trialSource: 'SIGNUP', trialEndsAt, stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: IN_31_DAYS },
      }).textContent ?? '';
      expect(text).toContain('Renouvellement');
      expect(text).not.toContain('Essai gratuit');
    }
  });

  it('5. essai annulé : retour au gratuit daté, aucun prélèvement, ni bouton d’annulation ni remboursement', () => {
    const el = render({
      offered: false,
      offers: offers({ founder: { isFounder: true, number: 7, interval: 'month', since: null, eligible: false, ineligibleReason: null, refundUntil: null } }),
      user: {
        plan: 'PREMIUM', trialSource: 'SIGNUP', trialEndsAt: IN_20_DAYS, stripeSubscriptionStatus: 'trialing',
        stripeCurrentPeriodEnd: IN_20_DAYS, stripeCancelAt: IN_20_DAYS,
      },
    });
    const text = el.textContent ?? '';
    expect(el.querySelector('[data-testid="subscription-canceled"]')?.textContent).toContain('Essai annulé');
    expect(text).toContain('Tu repasses en gratuit le');
    expect(text).toContain('aucun prélèvement');
    expect(text).not.toContain('Premier prélèvement');
    expect(text).not.toContain('Essai gratuit');
    expect(el.querySelector('[data-testid="tariff-loss-note"]')).toBeNull();
    NO_CANCEL_WORDING(text);
  });

  it('abonnement payant résilié en fin de période : Premium jusqu’à la date, plus de renouvellement', () => {
    const el = render({
      offered: false,
      user: { plan: 'PREMIUM', trialEndsAt: null, stripeSubscriptionStatus: 'active', stripeCurrentPeriodEnd: IN_20_DAYS, stripeCancelAt: IN_20_DAYS },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Abonnement résilié');
    expect(text).toContain('Aucun nouveau prélèvement.');
    expect(el.querySelector('[data-testid="plan-renewal"]')).toBeNull();
    NO_CANCEL_WORDING(text);
  });

  it('6. en pause (past_due) : « Paiement en attente » et « Confirmer mon paiement », jamais « Passer Premium »', () => {
    const el = render({
      offered: false, premium: false,
      user: { plan: 'FREE', trialSource: 'SIGNUP', trialEndsAt: AGO_2_DAYS, stripeSubscriptionStatus: 'past_due', stripeCurrentPeriodEnd: IN_31_DAYS },
    });
    const text = el.textContent ?? '';
    expect(el.querySelector('[data-testid="payment-pending"]')?.textContent).toContain('Paiement en attente');
    expect(el.querySelector('[data-testid="confirm-payment"]')?.textContent).toContain('Confirmer mon paiement →');
    expect(text).not.toContain('Passer Premium');
    expect(text).not.toContain('Passer à Premium');
  });

  it('7. après l’essai, sans abonnement : bloc gratuit avec l’offre', () => {
    const text = render({
      offered: false, premium: false, user: { plan: 'FREE', trialSource: 'SIGNUP', trialEndsAt: AGO_2_DAYS, stripeSubscriptionStatus: null },
    }).textContent ?? '';
    expect(text).toContain('GRATUIT');
    expect(text).toContain('Passer à Premium');
    expect(text).not.toContain('Paiement en attente');
  });

  it('8. ancien essai Stripe de 30 jours (sans trialEndsAt) : premier prélèvement à la fin de période', () => {
    const text = render({
      offered: false, user: { plan: 'PREMIUM', trialEndsAt: null, stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: IN_20_DAYS },
    }).textContent ?? '';
    expect(text).toContain('Essai gratuit\u00a0: il te reste 20 jours');
    expect(text).not.toContain('Renouvellement');
  });
});

describe('Profil > Abonnement : jours restants en jours de calendrier, comme le bandeau', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('au passage de minuit, le décompte baisse d’un jour (et pas à l’heure de fin)', () => {
    // Fin de l'essai le 3 novembre à 8 h (heure locale).
    const end = new Date(2026, 10, 3, 8, 0).toISOString();
    const days = (now: Date) => {
      TestBed.resetTestingModule();
      vi.useFakeTimers({ now, toFake: ['Date'] });
      try {
        return render({ offered: false, signup: true, user: { trialSource: 'SIGNUP', trialEndsAt: end } }).textContent ?? '';
      } finally {
        vi.useRealTimers();
      }
    };
    expect(days(new Date(2026, 10, 1, 23, 59))).toContain('il te reste 2 jours');
    expect(days(new Date(2026, 10, 2, 0, 1))).toContain('il te reste 1 jour');
  });
});
