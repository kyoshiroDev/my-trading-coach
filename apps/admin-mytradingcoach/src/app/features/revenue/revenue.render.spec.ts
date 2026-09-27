/**
 * Admin « Revenus » (ADM-04) : rendu des montants et comportement en cas de panne de l'API.
 * Avant : une erreur sur /stats laissait « Chargement… » affiché indéfiniment.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RevenueComponent } from './revenue.component';
import { AdminStats } from '../../core/api/admin.api';
import { environment } from '@admin/environments/environment';

const STATS = {
  mrr: 1470, arr: 17640, totalUsers: 120, totalPremium: 32, premiumMonthly: 30, premiumAnnual: 2,
  monthly: 30, annual: 2, trials: 4, freeUsers: 84, newThisMonth: 9, churnedThisMonth: 1,
  betaTesters: 3, ambassadors: 2, tradersActifs7d: 40, tradersActifs30d: 70,
  comptesSupprimesMois: 1, comptesSupprimesTotal: 5,
} as AdminStats;

describe('RevenueComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render(stats: AdminStats | 'error') {
    const fixture = TestBed.createComponent(RevenueComponent);
    fixture.detectChanges();
    const req = http.expectOne(`${environment.apiUrl}/admin/users/stats`);
    if (stats === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
    else req.flush({ data: stats });
    http.expectOne((r) => r.url === `${environment.apiUrl}/admin/metrics/history`).flush({ data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('affiche MRR et ARR formatés, sans décimales', async () => {
    const { el } = await render(STATS);
    const values = [...el.querySelectorAll('.kpi-value')].map((n) => n.textContent?.trim());
    expect(values[0]).toBe('€1,470');
    expect(values[1]).toBe('€17,640');
    expect(values[2]).toBe('30');
    expect(values[3]).toBe('2');
  });

  it('panne de l’API : message et bouton « Réessayer » à la place du chargement infini', async () => {
    const { el, fixture } = await render('error');
    expect(el.textContent).toContain('Revenus indisponibles');
    expect(el.textContent).not.toContain('Chargement…');

    el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    http.expectOne(`${environment.apiUrl}/admin/users/stats`).flush({ data: STATS });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.kpi-value')?.textContent?.trim()).toBe('€1,470');
  });

  it('réconciliation Stripe : affiche l’écart en rouge quand DB et Stripe divergent', async () => {
    const { el, fixture } = await render(STATS);
    el.querySelector<HTMLButtonElement>('.page-head .btn')!.click();
    http.expectOne(`${environment.apiUrl}/admin/stripe/reconcile`).flush({
      data: {
        mrrDb: 1470, mrrStripe: 1421, gap: 49, dbActiveCount: 32, stripeActiveCount: 31,
        divergences: {
          inDbNotStripe: [{ userId: 'u1', email: 'a@example.com', name: null, plan: 'PREMIUM', subscriptionId: null, status: 'canceled' }],
          inStripeNotDb: [],
        },
      },
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const gap = [...el.querySelectorAll('.mini')].find((m) => m.textContent?.includes('Écart'))!;
    expect(gap.querySelector('.mini-v')!.textContent?.trim()).toBe('€49');
    expect(gap.querySelector('.mini-v')!.classList).toContain('red');
    expect(el.textContent).toContain('DB sans Stripe · a@example.com');
  });
});
