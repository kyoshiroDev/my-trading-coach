import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { InstallCapture } from './install-capture';
import {
  InstallPromptService,
  LATER_DAYS,
  OPEN_DELAY_MS,
  PUSH_INVITE_DELAY_MS,
  frequencyAllows,
  installState,
} from './install-prompt.service';
import { UA, configureInstall, env, memoryStorage, promptEvent, type InstallSetup } from './install-test.helpers';

/**
 * Parcours d'installation (maquette mockup-installation-pwa.html) : un cas par appareil, règles
 * de fréquence, déclencheurs par plan, compte démo. Chaque règle a sa contre-épreuve (le test
 * échoue si la règle est retirée du service, vérifié à la main lors de la PR).
 */

const DAY = 24 * 3600 * 1000;

async function setup(opts: InstallSetup & { url?: string; prompt?: boolean } = {}) {
  const ctx = configureInstall(opts);
  const capture = TestBed.inject(InstallCapture);
  if (opts.prompt) window.dispatchEvent(promptEvent());
  await TestBed.inject(Router).navigateByUrl(opts.url ?? '/dashboard');
  const service = TestBed.inject(InstallPromptService);
  await Promise.resolve(); // premier passage de onNavigate (microtâche du constructeur)
  return { ...ctx, capture, service, router: TestBed.inject(Router) };
}

/** Propose puis laisse passer le délai d'ouverture (la modale déclencheuse se ferme d'abord). */
function offerAndWait(service: InstallPromptService, trigger: 'import' | 'plan-linked' = 'import') {
  service.offer(trigger);
  vi.advanceTimersByTime(OPEN_DELAY_MS);
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date('2026-10-25T20:00:00Z') }));
afterEach(() => {
  vi.useRealTimers();
  TestBed.resetTestingModule();
});

describe('installState : un état par appareil', () => {
  it.each([
    ['Android avec invite du navigateur', env(), true, 'can-prompt'],
    ['Android sans invite', env(), false, 'android-manual'],
    ['iPhone Safari', env({ userAgent: UA.iphoneSafari }), false, 'ios-manual'],
    ['iPhone Chrome (CriOS)', env({ userAgent: UA.iphoneChrome }), false, 'ios-other'],
    ['iPhone Firefox (FxiOS)', env({ userAgent: UA.iphoneFirefox }), false, 'ios-other'],
    ['navigateur intégré Instagram', env({ userAgent: UA.instagram }), false, 'in-app-browser'],
    ['navigateur intégré, même avec une invite', env({ userAgent: `${UA.chromeAndroid} Instagram 350` }), true, 'in-app-browser'],
    ['ouverte depuis l’écran d’accueil', env({ userAgent: UA.iphoneSafari, standalone: true }), false, 'installed'],
    ['ordinateur Chrome avec invite', env({ userAgent: UA.desktopChrome, maxTouchPoints: 0 }), true, 'can-prompt'],
    ['ordinateur Firefox', env({ userAgent: UA.desktopFirefox, maxTouchPoints: 0 }), false, 'unsupported'],
  ] as const)('%s → %s', (_n, e, canPrompt, expected) => {
    expect(installState(e, canPrompt, false)).toBe(expected);
  });

  it('installation confirmée dans l’onglet → installed', () => {
    expect(installState(env(), true, true)).toBe('installed');
  });
});

describe('frequencyAllows', () => {
  const now = Date.now();
  it.each([
    ['jamais proposé', { never: false, laterUntil: null, shownThisSession: false }, true],
    ['déjà proposé dans cette session', { never: false, laterUntil: null, shownThisSession: true }, false],
    ['« Plus tard » il y a 6 jours', { never: false, laterUntil: now + DAY, shownThisSession: false }, false],
    ['« Plus tard » échu', { never: false, laterUntil: now - 1, shownThisSession: false }, true],
    ['« Ne plus me proposer »', { never: true, laterUntil: null, shownThisSession: false }, false],
  ] as const)('%s → %s', (_n, s, expected) => {
    expect(frequencyAllows(s, now)).toBe(expected);
  });
});

