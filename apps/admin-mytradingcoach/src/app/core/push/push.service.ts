import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom, take } from 'rxjs';
import type { AdminPushEvent, AdminPushSubscriptionInput } from '@mtc/shared';
import { PushApi } from '../api/push.api';

/** Ce que le navigateur permet (lu à la demande ; remplaçable dans les tests). Repris de xmr-trader. */
export interface BrowserEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** Ouverte depuis l'écran d'accueil (PWA installée). */
  standalone: boolean;
  hasPushManager: boolean;
  /** `null` si l'API Notification n'existe pas. */
  notificationPermission: NotificationPermission | null;
}

export const BROWSER_ENV = new InjectionToken<() => BrowserEnv>('BROWSER_ENV', {
  providedIn: 'root',
  factory: () => () => ({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasPushManager: 'PushManager' in window,
    notificationPermission: 'Notification' in window ? Notification.permission : null,
  }),
});

/** Pourquoi le push est (ou n'est pas) disponible sur cet appareil. */
export type PushSupport = 'supported' | 'ios-not-installed' | 'unsupported' | 'denied' | 'server-disabled';

export function isIos(env: BrowserEnv): boolean {
  return (
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    // iPadOS se présente comme un Mac tactile
    (env.userAgent.includes('Macintosh') && env.maxTouchPoints > 1)
  );
}

/** Diagnostic côté navigateur (sans l'avis du serveur). */
export function browserSupport(env: BrowserEnv, swEnabled: boolean): PushSupport {
  // Sur iPhone, le Web Push n'existe que pour l'app installée sur l'écran d'accueil (iOS ≥ 16.4).
  if (isIos(env) && !env.standalone) return 'ios-not-installed';
  if (!swEnabled || !env.hasPushManager || env.notificationPermission === null) return 'unsupported';
  if (env.notificationPermission === 'denied') return 'denied';
  return 'supported';
}

/** Abonnement Web Push de CET appareil (service worker Angular) et ses préférences par événement. */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly swPush = inject(SwPush);
  private readonly api = inject(PushApi);
  private readonly env = inject(BROWSER_ENV);

  readonly support = signal<PushSupport | null>(null);
  readonly subscribed = signal(false);
  readonly mutedEvents = signal<AdminPushEvent[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private publicKey: string | null = null;
  private endpoint: string | null = null;

  async init(): Promise<void> {
    const local = browserSupport(this.env(), this.swPush.isEnabled);
    if (local !== 'supported') {
      this.support.set(local);
      return;
    }
    try {
      const key = await this.api.publicKey();
      if (!key.enabled || !key.publicKey) {
        this.support.set('server-disabled');
        return;
      }
      this.publicKey = key.publicKey;
      this.support.set('supported');
      const current = await firstValueFrom(this.swPush.subscription.pipe(take(1)));
      if (!current) {
        this.subscribed.set(false);
        return;
      }
      // Resynchronise le serveur (l'abonnement a pu être supprimé après un 410, ou la base vidée).
      this.endpoint = current.endpoint;
      const device = await this.api.subscribe(current.toJSON() as AdminPushSubscriptionInput);
      this.subscribed.set(true);
      this.mutedEvents.set(device.mutedEvents);
    } catch {
      this.error.set('Impossible de vérifier les notifications push.');
    }
  }

  async enable(): Promise<void> {
    if (!this.publicKey || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      // Demande la permission puis crée l'abonnement auprès du service push du navigateur.
      const sub = await this.swPush.requestSubscription({ serverPublicKey: this.publicKey });
      this.endpoint = sub.endpoint;
      const device = await this.api.subscribe(sub.toJSON() as AdminPushSubscriptionInput);
      this.subscribed.set(true);
      this.mutedEvents.set(device.mutedEvents);
    } catch {
      const denied = this.env().notificationPermission === 'denied';
      if (denied) this.support.set('denied');
      this.error.set(
        denied
          ? 'Notifications refusées : autorise-les dans les réglages du navigateur.'
          : "L'activation des notifications a échoué. Réessaie.",
      );
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const sub = await firstValueFrom(this.swPush.subscription.pipe(take(1)));
      if (sub) await this.api.unsubscribe(sub.endpoint);
      await this.swPush.unsubscribe().catch(() => undefined);
      this.subscribed.set(false);
      this.endpoint = null;
    } catch {
      this.error.set('La désactivation a échoué. Réessaie.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Coche / décoche un événement pour cet appareil (retour arrière si l'API refuse). */
  async setEventEnabled(event: AdminPushEvent, enabled: boolean): Promise<void> {
    if (!this.endpoint) return;
    const previous = this.mutedEvents();
    const next = enabled ? previous.filter((e) => e !== event) : [...new Set([...previous, event])];
    this.mutedEvents.set(next);
    this.error.set(null);
    try {
      const device = await this.api.preferences(this.endpoint, next);
      this.mutedEvents.set(device.mutedEvents);
    } catch {
      this.mutedEvents.set(previous);
      this.error.set("La préférence n'a pas pu être enregistrée. Réessaie.");
    }
  }

  /** « Tester la notification » : message affiché sous le bouton. */
  async test(): Promise<string> {
    try {
      const r = await this.api.test();
      if (r.subscriptions === 0) return 'Aucun appareil abonné.';
      if (r.delivered === 0) return "La notification n'a pas pu être envoyée.";
      return `Notification envoyée à ${r.delivered} appareil${r.delivered > 1 ? 's' : ''}.`;
    } catch {
      return "La notification n'a pas pu être envoyée.";
    }
  }
}
