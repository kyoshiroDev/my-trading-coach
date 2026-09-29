import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BillingService } from './billing.service';
import { BillingApi } from '../api/billing.api';
import { ToastService } from './toast.service';

describe('BillingService.startCheckout', () => {
  const checkout = vi.fn();
  const toast = { error: vi.fn() };
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: BillingApi, useValue: { checkout } },
        { provide: ToastService, useValue: toast },
      ],
    });
    service = TestBed.inject(BillingService);
    vi.spyOn(service, 'redirect').mockImplementation(() => undefined);
  });

  it('redirige vers Stripe', () => {
    checkout.mockReturnValue(of({ data: { url: 'https://checkout.stripe.com/x' } }));
    service.startCheckout('premium_monthly');
    expect(service.redirect).toHaveBeenCalledWith('https://checkout.stripe.com/x');
  });

  it("échec : message d'erreur et bouton réactivé (plus d'échec silencieux)", () => {
    checkout.mockReturnValue(throwError(() => ({ status: 500 })));
    service.startCheckout('premium_yearly');
    expect(toast.error).toHaveBeenCalledWith('Le paiement n’a pas pu démarrer. Réessaie dans un instant.');
    expect(service.starting()).toBe(false);
  });

  it("échec avec gestion personnalisée : pas de message par défaut", () => {
    checkout.mockReturnValue(throwError(() => ({ status: 500 })));
    const onError = vi.fn();
    service.startCheckout('premium_monthly', onError);
    expect(onError).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ignore un double clic pendant la création de la session', () => {
    checkout.mockReturnValue(of());
    service.startCheckout('premium_monthly');
    service.startCheckout('premium_monthly');
    expect(checkout).toHaveBeenCalledTimes(1);
  });
});