describe('InstallPromptService : un cas par appareil', () => {
  it('Android avec invite : feuille principale, « Installer » ouvre l’invite, événements sur android', async () => {
    const { service, events } = await setup({ prompt: true });
    offerAndWait(service);
    expect(service.sheet()).toBe('install');
    expect(service.state()).toBe('can-prompt');
    expect(events.track).toHaveBeenCalledWith('install_shown', 'android');
  });

  it('iPhone Safari : parcours manuel, « Je l’ai fait » hors mode app → report, pas de fermeture silencieuse', async () => {
    const { service, events, store } = await setup({ env: env({ userAgent: UA.iphoneSafari }) });
    offerAndWait(service);
    expect(service.state()).toBe('ios-manual');
    expect(events.track).toHaveBeenCalledWith('install_shown', 'ios');
    expect(service.iosDone()).toBe(false);
    expect(events.track).toHaveBeenCalledWith('install_click', 'ios');
    expect(store.storage.laterUntil('install')).toBe(Date.now() + LATER_DAYS * DAY);
    expect(service.sheet()).toBe('install'); // la feuille dit d'ouvrir l'icône
  });

  it('navigateur intégré : message seul, compté inapp_seen (pas install_shown)', async () => {
    const { service, events } = await setup({ env: env({ userAgent: UA.instagram }) });
    offerAndWait(service);
    expect(service.state()).toBe('in-app-browser');
    expect(events.track).toHaveBeenCalledExactlyOnceWith('inapp_seen', 'ios');
  });

  it('iPhone Chrome (CriOS) : ouvrir Safari, plateforme ios-other', async () => {
    const { service, events } = await setup({ env: env({ userAgent: UA.iphoneChrome }) });
    offerAndWait(service);
    expect(service.state()).toBe('ios-other');
    expect(events.track).toHaveBeenCalledExactlyOnceWith('install_shown', 'ios-other');
  });

  it('déjà ouverte depuis l’écran d’accueil : aucun parcours', async () => {
    const { service, events } = await setup({ env: env({ userAgent: UA.iphoneSafari, standalone: true }) });
    offerAndWait(service);
    expect(service.sheet()).not.toBe('install');
    expect(events.track).not.toHaveBeenCalledWith('install_shown', expect.anything());
  });

  it('ordinateur : jamais de lui-même, seulement depuis le Profil', async () => {
    const { service } = await setup({ env: env({ userAgent: UA.desktopChrome, maxTouchPoints: 0 }), prompt: true });
    offerAndWait(service);
    expect(service.sheet()).toBeNull();
    service.openFromSettings();
    expect(service.sheet()).toBe('install');
  });

  it('compte démo : parcours visible, aucun événement envoyé', async () => {
    const { service, events } = await setup({ demo: true, prompt: true });
    offerAndWait(service);
    expect(service.sheet()).toBe('install');
    service.later();
    expect(events.track).not.toHaveBeenCalled();
  });
});

describe('InstallPromptService : déclencheurs', () => {
  it('Gratuit : après un import ; pas après la liaison d’un plan', async () => {
    const free = await setup();
    offerAndWait(free.service, 'plan-linked');
    expect(free.service.sheet()).toBeNull();
    offerAndWait(free.service, 'import');
    expect(free.service.sheet()).toBe('install');
  });

  it('Premium : après la liaison d’un plan ; pas après un import', async () => {
    const prem = await setup({ premium: true });
    offerAndWait(prem.service, 'import');
    expect(prem.service.sheet()).toBeNull();
    offerAndWait(prem.service, 'plan-linked');
    expect(prem.service.sheet()).toBe('install');
  });

  it('jamais dès l’arrivée : rien sans déclencheur', async () => {
    const { service } = await setup();
    vi.advanceTimersByTime(60_000);
    expect(service.sheet()).toBeNull();
  });

  it('déconnecté : rien', async () => {
    const { service } = await setup({ loggedIn: false });
    offerAndWait(service);
    expect(service.sheet()).toBeNull();
  });

  it('pendant l’onboarding : attend la première page hors onboarding', async () => {
    const { service, router } = await setup({ url: '/onboarding' });
    offerAndWait(service);
    expect(service.sheet()).toBeNull();
    await router.navigateByUrl('/dashboard');
    vi.advanceTimersByTime(OPEN_DELAY_MS);
    expect(service.sheet()).toBe('install');
  });
});

