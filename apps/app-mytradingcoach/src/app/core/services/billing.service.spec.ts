import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { BillingService } from './billing.service';
import { BillingApi } from '../api/billing.api';

describe('BillingService', () => {
  const checkout = vi.fn();
  const navigate = vi.fn().mockResolvedValue(true);
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: BillingApi, useValue: { checkout } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    service = TestBed.inject(BillingService);
  });

  it('startCheckout ouvre la page de paiement de l’app avec l’offre, le point de clic et le code', () => {
    service.startCheckout('founder_monthly', { cta: 'carte', promo: null });
    expect(navigate).toHaveBeenCalledWith(['/paiement'], { queryParams: { plan: 'founder_monthly', cta: 'carte' } });

    service.startCheckout('premium_monthly', { promo: 'LOUIS29' });
    expect(navigate).toHaveBeenLastCalledWith(['/paiement'], { queryParams: { plan: 'premium_monthly', promo: 'LOUIS29' } });
  });

  it('createSession demande une session pour la page de l’app (ui elements)', () => {
    checkout.mockReturnValue(of({ data: { url: 'x' } }));
    service.createSession('premium_yearly', { cta: 'profil' }).subscribe();
    expect(checkout).toHaveBeenCalledWith('premium_yearly', { cta: 'profil', ui: 'elements' });
  });
});
