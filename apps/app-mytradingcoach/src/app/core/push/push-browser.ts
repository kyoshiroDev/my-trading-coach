import { InjectionToken } from '@angular/core';

/**
 * Accès du navigateur au Web Push (#666), remplaçable dans les tests. Le service worker de l'app
 * (`public/push-sw.js`) ne fait QUE le push : aucun gestionnaire fetch, aucun cache.
 */

export const PUSH_SW_URL = '/push-sw.js';

/** Ce que le navigateur permet, lu à la demande. Repris de l'admin. */
export interface BrowserEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Ouverte depuis l'écran d'accueil (PWA installée). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** `null` si l'API Notification n'existe pas. */
  notificationPermission: NotificationPermission | null;
  /**
   * La page déclare un manifest (`<link rel="manifest">`). Sans lui, aucun push sur iPhone n'a été
   * vérifié, même ouverte depuis l'écran d'accueil (#715, revue phase 2 F4).
   */
  hasManifest: boolean;
}

export interface PushBrowser {
  env(): BrowserEnv;
  /** Abonnement en place sur cet appareil, sans rien enregistrer ni demander. */
  currentSubscription(): Promise<PushSubscription | null>;
  /** Enregistre le service worker puis abonne : c'est ici que le navigateur demande la permission. */
  subscribe(publicKey: string): Promise<PushSubscription>;
}

/** Clé VAPID (base64url) au format attendu par `PushManager.subscribe`. */
export function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration('/')) ?? null;
}

export const PUSH_BROWSER = new InjectionToken<PushBrowser>('PUSH_BROWSER', {
  providedIn: 'root',
  factory: () => ({
    env: () => ({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      standalone:
        window.matchMedia?.('(display-mode: standalone)').matches === true ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      hasServiceWorker: 'serviceWorker' in navigator,
      hasPushManager: 'PushManager' in window,
      notificationPermission: 'Notification' in window ? Notification.permission : null,
      hasManifest: document.querySelector('link[rel="manifest"]') !== null,
    }),
    currentSubscription: async () => (await registration())?.pushManager?.getSubscription() ?? null,
    subscribe: async (publicKey) => {
      // `updateViaCache: 'none'` : le navigateur revérifie toujours push-sw.js sur le réseau.
      await navigator.serviceWorker.register(PUSH_SW_URL, { scope: '/', updateViaCache: 'none' });
      const reg = await navigator.serviceWorker.ready;
      return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(publicKey) });
    },
  }),
});