describe('InstallPromptService : fréquence', () => {
  it('une fois par session au plus', async () => {
    const { service } = await setup();
    offerAndWait(service);
    service.close();
    offerAndWait(service);
    expect(service.sheet()).toBeNull();
  });

  it('« Plus tard » : rien pendant 7 jours, de nouveau ensuite', async () => {
    const store = memoryStorage();
    const { service, events } = await setup({ store });
    offerAndWait(service);
    service.later();
    expect(events.track).toHaveBeenCalledWith('install_later', 'android');

    store.newSession();
    vi.setSystemTime(Date.now() + (LATER_DAYS * DAY - 60_000));
    offerAndWait(service);
    expect(service.sheet()).toBeNull();

    vi.setSystemTime(Date.now() + 120_000);
    offerAndWait(service);
    expect(service.sheet()).toBe('install');
  });

  it('« Ne plus me proposer » : définitif, mais la ligne du Profil rouvre le parcours', async () => {
    const store = memoryStorage();
    const { service, events } = await setup({ store });
    offerAndWait(service);
    service.never();
    expect(events.track).toHaveBeenCalledWith('install_never', 'android');

    store.newSession();
    vi.setSystemTime(Date.now() + 365 * DAY);
    offerAndWait(service);
    expect(service.sheet()).toBeNull();

    service.openFromSettings();
    expect(service.sheet()).toBe('install');
    expect(service.fromSettings()).toBe(true);
  });

  it('ouverte depuis le Profil puis « Plus tard » : aucun report enregistré', async () => {
    const store = memoryStorage();
    const { service } = await setup({ store });
    service.openFromSettings();
    service.later();
    expect(store.storage.laterUntil('install')).toBeNull();
  });
});

describe('InstallPromptService : lancement depuis l’écran d’accueil', () => {
  it('install_done une fois par appareil, puis invitation aux alertes après un délai, une fois par session', async () => {
    const store = memoryStorage();
    const { service, events, router } = await setup({ env: env({ userAgent: UA.iphoneSafari, standalone: true }), store });
    expect(events.track).toHaveBeenCalledExactlyOnceWith('install_done', 'ios');
    expect(service.sheet()).toBeNull(); // jamais au premier affichage
    vi.advanceTimersByTime(PUSH_INVITE_DELAY_MS);
    expect(service.sheet()).toBe('push');

    service.close();
    await router.navigateByUrl('/journal');
    vi.advanceTimersByTime(PUSH_INVITE_DELAY_MS);
    expect(service.sheet()).toBeNull();
    expect(events.track.mock.calls.filter(([e]) => e === 'install_done')).toHaveLength(1);
  });

  it('« Pas maintenant » : invitation repoussée de 7 jours', async () => {
    const store = memoryStorage();
    const { service } = await setup({ env: env({ standalone: true }), store });
    vi.advanceTimersByTime(PUSH_INVITE_DELAY_MS);
    service.later();
    expect(store.storage.laterUntil('push')).toBe(Date.now() + LATER_DAYS * DAY);
  });

  it('alertes déjà actives : plus jamais vérifiées sur cet appareil', async () => {
    const store = memoryStorage();
    const { service } = await setup({ env: env({ standalone: true }), store });
    vi.advanceTimersByTime(PUSH_INVITE_DELAY_MS);
    service.pushNotNeeded(true);
    expect(service.sheet()).toBeNull();
    expect(store.storage.isNever('push')).toBe(true);
  });
});
