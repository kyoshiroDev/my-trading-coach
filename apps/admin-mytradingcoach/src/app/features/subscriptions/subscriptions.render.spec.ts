/**
 * Admin « Abonnements » (ADM-04) : montants tirés des prix partagés, jamais en dur,
 * et libellé d'essai conforme aux règles de plan (30 jours).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
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

  it('KPIs : MRR et essais, essai annoncé à 30 jours', async () => {
    const el = await render({ stripeUsers: [], betaTesters: [], total: 0, page: 1, limit: 20 });
    expect(el.textContent).toContain('98€');
    expect(el.textContent).toContain('essai 30 j');
    expect(el.textContent).not.toContain('7j');
  });

  it('panne de l’API : message explicite', async () => {
    const el = await render('error');
    expect(el.textContent).toContain('Abonnements indisponibles');
  });

  it('montant RÉEL (#525) : fondateur 29 €, code partenaire en cours à son prix, avec leur étiquette', async () => {
    const el = await render({
      stripeUsers: [
        { ...user('f', 'month'), founderSeat: { number: 12, status: 'ACTIVE' }, partnerRedemption: null },
        { ...user('p', 'year'), founderSeat: null, partnerRedemption: {
          status: 'ACTIVE', priceMonthlyEur: 29, priceAnnualEur: 290, durationMonths: null,
          createdAt: '2026-10-01T00:00:00.000Z', partnerCode: { code: 'LOUIS29' },
        } },
      ],
      betaTesters: [], total: 2, page: 1, limit: 20,
    });
    const amounts = [...el.querySelectorAll('td[data-label="Montant"]')].map((td) => td.textContent?.trim());
    expect(amounts).toEqual(['29 €/mois', '290 €/an']);
    expect(el.textContent).toContain('Fondateur n° 12');
    expect(el.textContent).toContain('Code LOUIS29');
  });

  it('KPI Fondateurs : places prises / 200, actifs, offre ouverte', async () => {
    const el = await render({ stripeUsers: [], betaTesters: [], total: 0, page: 1, limit: 20 });
    expect(el.textContent).toContain('37 / 200');
    expect(el.textContent).toContain('35 actifs · offre ouverte');
  });
});

