/**
 * Audit fonctionnel #993 (lot 2 #1013, B1) : `cta="notifications"` (réglages push) et `cta="autopsie"`
 * n'étaient pas dans OFFER_CTAS ; le DTO checkout (@IsIn + forbidNonWhitelisted) répondait 400 et le
 * paiement était impossible depuis ces écrans, comme depuis tout lien `?cta=` inconnu.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OFFER_CTAS } from '@mtc/shared';
import { BillingApi } from './billing.api';

describe('BillingApi.checkout — point de clic (cta)', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });
  const body = (cta: string | null) => {
    TestBed.inject(BillingApi).checkout('premium_monthly', { cta }).subscribe();
    const req = TestBed.inject(HttpTestingController).expectOne((r) => r.url.endsWith('/billing/checkout'));
    return req.request.body as Record<string, unknown>;
  };

  it.each(['notifications', 'autopsie'])('« %s » (boutons de l’app) est une valeur acceptée par l’API', (cta) => {
    expect(OFFER_CTAS as readonly string[]).toContain(cta);
    expect(body(cta).cta).toBe(cta);
  });

  it('valeur inconnue (lien ?cta=newsletter) : jamais envoyée, le paiement part quand même', () => {
    expect(body('newsletter')).not.toHaveProperty('cta');
  });
});
