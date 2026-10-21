import { describe, expect, it } from 'vitest';
import { internalFlagFromSearch, isInAppBrowser, signupFunnelDetail } from './signup-funnel';

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
    expect(signupFunnelDetail('rules_use', 'x')).toBe('');
  });

  it('garde un seuil d’engagement connu, vide le reste', () => {
    expect(signupFunnelDetail('scroll_depth', '75')).toBe('75');
    expect(signupFunnelDetail('scroll_depth', '60')).toBe('');
    expect(signupFunnelDetail('time_on_page', '30')).toBe('30');
    expect(signupFunnelDetail('time_on_page', '25')).toBe('');
  });
});

describe('isInAppBrowser', () => {
  it('reconnaît les navigateurs intégrés Instagram, Facebook, TikTok, LINE', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0 (iPhone14,5; iOS 17_5; fr_FR)',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36 Instagram 330.0.0.0 Android',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0;FBBV/1]',
      'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]',
      'Mozilla/5.0 (iPhone) Mobile/15E148 musical_ly_35.1.0 JsSdk/2.0 BytedanceWebview',
      'Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36 trill_350 TikTok',
      'Mozilla/5.0 (iPhone) Mobile/15E148 Safari Line/14.5.0',
    ]) {
      expect(isInAppBrowser(ua)).toBe(true);
    }
  });

  it('laisse les navigateurs normaux et les UA absents', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Gecko/20100101 Firefox/128.0',
      '',
      undefined,
    ]) {
      expect(isInAppBrowser(ua)).toBe(false);
    }
  });
});

describe('internalFlagFromSearch', () => {
  it('1 active, 0 désactive, sinon on garde l’état mémorisé', () => {
    expect(internalFlagFromSearch('?internal=1')).toBe(true);
    expect(internalFlagFromSearch('?utm_source=x&internal=0')).toBe(false);
    expect(internalFlagFromSearch('?internal=yes')).toBeNull();
    expect(internalFlagFromSearch('')).toBeNull();
  });
});
