/**
 * Admin « Ambassadeurs » (ADM-04) : rendu des commissions et action « Payer ».
 * Le paiement passe par la confirmation (montant et nom rappelés) et n'est jamais silencieux.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConfirmService } from '@mtc/front-ui';
import { AmbassadeursComponent } from './ambassadeurs.component';
import { environment } from '../../../environments/environment';

const AMB = {
  id: 'amb1', name: 'Alice', email: 'alice@example.com', referralCode: 'ALICE',
  totalReferrals: 5, premiumReferrals: 2, totalEarned: 58.8, pendingPayout: 19.6,
};
const DETAIL = {
  referralCode: 'ALICE', referrals: [], total: 5, free: 3, premium: 2,
  earningsByMonth: {}, totalEarned: 58.8, pendingPayout: 19.6,
};
const tick = () => new Promise((r) => setTimeout(r));

describe('AmbassadeursComponent', () => {
  let http: HttpTestingController;
  let ask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ask = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ConfirmService, useValue: { ask } }],
    });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function render() {
    const fixture = TestBed.createComponent(AmbassadeursComponent);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/admin/ambassadors`).flush({ data: [AMB] });
    http.expectOne(`${environment.apiUrl}/admin/ambassadors/amb1/stats`).flush({ data: DETAIL });
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('affiche le dû et le total payé avec 2 décimales', async () => {
    const { el } = await render();
    expect(el.querySelector('td[data-label="Dû"]')!.textContent?.trim()).toBe('19.60€');
    expect(el.querySelector('td[data-label="Total payé"]')!.textContent?.trim()).toBe('39.20€');
  });

  it('« Payer » demande confirmation en rappelant montant et nom, puis appelle l’API', async () => {
    const { el } = await render();
    el.querySelector<HTMLButtonElement>('.pay-btn')!.click();
    await tick();
    expect(ask).toHaveBeenCalledOnce();
    const opts = ask.mock.calls[0][0];
    expect(opts.title).toMatch(/19,60\s€/);
    expect(opts.message).toContain('Alice');
    expect(opts.danger).toBe(true);
    const req = http.expectOne(`${environment.apiUrl}/admin/ambassadors/amb1/pay-all`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { success: true } });
    // Rechargement de la liste après paiement.
    http.expectOne(`${environment.apiUrl}/admin/ambassadors`).flush({ data: [{ ...AMB, pendingPayout: 0 }] });
    http.expectOne(`${environment.apiUrl}/admin/ambassadors/amb1/stats`).flush({ data: { ...DETAIL, pendingPayout: 0 } });
  });

  it('confirmation refusée : aucun appel de paiement', async () => {
    ask.mockResolvedValueOnce(false);
    const { el } = await render();
    el.querySelector<HTMLButtonElement>('.pay-btn')!.click();
    await tick();
    http.expectNone(`${environment.apiUrl}/admin/ambassadors/amb1/pay-all`);
  });

  it('échec du paiement : message affiché (plus silencieux)', async () => {
    const { el, fixture } = await render();
    el.querySelector<HTMLButtonElement>('.pay-btn')!.click();
    await tick();
    http.expectOne(`${environment.apiUrl}/admin/ambassadors/amb1/pay-all`).flush({}, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="pay-error"]')?.textContent).toMatch(/19,60\s€/);
  });
});
