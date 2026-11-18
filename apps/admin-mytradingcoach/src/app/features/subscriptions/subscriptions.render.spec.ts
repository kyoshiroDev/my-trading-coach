/**
 * Admin « Abonnements » (ADM-04) : montants tirés des prix partagés, jamais en dur,
 * et libellé d'essai conforme aux règles de plan (30 jours).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PREMIUM_PRICE_EUR } from '@mtc/shared';
import { SubscriptionsComponent } from './subscriptions.component';
import { environment } from '@admin/environments/environment';

const user = (id: string, stripeInterval: 'month' | 'year' | null) => ({
  id, email: `${id}@example.com`, name: null, plan: 'PREMIUM', role: 'USER', trialEndsAt: null,
  stripeInterval, stripeCurrentPeriodEnd: '2026-10-27T00:00:00.000Z', lastSeenAt: null, lastLoginAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
});

const FOUNDERS = {
  offer: { open: true, endsAt: null, seatsTotal: 200 },
  totals: { taken: 37, active: 35, lost: 2, refunded: 1, released: 0, seatsLeft: 163, byCta: [] },
  page: 1, pageSize: 50, total: 0, rows: [],
};

describe('SubscriptionsComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render(subs: 'error' | object) {
    const fixture = TestBed.createComponent(SubscriptionsComponent);
    fixture.detectChanges();
    const req = http.expectOne(`${environment.apiUrl}/admin/users/subscriptions`);
    if (subs === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
    else req.flush({ data: subs });
    http.expectOne(`${environment.apiUrl}/admin/users/stats`).flush({ data: { trials: 4, mrr: 98 } });
    http.expectOne((r) => r.url === `${environment.apiUrl}/admin/founders`).flush({ data: FOUNDERS });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('montant mensuel et annuel issus de PREMIUM_PRICE_EUR', async () => {
    const el = await render({ stripeUsers: [user('m', 'month'), user('y', 'year')], betaTesters: [], total: 2, page: 1, limit: 20 });
    const amounts = [...el.querySelectorAll('td[data-label="Montant"]')].map((td) => td.textContent?.trim());
    expect(amounts).toEqual([`${PREMIUM_PRICE_EUR.monthly} €/mois`, `${PREMIUM_PRICE_EUR.annual} €/an`]);
  });

  it('KPIs : MRR, essais et offerts (#828)', async () => {
    const el = await render({ stripeUsers: [], betaTesters: [], total: 0, page: 1, limit: 20 });
    expect(el.textContent).toContain('98€');
    expect(el.textContent).toContain('+ 0 offert');
    expect(el.textContent).not.toContain('essai 30 j');
    expect(el.textContent).not.toContain('7j');
  });

  it('Essais et offerts (#828) : type et prélèvement lus par subscriptionState', async () => {
    const soon = '2099-11-12T08:00:00.000Z';
    const trialUsers = [
      { ...user('inscription', null), plan: 'FREE', trialEndsAt: soon, trialSource: 'SIGNUP', stripeCurrentPeriodEnd: null },
      { ...user('reservation', 'month'), trialEndsAt: soon, trialSource: 'SIGNUP', stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: soon },
      { ...user('annule', 'month'), stripeSubscriptionStatus: 'trialing', stripeCurrentPeriodEnd: soon, stripeCancelAt: soon },
      { ...user('offert', null), plan: 'FREE', trialEndsAt: soon, trialSource: 'ADMIN', stripeCurrentPeriodEnd: null },
    ];
    const el = await render({ stripeUsers: [], betaTesters: [], trialUsers, total: 0, page: 1, limit: 20 });
    const rows = [...el.querySelectorAll('[data-testid="trial-row"]')].map((tr) =>
      [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent?.trim()));
    expect(rows).toEqual([
      ["Essai d'inscription", '12/11/2099', 'aucun'],
      ["Essai d'abonnement", '12/11/2099', 'à la fin'],
      ["Essai d'abonnement", '12/11/2099', 'annulé, aucun'],
      ['Premium offert', '12/11/2099', 'aucun'],
    ]);
  });

  it('panne de l’API : message explicite, Réessayer recharge', async () => {
    const el = await render('error');
    expect(el.textContent).toContain('Abonnements indisponibles');
    (el.querySelector('[data-testid="error-state-retry"]') as HTMLButtonElement).click();
    http.expectOne((r) => r.url === `${environment.apiUrl}/admin/users/subscriptions`);
  });

  // Vérificateur angular (#1065) : page suivante en échec → l'ancienne page restait affichée sous le
  // nouveau numéro, sans erreur.
  it('A8 : page suivante en échec, numéro inchangé et erreur affichée', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => user(`m${i}`, 'month'));
    const el = await render({ stripeUsers: page1, stripeTotal: 57, betaTesters: [], total: 57, page: 1, limit: 20 });
    (el.querySelector('[data-testid="subs-next"]') as HTMLButtonElement).click();
    http.expectOne((r) => r.url === `${environment.apiUrl}/admin/users/subscriptions`)
      .flush({}, { status: 500, statusText: 'Server Error' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(el.querySelector('.pagination')?.textContent).toContain('1 / 3');
    expect(el.querySelector('[data-testid="subs-page-error"]')?.textContent).toContain('page 2');
  });

  it('montant RÉEL (#525) : fondateur 29 €, code partenaire en cours à son prix, avec leur étiquette', async () => {
    const el = await render({
      stripeUsers: [
        { ...user('f', 'month'), founderSeat: { number: 12, status: 'ACTIVE' }, partnerRedemption: null },
        { ...user('p', 'year'), founderSeat: null, partnerRedemption: {
          status: 'ACTIVE', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null,
          createdAt: '2026-10-01T00:00:00.000Z', partnerCode: { code: 'TRADER10' },
        } },
      ],
      betaTesters: [], total: 2, page: 1, limit: 20,
    });
    const amounts = [...el.querySelectorAll('td[data-label="Montant"]')].map((td) => td.textContent?.trim());
    expect(amounts).toEqual(['29 €/mois', '290 €/an']);
    expect(el.textContent).toContain('Fondateur n° 12');
    expect(el.textContent).toContain('Code TRADER10');
  });

  it('KPI Fondateurs : places prises / 200, actifs, offre ouverte', async () => {
    const el = await render({ stripeUsers: [], betaTesters: [], total: 0, page: 1, limit: 20 });
    expect(el.textContent).toContain('37 / 200');
    expect(el.textContent).toContain('35 actifs · offre ouverte');
  });

  // A8 (#1065) : 20 lignes renvoyées, KPI « Stripe actifs » = 20, aucune pagination.
  it('A8 : KPI sur le total des abonnés, pagination vers la page 2', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => user(`m${i}`, 'month'));
    const el = await render({ stripeUsers: page1, stripeTotal: 57, betaTesters: [], total: 57, page: 1, limit: 20 });
    expect(el.querySelector('[data-testid="kpi-stripe"]')?.textContent?.trim()).toBe('57');
    (el.querySelector('[data-testid="subs-next"]') as HTMLButtonElement).click();
    const req = http.expectOne((r) => r.url === `${environment.apiUrl}/admin/users/subscriptions`);
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ data: { stripeUsers: [user('p2', 'year')], stripeTotal: 57, betaTesters: [], total: 57, page: 2, limit: 20 } });
  });

  // A9 (#1065) : abonné résilié affiché « actif » avec une date de « Renouvellement ».
  it('A9 : abonné résilié = « résilié », fin affichée, jamais « actif »', async () => {
    const end = '2099-12-01T00:00:00.000Z';
    const el = await render({
      stripeUsers: [{ ...user('r', 'month'), stripeSubscriptionStatus: 'active', stripeCancelAt: end }],
      stripeTotal: 1, betaTesters: [], total: 1, page: 1, limit: 20,
    });
    const status = el.querySelector('td[data-label="Statut"]')?.textContent?.trim();
    expect(status).toBe('résilié');
    expect(el.querySelector('td[data-label="Échéance"]')?.textContent?.trim()).toBe('fin le 01/12/2099');
  });

  // A10 (#1065) : abonnements en pause nulle part.
  it('A10 : bloc « En pause » avec les abonnements past_due / unpaid', async () => {
    const el = await render({
      stripeUsers: [], stripeTotal: 0, betaTesters: [], total: 0, page: 1, limit: 20,
      pausedUsers: [{ ...user('pause', 'month'), stripeSubscriptionStatus: 'past_due' }],
    });
    const rows = el.querySelectorAll('[data-testid="paused-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('pause@example.com');
    // Libellé français, jamais la valeur Stripe brute (vérificateur design #1065).
    expect(rows[0].textContent).toContain('paiement en retard');
    expect(rows[0].textContent).not.toContain('past_due');
  });

  // Règle 9 de plans.md : un bêta-testeur au plan FREE a l'accès Premium par son rôle ; jamais « FREE »
  // dans un badge Premium.
  it('A10 : accès manuels, accès réel affiché (rôle bêta ou Premium accordé)', async () => {
    const el = await render({
      stripeUsers: [], stripeTotal: 0, total: 2, page: 1, limit: 20,
      betaTesters: [
        { ...user('beta', null), plan: 'FREE', role: 'BETA_TESTER' },
        { ...user('offert', null), plan: 'PREMIUM', role: 'USER' },
      ],
    });
    const access = [...el.querySelectorAll('[data-testid="manual-access"]')].map((c) => c.textContent?.trim());
    expect(access).toEqual(['Premium par le rôle bêta', 'Premium accordé']);
    expect(el.textContent).not.toContain('FREE');
  });

  // A11 (#1065) : interrupteur ouvert mais l'offre ne vend plus → « offre terminée », jamais « ouverte ».
  it('A11 : KPI Fondateurs « offre terminée » quand l’offre ne vend plus', async () => {
    FOUNDERS.offer = { ...FOUNDERS.offer, ended: true } as typeof FOUNDERS.offer;
    try {
      const el = await render({ stripeUsers: [], betaTesters: [], total: 0, page: 1, limit: 20 });
      expect(el.textContent).toContain('offre terminée');
      expect(el.textContent).not.toContain('offre ouverte');
    } finally {
      FOUNDERS.offer = { open: true, endsAt: null, seatsTotal: 200 };
    }
  });
});
