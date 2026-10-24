import { describe, it, expect, vi, afterEach } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TraderPushSettings } from '@mtc/shared';
import { PushApi } from '../api/push.api';
import { AuthService } from '../auth/auth.service';
import { UserScopedReset } from '../auth/user-scoped-reset';
import { PUSH_BROWSER, type BrowserEnv, type PushBrowser } from './push-browser';
import { PushService, browserState } from './push.service';

/** États du push sur cet appareil (#666 phase 2) et règles d'abonnement. */

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM = `${IPHONE_SAFARI} Instagram 350.0.0`;

const env = (over: Partial<BrowserEnv> = {}): BrowserEnv => ({
  userAgent: CHROME_ANDROID, maxTouchPoints: 5, standalone: false, hasServiceWorker: true, hasPushManager: true,
  notificationPermission: 'default', ...over,
});

const settings = (over: Partial<TraderPushSettings> = {}): TraderPushSettings => ({
  enabled: true, publicKey: 'BPub', mutedTypes: ['RECAP'], quietHours: null, timeZone: 'Europe/Paris', devices: [], ...over,
});

const fakeSub = (endpoint = 'https://fcm.googleapis.com/fcm/send/x') => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
});

function setup(opts: { env?: BrowserEnv; settings?: TraderPushSettings | Error; sub?: ReturnType<typeof fakeSub> | null; deviceKnown?: boolean } = {}) {
  let currentEnv = opts.env ?? env();
  const browser: PushBrowser = {
    env: () => currentEnv,
    currentSubscription: vi.fn(async () => (opts.sub ?? null) as unknown as PushSubscription | null),
    subscribe: vi.fn(async () => fakeSub() as unknown as PushSubscription),
  };
  const api = {
    settings: vi.fn(async () => { if (opts.settings instanceof Error) throw opts.settings; return opts.settings ?? settings(); }),
    device: vi.fn(async () => ({ subscribed: opts.deviceKnown ?? true, id: opts.deviceKnown === false ? null : 'd1' })),
    subscribe: vi.fn(async () => ({ subscribed: true, id: 'd-new' })),
    removeDevice: vi.fn(async () => ({ removed: true })),
    preferences: vi.fn(async (input: { mutedTypes?: string[] }) => settings({ mutedTypes: (input.mutedTypes ?? ['RECAP']) as TraderPushSettings['mutedTypes'] })),
    test: vi.fn(async () => ({ subscriptions: 1, delivered: 1, failed: 0, removed: 0 })),
  };
  const currentUser = signal<{ id: string } | null>({ id: 'A' });
  TestBed.configureTestingModule({
    providers: [
      { provide: PUSH_BROWSER, useValue: browser },
      { provide: PushApi, useValue: api },
      { provide: AuthService, useValue: { currentUser } },
    ],
  });
  return {
    service: TestBed.inject(PushService), browser, api, currentUser,
    setEnv: (e: BrowserEnv) => { currentEnv = e; },
    /** `AuthService.logout` : purge des stores du compte. */
    logout: () => { TestBed.inject(UserScopedReset).resetAll(); currentUser.set(null); },
  };
}

afterEach(() => TestBed.resetTestingModule());

describe('browserState', () => {
  it.each([
    ['navigateur intégré (Instagram)', env({ userAgent: INSTAGRAM }), 'in-app-browser'],
    ['iPhone hors écran d’accueil', env({ userAgent: IPHONE_SAFARI }), 'ios-not-installed'],
    ['iPhone installé', env({ userAgent: IPHONE_SAFARI, standalone: true }), 'supported'],
    ['iPad (se présente comme un Mac tactile)', env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }), 'ios-not-installed'],
    ['sans PushManager', env({ hasPushManager: false }), 'unsupported'],
    ['sans service worker', env({ hasServiceWorker: false }), 'unsupported'],
    ['sans API Notification', env({ notificationPermission: null }), 'unsupported'],
    ['permission refusée', env({ notificationPermission: 'denied' }), 'denied'],
    ['Chrome Android', env(), 'supported'],
  ])('%s → %s', (_, e, state) => {
    expect(browserState(e)).toBe(state);
  });
});

