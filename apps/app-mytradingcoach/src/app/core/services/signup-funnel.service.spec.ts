import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@app/environments/environment';
import { SignupFunnelService, registerErrorCode } from './signup-funnel.service';

const FUNNEL_URL = `${environment.apiUrl}/public/funnel`;

describe('registerErrorCode', () => {
  it('normalise le statut HTTP en code fermé', () => {
    expect(registerErrorCode(409)).toBe('email_taken');
    expect(registerErrorCode(400)).toBe('validation');
    expect(registerErrorCode(0)).toBe('network');
    expect(registerErrorCode(503)).toBe('server');
    expect(registerErrorCode(429)).toBe('other');
    expect(registerErrorCode(undefined)).toBe('other');
  });
});

describe('SignupFunnelService', () => {
  let http: HttpTestingController;
  const make = () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(SignupFunnelService);
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('mtc_internal');
  });
  afterEach(() => http.verify());

  it("register_view porte l'origine du parcours, les étapes suivantes aussi", () => {
    const funnel = make();
    funnel.start({ source: 'instagram', medium: 'paid', campaign: 'fondateur-reel' });
    funnel.track('register_error', 'email_taken');
    const [view, error] = http.match(FUNNEL_URL);
    expect(view.request.body).toEqual({
      step: 'register_view',
      source: 'instagram',
      medium: 'paid',
      campaign: 'fondateur-reel',
      inApp: false,
    });
    expect(error.request.body).toMatchObject({ step: 'register_error', source: 'instagram', detail: 'email_taken' });
  });

  it("checkout_redirect seulement si l'onglet est passé par /register, detail = offre", () => {
    const funnel = make();
    funnel.trackCheckout('premium_monthly');
    http.expectNone(FUNNEL_URL);

    funnel.start({});
    http.expectOne(FUNNEL_URL).flush(null);
    funnel.trackCheckout('founder_monthly');
    expect(http.expectOne(FUNNEL_URL).request.body).toMatchObject({ step: 'checkout_redirect', detail: 'founder' });
  });

  it("l'origine survit à un rechargement de l'onglet (sessionStorage)", () => {
    make().start({ source: 'x' });
    http.expectOne(FUNNEL_URL).flush(null);
    TestBed.resetTestingModule();
    make().trackCheckout('premium_yearly');
    expect(http.expectOne(FUNNEL_URL).request.body).toMatchObject({ source: 'x', detail: 'premium' });
  });

  it('mode interne : ?internal=1 coupe tout envoi, ?internal=0 le rétablit', () => {
    const funnel = make();
    funnel.captureInternal('?internal=1');
    expect(funnel.internal()).toBe(true);
    expect(localStorage.getItem('mtc_internal')).toBe('1');
    funnel.start({ source: 'x' });
    funnel.track('register_submit');
    http.expectNone(FUNNEL_URL);

    funnel.captureInternal('?internal=0');
    expect(funnel.internal()).toBe(false);
    expect(localStorage.getItem('mtc_internal')).toBeNull();
    funnel.track('register_submit');
    http.expectOne(FUNNEL_URL);
  });

  it('un lien sans internal ne change pas le mode mémorisé', () => {
    localStorage.setItem('mtc_internal', '1');
    const funnel = make();
    funnel.captureInternal('?utm_source=x');
    expect(funnel.internal()).toBe(true);
  });
});
