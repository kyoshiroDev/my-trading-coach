import { describe, expect, it } from 'vitest';
import { signupFunnelDetail } from './signup-funnel';

describe('signupFunnelDetail (liste blanche de detail)', () => {
  it('garde un CTA connu, normalisé', () => {
    expect(signupFunnelDetail('cta_click', 'founder')).toBe('founder');
    expect(signupFunnelDetail('cta_click', ' Premium ')).toBe('premium');
  });

  it("vide un CTA inconnu (jamais de texte libre en base)", () => {
    expect(signupFunnelDetail('cta_click', 'jean@example.com')).toBe('');
    expect(signupFunnelDetail('cta_click', undefined)).toBe('');
  });

  it('garde le plan du paiement, rien d’autre', () => {
    expect(signupFunnelDetail('checkout_redirect', 'founder')).toBe('founder');
    expect(signupFunnelDetail('checkout_redirect', 'free')).toBe('');
  });

  it("ramène une erreur inconnue à other, garde une erreur connue", () => {
    expect(signupFunnelDetail('register_error', 'email_taken')).toBe('email_taken');
    expect(signupFunnelDetail('register_error', 'Internal Server Error')).toBe('other');
    expect(signupFunnelDetail('register_error', null)).toBe('other');
  });

  it('ignore detail pour les étapes qui n’en ont pas', () => {
    expect(signupFunnelDetail('register_view', 'founder')).toBe('');
    expect(signupFunnelDetail('register_submit', 'x')).toBe('');
    expect(signupFunnelDetail('register_success', 'founder')).toBe('');
  });
});
