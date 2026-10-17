import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { environment } from '@app/environments/environment';
import { SignupFunnelService, registerErrorCode } from './signup-funnel.service';

const FUNNEL_URL = `${environment.apiUrl}/public/funnel`;

/** Contenu d'un Blob (jsdom n'implémente pas `Blob.text()`). */
const readBlob = (b: Blob) =>
  new Promise<string>((done) => {
    const r = new FileReader();
    r.onload = () => done(r.result as string);
    r.readAsText(b);
  });

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
  /** Envois par sendBeacon : [url, blob]. */
  let beacons: [string, Blob][];
  let beaconOk: boolean;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const make = () => TestBed.inject(SignupFunnelService);
  const bodies = () =>
    Promise.all(beacons.map(async ([url, blob]) => {
      expect(url).toBe(FUNNEL_URL);
      expect(blob.type).toBe('text/plain');
      return JSON.parse(await readBlob(blob)) as Record<string, unknown>;
    }));

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('mtc_internal');
    delete window.mtcRegisterView;
    beacons = [];
    beaconOk = true;
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (url: string, blob: Blob) => {
        beacons.push([url, blob]);
        return beaconOk;
      },
    });
    fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
  });

  it("register_view porte l'origine du parcours, les étapes suivantes aussi (text/plain, sans requête préalable)", async () => {
    const funnel = make();
    funnel.start({ source: 'instagram', medium: 'paid', campaign: 'fondateur-reel' });
    funnel.track('register_error', 'email_taken');
    const [view, error] = await bodies();
    expect(view).toEqual({
      step: 'register_view',
      source: 'instagram',
      medium: 'paid',
      campaign: 'fondateur-reel',
      inApp: false,
    });
    expect(error).toMatchObject({ step: 'register_error', source: 'instagram', detail: 'email_taken' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("register_view déjà envoyé par index.html : pas de double comptage, l'origine est gardée", async () => {
    window.mtcRegisterView = true;
    const funnel = make();
    funnel.start({ source: 'instagram' });
    expect(beacons).toHaveLength(0);
    expect(JSON.parse(sessionStorage.getItem('mtc_funnel') ?? '{}')).toEqual({ source: 'instagram' });

    // Le marqueur ne vaut que pour ce chargement : une nouvelle arrivée par navigation interne compte.
    funnel.start({ source: 'instagram' });
    expect((await bodies()).map((b) => b['step'])).toEqual(['register_view']);
  });

  it('sendBeacon indisponible ou refusé : repli fetch keepalive en text/plain', () => {
    beaconOk = false;
    make().track('register_submit');
    expect(fetchSpy).toHaveBeenCalledWith(
      FUNNEL_URL,
      expect.objectContaining({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' } }),
    );
  });

  it("checkout_redirect seulement si l'onglet est passé par /register, detail = offre", async () => {
    const funnel = make();
    funnel.trackCheckout('premium_monthly');
    expect(beacons).toHaveLength(0);

    funnel.start({});
    funnel.trackCheckout('founder_monthly');
    expect((await bodies())[1]).toMatchObject({ step: 'checkout_redirect', detail: 'founder' });
  });

  it("l'origine survit à un rechargement de l'onglet (sessionStorage)", async () => {
    make().start({ source: 'x' });
    TestBed.resetTestingModule();
    make().trackCheckout('premium_yearly');
    expect((await bodies())[1]).toMatchObject({ source: 'x', detail: 'premium' });
  });

  it('mode interne : ?internal=1 coupe tout envoi, ?internal=0 le rétablit', () => {
    const funnel = make();
    funnel.captureInternal('?internal=1');
    expect(funnel.internal()).toBe(true);
    expect(localStorage.getItem('mtc_internal')).toBe('1');
    funnel.start({ source: 'x' });
    funnel.track('register_submit');
    expect(beacons).toHaveLength(0);

    funnel.captureInternal('?internal=0');
    expect(funnel.internal()).toBe(false);
    expect(localStorage.getItem('mtc_internal')).toBeNull();
    funnel.track('register_submit');
    expect(beacons).toHaveLength(1);
  });

  it('un lien sans internal ne change pas le mode mémorisé', () => {
    localStorage.setItem('mtc_internal', '1');
    const funnel = make();
    funnel.captureInternal('?utm_source=x');
    expect(funnel.internal()).toBe(true);
  });
});
