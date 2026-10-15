/**
 * Notifications push de l'admin : diagnostic du support par cas (iPhone non installé, navigateur
 * sans push, permission refusée, serveur désactivé, supporté) et cycle abonnement / préférences.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';
import { of } from 'rxjs';
import { BROWSER_ENV, PushService, browserSupport, isIos, type BrowserEnv } from './push.service';
import { PushApi } from '../api/push.api';

const DESKTOP: BrowserEnv = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140',
  maxTouchPoints: 0,
  standalone: false,
  hasPushManager: true,
  notificationPermission: 'default',
};
const IPHONE: BrowserEnv = { ...DESKTOP, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)', maxTouchPoints: 5 };

describe('browserSupport', () => {
  it('iPhone hors écran d’accueil → ios-not-installed ; installé → supported', () => {
    expect(browserSupport(IPHONE, true)).toBe('ios-not-installed');
    expect(browserSupport({ ...IPHONE, standalone: true }, true)).toBe('supported');
  });

  it('iPadOS (Mac tactile) est traité comme iOS', () => {
    expect(isIos({ ...DESKTOP, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ ...DESKTOP, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 0 })).toBe(false);
  });

  it('service worker absent, pas de PushManager ou pas d’API Notification → unsupported', () => {
    expect(browserSupport(DESKTOP, false)).toBe('unsupported');
    expect(browserSupport({ ...DESKTOP, hasPushManager: false }, true)).toBe('unsupported');
    expect(browserSupport({ ...DESKTOP, notificationPermission: null }, true)).toBe('unsupported');
  });

  it('permission refusée → denied ; sinon supported', () => {
    expect(browserSupport({ ...DESKTOP, notificationPermission: 'denied' }, true)).toBe('denied');
    expect(browserSupport(DESKTOP, true)).toBe('supported');
  });
});

describe('PushService', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  const browserSub = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }) };
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let swPush: { isEnabled: boolean; subscription: unknown; requestSubscription: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> };
  let env: BrowserEnv;

  function create(): PushService {
    TestBed.configureTestingModule({
      providers: [
        { provide: PushApi, useValue: api },
        { provide: SwPush, useValue: swPush },
        { provide: BROWSER_ENV, useValue: () => env },
      ],
    });
    return TestBed.inject(PushService);
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    env = { ...DESKTOP };
    api = {
      publicKey: vi.fn().mockResolvedValue({ enabled: true, publicKey: 'BPUB' }),
      subscribe: vi.fn().mockResolvedValue({ subscribed: true, mutedEvents: ['SIGNUP'] }),
      unsubscribe: vi.fn().mockResolvedValue({ removed: true }),
      preferences: vi.fn(async (_e: string, muted: string[]) => ({ subscribed: true, mutedEvents: muted })),
      test: vi.fn().mockResolvedValue({ subscriptions: 2, delivered: 2, failed: 0, removed: 0 }),
    };
    swPush = {
      isEnabled: true,
      subscription: of(null),
      requestSubscription: vi.fn().mockResolvedValue(browserSub),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('iPhone non installé → ios-not-installed, sans appeler le serveur', async () => {
    env = { ...IPHONE };
    const s = create();
    await s.init();
    expect(s.support()).toBe('ios-not-installed');
    expect(api['publicKey']).not.toHaveBeenCalled();
  });

  it('serveur sans clés VAPID → server-disabled', async () => {
    api['publicKey'].mockResolvedValue({ enabled: false, publicKey: null });
    const s = create();
    await s.init();
    expect(s.support()).toBe('server-disabled');
  });

  it('déjà abonné → resynchronise le serveur et reprend les préférences de l’appareil', async () => {
    swPush.subscription = of(browserSub);
    const s = create();
    await s.init();
    expect(s.support()).toBe('supported');
    expect(s.subscribed()).toBe(true);
    expect(api['subscribe']).toHaveBeenCalledWith({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
    expect(s.mutedEvents()).toEqual(['SIGNUP']);
  });

  it('activer → demande la permission avec la clé publique du serveur, puis abonne', async () => {
    const s = create();
    await s.init();
    await s.enable();
    expect(swPush.requestSubscription).toHaveBeenCalledWith({ serverPublicKey: 'BPUB' });
    expect(s.subscribed()).toBe(true);
  });

  it('permission refusée pendant l’activation → denied + message', async () => {
    const s = create();
    await s.init();
    swPush.requestSubscription.mockRejectedValue(new Error('refus'));
    env = { ...env, notificationPermission: 'denied' };
    await s.enable();
    expect(s.support()).toBe('denied');
    expect(s.error()).toContain('refusées');
    expect(s.subscribed()).toBe(false);
  });

  it('cocher / décocher un événement → préférences envoyées ; échec API → retour arrière', async () => {
    swPush.subscription = of(browserSub);
    const s = create();
    await s.init();
    await s.setEventEnabled('SIGNUP', true);
    expect(api['preferences']).toHaveBeenLastCalledWith(endpoint, []);
    await s.setEventEnabled('PREMIUM', false);
    expect(s.mutedEvents()).toEqual(['PREMIUM']);
    api['preferences'].mockRejectedValueOnce(new Error('500'));
    await s.setEventEnabled('BILLING_ISSUE', false);
    expect(s.mutedEvents()).toEqual(['PREMIUM']);
    expect(s.error()).not.toBeNull();
  });

  it('désactiver → désabonne côté serveur puis côté navigateur', async () => {
    swPush.subscription = of(browserSub);
    const s = create();
    await s.init();
    await s.disable();
    expect(api['unsubscribe']).toHaveBeenCalledWith(endpoint);
    expect(swPush.unsubscribe).toHaveBeenCalled();
    expect(s.subscribed()).toBe(false);
  });

  it('test → message selon le bilan', async () => {
    const s = create();
    expect(await s.test()).toBe('Notification envoyée à 2 appareils.');
    api['test'].mockResolvedValue({ subscriptions: 0, delivered: 0, failed: 0, removed: 0 });
    expect(await s.test()).toBe('Aucun appareil abonné.');
  });
});
