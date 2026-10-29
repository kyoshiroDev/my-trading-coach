import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi, type Mock } from 'vitest';
import type { WritableSignal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { UserStore } from '../stores/user.store';
import { PUSH_BROWSER, type BrowserEnv } from '../push/push-browser';
import { ProductEventsService } from '../services/product-events.service';
import { INSTALL_STORAGE, type InstallStorage } from './install-storage';

/** Outils partagés des specs de l'installation (pas un spec : aucun test ici). */

export const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0.0',
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

export const env = (over: Partial<BrowserEnv> = {}): BrowserEnv => ({
  userAgent: UA.chromeAndroid, maxTouchPoints: 5, standalone: false, hasServiceWorker: true, hasPushManager: true,
  notificationPermission: 'default', hasManifest: true, ...over,
});

/** Stockage en mémoire : `local` survit d'une « session » à l'autre, `session` non. */
export function memoryStorage() {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const storage: InstallStorage = {
    laterUntil: (s) => (local.has(`${s}:later`) ? Number(local.get(`${s}:later`)) : null),
    setLaterUntil: (s, at) => void local.set(`${s}:later`, String(at)),
    isNever: (s) => local.get(`${s}:never`) === '1',
    setNever: (s) => void local.set(`${s}:never`, '1'),
    shownThisSession: (s) => session.get(`${s}:shown`) === '1',
    markSession: (s) => void session.set(`${s}:shown`, '1'),
    isDone: () => local.get('done') === '1',
    setDone: () => void local.set('done', '1'),
  };
  return { storage, local, session, newSession: () => session.clear() };
}

export interface InstallSetup {
  env?: BrowserEnv;
  premium?: boolean;
  demo?: boolean;
  loggedIn?: boolean;
  store?: ReturnType<typeof memoryStorage>;
}

export interface InstallTestContext {
  events: { track: Mock; once: Mock; place: () => string };
  store: ReturnType<typeof memoryStorage>;
  currentUser: WritableSignal<{ id: string; plan: string; email: string; isDemo: boolean } | null>;
  isPremium: WritableSignal<boolean>;
  setEnv: (e: BrowserEnv) => void;
}

export function configureInstall(opts: InstallSetup = {}): InstallTestContext {
  let currentEnv = opts.env ?? env();
  const store = opts.store ?? memoryStorage();
  const events = { track: vi.fn(), once: vi.fn(), place: () => 'dashboard' };
  const currentUser: InstallTestContext['currentUser'] = signal(
    opts.loggedIn === false ? null : { id: 'u1', plan: 'FREE', email: 'x@y', isDemo: !!opts.demo },
  );
  const isPremium = signal(!!opts.premium);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'onboarding', children: [] },
        { path: 'dashboard', children: [] },
        { path: 'journal', children: [] },
        { path: 'profil', children: [] },
      ]),
      { provide: PUSH_BROWSER, useValue: { env: () => currentEnv, currentSubscription: vi.fn(), subscribe: vi.fn() } },
      { provide: INSTALL_STORAGE, useValue: store.storage },
      { provide: ProductEventsService, useValue: events },
      { provide: AuthService, useValue: { currentUser } },
      { provide: UserStore, useValue: { isPremium, isDemo: () => !!opts.demo, user: currentUser } },
    ],
  });
  return { events, store, currentUser, isPremium, setEnv: (e: BrowserEnv) => { currentEnv = e; } };
}

/** Événement `beforeinstallprompt` simulé : `prompt()` espionné, choix de l'utilisateur donné. */
export function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): Event & { prompt: Mock; userChoice: Promise<{ outcome: string }> } {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome }),
  });
}