describe('PushService.init', () => {
  it('push coupé côté serveur : server-disabled, aucune lecture de l’appareil', async () => {
    const { service, browser } = setup({ settings: settings({ enabled: false, publicKey: null }) });
    await service.init();
    expect(service.state()).toBe('server-disabled');
    expect(browser.currentSubscription).not.toHaveBeenCalled();
  });

  it('réglages illisibles : section masquée (server-disabled), sans erreur affichée', async () => {
    const { service } = setup({ settings: new Error('500') });
    await service.init();
    expect(service.state()).toBe('server-disabled');
    expect(service.error()).toBeNull();
  });

  it('jamais de demande de permission au chargement', async () => {
    const { service, browser } = setup();
    await service.init();
    expect(service.state()).toBe('supported');
    expect(browser.subscribe).not.toHaveBeenCalled();
  });

  it.each([
    [env({ userAgent: INSTAGRAM }), 'in-app-browser'],
    [env({ userAgent: IPHONE_SAFARI }), 'ios-not-installed'],
    [env({ hasPushManager: false }), 'unsupported'],
    [env({ notificationPermission: 'denied' }), 'denied'],
  ] as const)('état du navigateur repris tel quel : %#', async (e, state) => {
    const { service } = setup({ env: e });
    await service.init();
    expect(service.state()).toBe(state);
  });

  it('appareil déjà abonné et connu du serveur : subscribed, appareil courant repéré', async () => {
    const { service, api } = setup({ sub: fakeSub() });
    await service.init();
    expect(service.state()).toBe('subscribed');
    expect(service.currentDeviceId()).toBe('d1');
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('abonnement du navigateur inconnu du serveur : resynchronisé', async () => {
    const { service, api } = setup({ sub: fakeSub(), deviceKnown: false });
    await service.init();
    expect(api.subscribe).toHaveBeenCalledOnce();
    expect(service.state()).toBe('subscribed');
    expect(service.currentDeviceId()).toBe('d-new');
  });

  it('compte démo (lecture seule) : réglages lus, appareil jamais consulté', async () => {
    const { service, api, browser } = setup({ sub: fakeSub() });
    await service.init({ readOnly: true });
    expect(service.settings()).not.toBeNull();
    expect(api.device).not.toHaveBeenCalled();
    expect(browser.currentSubscription).not.toHaveBeenCalled();
  });
});

describe('PushService.enable', () => {
  it('au clic : permission puis abonnement, appareil courant enregistré', async () => {
    const { service, browser, api } = setup();
    await service.init();
    await service.enable();
    expect(browser.subscribe).toHaveBeenCalledWith('BPub');
    expect(api.subscribe).toHaveBeenCalledOnce();
    expect(service.state()).toBe('subscribed');
    expect(service.currentDeviceId()).toBe('d-new');
  });

  it('permission refusée dans la fenêtre du navigateur : état denied', async () => {
    const { service, browser, setEnv } = setup();
    await service.init();
    vi.mocked(browser.subscribe).mockImplementationOnce(async () => {
      setEnv(env({ notificationPermission: 'denied' }));
      throw new Error('NotAllowedError');
    });
    await service.enable();
    expect(service.state()).toBe('denied');
  });

  it('demande de permission fermée sans réponse : message neutre, pas d’échec annoncé (m3)', async () => {
    const { service, browser } = setup();
    await service.init();
    vi.mocked(browser.subscribe).mockRejectedValueOnce(new Error('NotAllowedError'));
    await service.enable();
    expect(service.state()).toBe('supported');
    expect(service.error()).toBe('Autorise les notifications quand ton navigateur te le demande.');
  });

  it('autre échec : message, état inchangé', async () => {
    const { service, browser, setEnv } = setup();
    await service.init();
    setEnv(env({ notificationPermission: 'granted' }));
    vi.mocked(browser.subscribe).mockRejectedValueOnce(new Error('réseau'));
    await service.enable();
    expect(service.state()).toBe('supported');
    expect(service.error()).toContain('Réessaie');
  });
});

describe('PushService réglages et appareils', () => {
  it('interrupteur : envoi immédiat, état du serveur réaffiché si l’API refuse', async () => {
    const { service, api } = setup({ sub: fakeSub() });
    await service.init();
    expect(service.isTypeEnabled('RECAP')).toBe(false);
    expect(await service.setTypeEnabled('RECAP', true)).toBe('saved');
    expect(api.preferences).toHaveBeenLastCalledWith({ mutedTypes: [] }, expect.anything());
    expect(service.isTypeEnabled('RECAP')).toBe(true);

    api.preferences.mockRejectedValueOnce(new Error('500'));
    expect(await service.setTypeEnabled('BEHAVIOR', false)).toBe('failed');
    expect(service.isTypeEnabled('BEHAVIOR')).toBe(true);
  });

  it('heures silencieuses : null les désactive', async () => {
    const { service, api } = setup({ sub: fakeSub() });
    await service.init();
    await service.setQuietHours({ start: 1320, end: 420 });
    expect(api.preferences).toHaveBeenLastCalledWith({ quietHours: { start: 1320, end: 420 } }, expect.anything());
    await service.setQuietHours(null);
    expect(api.preferences).toHaveBeenLastCalledWith({ quietHours: null }, expect.anything());
  });

  it('retirer CET appareil : désabonné aussi côté navigateur, retour à supported', async () => {
    const sub = fakeSub();
    const { service, api } = setup({ sub });
    await service.init();
    expect(await service.removeDevice('d1')).toBe(true);
    expect(api.removeDevice).toHaveBeenCalledWith('d1', expect.anything());
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
    expect(service.state()).toBe('supported');
  });

  it('retirer un AUTRE appareil : cet appareil reste abonné', async () => {
    const sub = fakeSub();
    const { service } = setup({ sub });
    await service.init();
    await service.removeDevice('d-autre');
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(service.state()).toBe('subscribed');
  });

  it('10 appareils et celui-ci non abonné : limite atteinte', async () => {
    const devices = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, label: 'Chrome · Windows', createdAt: '2026-10-01T00:00:00.000Z', lastSuccessAt: null }));
    const { service } = setup({ settings: settings({ devices }) });
    await service.init();
    expect(service.deviceLimitReached()).toBe(true);
  });
});

