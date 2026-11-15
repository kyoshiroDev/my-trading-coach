import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { OffersStore } from '../stores/offers.store';
import { ToastService } from './toast.service';
import {
  CheckoutReturnService,
  CHECKOUT_CANCELED_MESSAGE,
  CHECKOUT_SUCCESS_MESSAGE,
} from './checkout-return.service';

/** B2 (#1013) : retour de Stripe sur /dashboard?checkout=… — Premium visible tout de suite, un message. */
describe('CheckoutReturnService — retour de Stripe', () => {
  const user = signal<Record<string, unknown> | null>({ id: 'u1', plan: 'FREE', role: 'USER' });
  let fetchMe: ReturnType<typeof vi.fn>;
  let toast: { success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let offers: { refresh: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.fn>;

  function setup(): CheckoutReturnService {
    fetchMe = vi.fn(() => of({}));
    toast = { success: vi.fn(), info: vi.fn() };
    offers = { refresh: vi.fn() };
    navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser: user, fetchMe } },
        { provide: OffersStore, useValue: offers },
        { provide: ToastService, useValue: toast },
        { provide: Router, useValue: { navigate } },
      ],
    });
    return TestBed.inject(CheckoutReturnService);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    user.set({ id: 'u1', plan: 'FREE', role: 'USER' });
  });
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('succès : toast, compte relu jusqu’à voir l’abonnement (webhook en retard), offres rechargées, paramètre retiré', async () => {
    const s = setup();
    s.handle('success');
    expect(toast.success).toHaveBeenCalledWith(CHECKOUT_SUCCESS_MESSAGE);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({
      queryParams: { checkout: null, session_id: null }, replaceUrl: true,
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMe).toHaveBeenCalledTimes(1);
    // Le webhook arrive entre la 1re et la 2e relecture.
    user.set({ id: 'u1', plan: 'PREMIUM', role: 'USER', stripeSubscriptionStatus: 'active' });
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchMe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMe).toHaveBeenCalledTimes(2); // arrêt dès l'abonnement vu
    expect(offers.refresh).toHaveBeenCalledTimes(1);
  });

  it('succès sans webhook : 4 relectures sur 10 s au plus, puis s’arrête', async () => {
    const s = setup();
    s.handle('success');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMe).toHaveBeenCalledTimes(4);
    expect(offers.refresh).toHaveBeenCalledTimes(1);
  });

  it('annulé : toast d’information, aucune relecture', async () => {
    const s = setup();
    s.handle('canceled');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(toast.info).toHaveBeenCalledWith(CHECKOUT_CANCELED_MESSAGE);
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('une seule fois par chargement ; autre valeur ou absence ignorées', () => {
    const s = setup();
    s.handle(null);
    s.handle('autre');
    expect(toast.success).not.toHaveBeenCalled();
    s.handle('success');
    s.handle('success');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
