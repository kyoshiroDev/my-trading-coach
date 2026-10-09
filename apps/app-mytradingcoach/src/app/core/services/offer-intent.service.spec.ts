import { describe, it, expect, beforeEach } from 'vitest';
import { OfferIntentService, intentFromSearch } from './offer-intent.service';

describe('intentFromSearch — lien d’arrivée (#525)', () => {
  it('plan=founder, promo et cta : lus et normalisés', () => {
    expect(intentFromSearch('?plan=founder&promo=louis29&cta=bandeau&utm_source=x')).toEqual({
      plan: 'founder', promo: 'LOUIS29', cta: 'bandeau',
    });
  });

  it('promo seul ou plan=premium : intention ; rien d’utile → null', () => {
    expect(intentFromSearch('?promo=LOUIS29')).toEqual({ plan: null, promo: 'LOUIS29', cta: null });
    expect(intentFromSearch('?plan=premium')).toEqual({ plan: 'premium', promo: null, cta: null });
    expect(intentFromSearch('?utm_source=x')).toBeNull();
    expect(intentFromSearch('?plan=gold')).toBeNull();
  });

  it('valeurs hors format ignorées (code ou cta injectés)', () => {
    expect(intentFromSearch('?plan=founder&promo=<script>&cta=../x')).toEqual({ plan: 'founder', promo: null, cta: null });
  });
});

describe('OfferIntentService', () => {
  beforeEach(() => sessionStorage.clear());

  it('capture → gardée en session (survit à l’inscription), needsChoice, clear', () => {
    const s = new OfferIntentService();
    s.capture('?plan=founder&cta=carte');
    expect(s.needsChoice()).toBe(true);
    expect(new OfferIntentService().pending()).toEqual({ plan: 'founder', promo: null, cta: 'carte' });
    s.clear();
    expect(s.pending()).toBeNull();
    expect(new OfferIntentService().pending()).toBeNull();
  });

  it('plan=premium seul : pas de choix à faire (checkout direct à l’inscription, comme avant)', () => {
    const s = new OfferIntentService();
    s.capture('?plan=premium');
    expect(s.needsChoice()).toBe(false);
  });

  it('open(cta) : ouverture demandée par un écran, effacée par clear()', () => {
    const s = new OfferIntentService();
    s.open('cadenas');
    expect(s.requested()).toEqual({ cta: 'cadenas' });
    s.clear();
    expect(s.requested()).toBeNull();
  });
});