/** Promesse résolue à la main, pour tenir une réponse de l'API en attente. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('PushService : un compte puis un autre dans le même onglet (revue phase 2 I2)', () => {
  const devicesOfA = [{ id: 'd1', label: 'Chrome · Android', createdAt: '2026-10-01T00:00:00.000Z', lastSuccessAt: null }];

  it('A se déconnecte, B se connecte : pendant le chargement B ne voit rien de A et aucune écriture ne part', async () => {
    const { service, api, currentUser, logout } = setup({ sub: fakeSub(), settings: settings({ devices: devicesOfA }) });
    await service.init();
    expect(service.state()).toBe('subscribed');

    logout();
    expect(service.state()).toBeNull();
    expect(service.settings()).toBeNull();
    expect(service.currentDeviceId()).toBeNull();

    currentUser.set({ id: 'B' });
    const slow = deferred<TraderPushSettings>();
    api.settings.mockImplementation(() => slow.promise);
    const loading = service.init();
    // Réglages de B pas encore reçus : rien de A, et les commandes ne partent pas.
    expect(service.state()).toBeNull();
    expect(service.settings()).toBeNull();
    expect(service.currentDeviceId()).toBeNull();
    api.preferences.mockClear();
    expect(await service.setTypeEnabled('RECAP', true)).toBe('skipped');
    expect(await service.setQuietHours({ start: 1320, end: 420 })).toBe('skipped');
    expect(await service.removeDevice('d1')).toBe(false);
    expect(api.preferences).not.toHaveBeenCalled();
    expect(api.removeDevice).not.toHaveBeenCalled();

    slow.resolve(settings({ mutedTypes: [], devices: [] }));
    await loading;
    expect(service.settings()?.devices).toEqual([]);
  });

  it('réponse arrivée pour A après le changement de compte : ignorée, requête annulée', async () => {
    const { service, api, currentUser, logout } = setup({ sub: fakeSub() });
    const slow = deferred<TraderPushSettings>();
    let signalOfA: AbortSignal | undefined;
    api.settings.mockImplementationOnce((s?: AbortSignal) => { signalOfA = s; return slow.promise; });
    const loadingA = service.init();

    logout();
    expect(signalOfA?.aborted).toBe(true);
    currentUser.set({ id: 'B' });
    slow.resolve(settings({ devices: devicesOfA }));
    await loadingA;
    expect(service.state()).toBeNull();
    expect(service.settings()).toBeNull();
    expect(api.device).not.toHaveBeenCalled();
  });

  it('autre compte sans déconnexion (connexion par-dessus la session) : même remise à zéro', async () => {
    const { service, currentUser } = setup({ sub: fakeSub(), settings: settings({ devices: devicesOfA }) });
    await service.init();
    currentUser.set({ id: 'B' });
    TestBed.tick();
    expect(service.state()).toBeNull();
    expect(service.settings()).toBeNull();
    expect(service.currentDeviceId()).toBeNull();
  });

  it('écriture partie pour A, réponse reçue après le passage à B : jamais affichée chez B', async () => {
    const { service, api, currentUser, logout } = setup({ sub: fakeSub() });
    await service.init();
    const slow = deferred<TraderPushSettings>();
    api.preferences.mockImplementationOnce(() => slow.promise);
    const saving = service.setTypeEnabled('RECAP', true);
    logout();
    currentUser.set({ id: 'B' });
    slow.resolve(settings({ mutedTypes: [] }));
    await saving;
    expect(service.settings()).toBeNull();
  });
});

describe('PushService : deux interrupteurs rapprochés (revue phase 2 I1)', () => {
  /** Serveur simulé : garde les réglages, applique chaque PATCH reçu, échoue à la demande. */
  function server(initial: TraderPushSettings) {
    let saved = initial;
    return {
      get saved() { return saved; },
      apply: (input: Partial<TraderPushSettings>) => (saved = { ...saved, ...input }),
    };
  }

  it('la 1re écriture échoue après le clic sur la 2e : écran = serveur, une seule erreur, 2e jamais partie', async () => {
    const srv = server(settings({ mutedTypes: ['RECAP'] }));
    const { service, api } = setup({ sub: fakeSub(), settings: srv.saved });
    api.settings.mockImplementation(async () => srv.saved);
    await service.init();
    const first = deferred<TraderPushSettings>();
    api.preferences.mockImplementationOnce(() => first.promise);

    // Récap activé puis Comportement coupé, 100 ms d'écart : la 1re requête est encore en vol.
    const a = service.setTypeEnabled('RECAP', true);
    const b = service.setTypeEnabled('BEHAVIOR', false);
    expect(service.isTypeEnabled('RECAP')).toBe(true);
    expect(service.isTypeEnabled('BEHAVIOR')).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.preferences).toHaveBeenCalledTimes(1);

    first.reject(new Error('500'));
    expect([await a, await b]).toEqual(['failed', 'skipped']);
    expect(api.preferences).toHaveBeenCalledTimes(1);
    // L'écran montre ce que le serveur a enregistré, sur les deux lignes.
    expect(service.settings()?.mutedTypes).toEqual(srv.saved.mutedTypes);
    expect(service.isTypeEnabled('RECAP')).toBe(false);
    expect(service.isTypeEnabled('BEHAVIOR')).toBe(true);
  });

  it('réponse perdue alors que le serveur a enregistré : l’écran relit le serveur, pas l’état d’avant', async () => {
    const srv = server(settings({ mutedTypes: ['RECAP'] }));
    const { service, api } = setup({ sub: fakeSub(), settings: srv.saved });
    api.settings.mockImplementation(async () => srv.saved);
    api.preferences.mockImplementationOnce(async (input) => {
      srv.apply(input as Partial<TraderPushSettings>);
      throw new Error('délai dépassé');
    });
    await service.init();
    expect(await service.setTypeEnabled('RECAP', true)).toBe('failed');
    expect(srv.saved.mutedTypes).toEqual([]);
    expect(service.isTypeEnabled('RECAP')).toBe(true);
  });

  it('écritures en file : la 2e part de ce que le serveur a enregistré à la 1re', async () => {
    const srv = server(settings({ mutedTypes: ['RECAP'] }));
    const { service, api } = setup({ sub: fakeSub(), settings: srv.saved });
    api.preferences.mockImplementation(async (input) => srv.apply(input as Partial<TraderPushSettings>));
    await service.init();
    const [a, b] = await Promise.all([service.setTypeEnabled('RECAP', true), service.setTypeEnabled('BEHAVIOR', false)]);
    expect([a, b]).toEqual(['saved', 'saved']);
    expect(api.preferences.mock.calls.map((c) => c[0])).toEqual([{ mutedTypes: [] }, { mutedTypes: ['BEHAVIOR'] }]);
    expect(srv.saved.mutedTypes).toEqual(['BEHAVIOR']);
    expect(service.settings()?.mutedTypes).toEqual(['BEHAVIOR']);
  });

  it('la 2e écriture échoue : la 1re reste, état relu sur le serveur', async () => {
    const srv = server(settings({ mutedTypes: ['RECAP'] }));
    const { service, api } = setup({ sub: fakeSub(), settings: srv.saved });
    api.settings.mockImplementation(async () => srv.saved);
    api.preferences
      .mockImplementationOnce(async (input) => srv.apply(input as Partial<TraderPushSettings>))
      .mockRejectedValueOnce(new Error('réseau'));
    await service.init();
    const results = await Promise.all([service.setTypeEnabled('RECAP', true), service.setTypeEnabled('BEHAVIOR', false)]);
    expect(results).toEqual(['saved', 'failed']);
    expect(service.settings()?.mutedTypes).toEqual([]);
  });
});
