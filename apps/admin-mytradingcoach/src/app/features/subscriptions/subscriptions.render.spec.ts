/**
 * Admin « Abonnements » (ADM-04) : montants tirés des prix partagés, jamais en dur,
 * et libellé d'essai conforme aux règles de plan (30 jours).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PREMIUM_PRICE_EUR } from '@mtc/shared';
import { SubscriptionsComponent } from './subscriptions.component';
import { environment } from '../../../environments/environment';

const user = (id: string, stripeInterval: 'month' | 'year' | null) => ({
  id, email: `${id}@example.com`, name: null, plan: 'PREMIUM', role: 'USER', trialEndsAt: null,
  stripeInterval, stripeCurrentPeriodEnd: '2026-10-27T00:00:00.000Z', lastSeenAt: null, lastLoginAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
});

describe('SubscriptionsComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
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
});
