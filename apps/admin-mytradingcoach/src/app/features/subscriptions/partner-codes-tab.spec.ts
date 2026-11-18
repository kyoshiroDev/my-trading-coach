import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PartnerCodesTabComponent } from './partner-codes-tab.component';
import { environment } from '@admin/environments/environment';

/** A12 (#1065) : les abonnés d'un code partenaire restaient sur « Chargement… » à vie en cas d'erreur. */
const BASE = `${environment.apiUrl}/admin/partner-codes`;
const code = (id: string) => ({
  id, code: id.toUpperCase(), label: id, priceMonthlyEur: 39, priceAnnualEur: 390, durationMonths: null,
  maxRedemptions: null, expiresAt: null, active: true, createdAt: '2026-10-01T00:00:00.000Z', conditions: '39 €/mois',
  used: 1, activeSubscribers: 1, lost: 0, released: 0, pendingCheckouts: 0,
});

describe('PartnerCodesTabComponent — abonnés d’un code (A12 #1065)', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(PartnerCodesTabComponent);
    fixture.detectChanges();
    http.expectOne(BASE).flush({ data: [code('a'), code('b')] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const usersBtn = (i: number) => [...el.querySelectorAll('button')].filter((b) => b.textContent?.includes('Abonnés'))[i] as HTMLButtonElement;
    return { fixture, el, usersBtn };
  }

  it('erreur : message et Réessayer, jamais « Chargement… » à vie', async () => {
    const { fixture, el, usersBtn } = await render();
    usersBtn(0).click();
    http.expectOne(`${BASE}/a/users`).flush({}, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(el.querySelector('.users-list')?.textContent).not.toContain('Chargement');
    (el.querySelector('.users-list [data-testid="error-state-retry"]') as HTMLButtonElement).click();
    http.expectOne(`${BASE}/a/users`).flush({ data: { redemptions: [] } });
    fixture.detectChanges();
    expect(el.querySelector('.users-list')?.textContent).toContain('Personne n');
  });

  it('clic sur A puis B : la réponse tardive de A n’est pas affichée sous B', async () => {
    const { fixture, el, usersBtn } = await render();
    usersBtn(0).click();
    const reqA = http.expectOne(`${BASE}/a/users`);
    usersBtn(1).click();
    const reqB = http.expectOne(`${BASE}/b/users`);
    if (!reqA.cancelled) reqA.flush({ data: { redemptions: [{ id: 'r1', createdAt: '2026-10-02T00:00:00.000Z', status: 'ACTIVE', user: { id: 'u1', email: 'de-a@test.local' } }] } });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('de-a@test.local');
    reqB.flush({ data: { redemptions: [] } });
  });
});
