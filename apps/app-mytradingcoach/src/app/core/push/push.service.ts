import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  PUSH_MAX_DEVICES,
  type AdminPushSubscriptionInput,
  type PushAlertType,
  type PushQuietHours,
  type TraderPushSettings,
} from '@mtc/shared';
import { PushApi } from '../api/push.api';
import { AuthService } from '../auth/auth.service';
import { UserScopedReset } from '../auth/user-scoped-reset';
import { PUSH_BROWSER, type BrowserEnv } from './push-browser';

/**
 * Où en est le push sur CET appareil (#666). Ordre de diagnostic : serveur, navigateur intégré,
 * iPhone sans installation, navigateur sans push, permission refusée, puis abonné ou non.
 */
export type PushState =
  | 'server-disabled'
  | 'in-app-browser'
  | 'ios-not-installed'
  | 'unsupported'
  | 'denied'
  | 'supported'
  | 'subscribed';

/** Navigateurs intégrés aux applis (Instagram, Facebook, TikTok…) : pas de push fiable. */
const IN_APP_BROWSER = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|musical_ly|BytedanceWebview|LinkedInApp|Twitter/i;

export function isIos(env: BrowserEnv): boolean {
  return /iPhone|iPad|iPod/.test(env.userAgent) || (env.userAgent.includes('Macintosh') && env.maxTouchPoints > 1);
}

/** Diagnostic côté navigateur seul (sans l'avis du serveur ni l'abonnement). */
export function browserState(env: BrowserEnv): Exclude<PushState, 'server-disabled' | 'subscribed'> {
  if (IN_APP_BROWSER.test(env.userAgent)) return 'in-app-browser';
  // Sur iPhone, le Web Push n'existe que pour l'app ajoutée à l'écran d'accueil (iOS ≥ 16.4).
  if (isIos(env) && !env.standalone) return 'ios-not-installed';
  if (!env.hasServiceWorker || !env.hasPushManager || env.notificationPermission === null) return 'unsupported';
  if (env.notificationPermission === 'denied') return 'denied';
  return 'supported';
}

/**
 * État, abonnement et réglages push du trader (#666). Repris de l'admin, sur le service worker
 * maison (`push-sw.js`). La permission du navigateur n'est demandée QUE par `enable()`, appelé au
 * clic sur « Activer les notifications », jamais au chargement.
 *
 * Propre à un compte (revue phase 2 I2) : tout est vidé à la déconnexion et à tout changement
 * d'utilisateur, les requêtes en cours sont annulées, et une réponse arrivée pour le compte
 * précédent est ignorée. Tant que l'état du compte courant n'est pas chargé, `state` vaut `null` :
 * rien n'est affiché et aucune commande n'est possible.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(PushApi);
  private readonly browser = inject(PUSH_BROWSER);
  private readonly auth = inject(AuthService);

  /** Compte à qui appartient l'état affiché, et génération de cet état (changée à chaque remise à zéro). */
  private owner: string | null = null;
  private generation = 0;
  private abort = new AbortController();

  /** `null` tant que le diagnostic n'est pas fait. */
  readonly state = signal<PushState | null>(null);
  readonly settings = signal<TraderPushSettings | null>(null);
  readonly currentDeviceId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** Plus de place pour un nouvel appareil (10 appareils abonnés, aucun n'étant celui-ci). */
  readonly deviceLimitReached = computed(
    () => this.state() !== 'subscribed' && (this.settings()?.devices.length ?? 0) >= PUSH_MAX_DEVICES,
  );

  constructor() {
    inject(UserScopedReset).register(() => this.reset());
    // Autre compte sans passer par la déconnexion (connexion par-dessus une session) : même remise à zéro.
    effect(() => {
      const id = this.userId();
      untracked(() => {
        if (this.owner !== null && id !== this.owner) this.reset();
      });
    });
  }

  private userId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  /** Vide l'état, annule les requêtes en cours : plus rien du compte précédent n'est lu ni affiché. */
  private reset(): void {
    this.generation++;
    this.abort.abort();
    this.abort = new AbortController();
    this.owner = null;
    this.state.set(null);
    this.settings.set(null);
    this.currentDeviceId.set(null);
    this.busy.set(false);
    this.error.set(null);
  }

  /** Vrai tant que la génération lue au départ est toujours celle du compte courant. */
  private current(generation: number): boolean {
    return generation === this.generation && this.owner !== null && this.owner === this.userId();
  }

  /** Commande permise : état du compte courant chargé (jamais pendant un chargement ou après un changement de compte). */
  private loaded(generation: number): boolean {
    return this.current(generation) && this.state() !== null;
  }

  /** `readOnly` (compte démo) : réglages affichés, aucun abonnement ni lecture de l'appareil. */
  async init(opts: { readOnly?: boolean } = {}): Promise<void> {
    const uid = this.userId();
    if (this.owner !== uid) this.reset();
    this.owner = uid;
    const gen = this.generation;
    const signal = this.abort.signal;
    this.error.set(null);
    let settings: TraderPushSettings;
    try {
      settings = await this.api.settings(signal);
    } catch {
      // Section masquée plutôt qu'une erreur : le push n'est pas une fonction critique.
      if (this.current(gen)) this.state.set('server-disabled');
      return;
    }
    if (!this.current(gen)) return;
    this.settings.set(settings);
    if (!settings.enabled || !settings.publicKey) {
      this.state.set('server-disabled');
      return;
    }
    const local = browserState(this.browser.env());
    if (local !== 'supported' || opts.readOnly) {
      this.state.set(local);
      return;
    }
    try {
      const sub = await this.browser.currentSubscription();
      if (!this.current(gen)) return;
      if (!sub) {
        this.state.set('supported');
        return;
      }
      let device = await this.api.device(sub.endpoint, signal);
      // Abonnement du navigateur inconnu du serveur (supprimé après un 410, autre compte) :
      // resynchronisé, comme dans l'admin.
      if (!device.subscribed) device = await this.api.subscribe(sub.toJSON() as AdminPushSubscriptionInput, signal);
      const fresh = await this.api.settings(signal);
      if (!this.current(gen)) return;
      this.currentDeviceId.set(device.id);
      this.state.set('subscribed');
      this.settings.set(fresh);
    } catch {
      if (this.current(gen)) this.state.set('supported');
    }
  }

  /** Au clic seulement : c'est ici que le navigateur demande la permission. */
  async enable(): Promise<void> {
    const key = this.settings()?.publicKey;
    if (!key || this.busy()) return;
    const gen = this.generation;
    const signal = this.abort.signal;
    this.busy.set(true);
    this.error.set(null);
    try {
      const sub = await this.browser.subscribe(key);
      if (!this.current(gen)) return;
      const device = await this.api.subscribe(sub.toJSON() as AdminPushSubscriptionInput, signal);
      const fresh = await this.api.settings(signal);
      if (!this.current(gen)) return;
      this.currentDeviceId.set(device.id);
      this.state.set('subscribed');
      this.settings.set(fresh);
    } catch {
      if (!this.current(gen)) return;
      if (this.browser.env().notificationPermission === 'denied') {
        this.state.set('denied');
      } else {
        this.error.set("L'activation des notifications a échoué. Réessaie.");
      }
    } finally {
      if (gen === this.generation) this.busy.set(false);
    }
  }

  /** « J'ai changé le réglage » : relit la permission du navigateur. */
  recheck(): Promise<void> {
    return this.init();
  }

  /** Retire un appareil de la liste ; si c'est celui-ci, il est aussi désabonné côté navigateur. */
  async removeDevice(id: string): Promise<boolean> {
    const gen = this.generation;
    if (!this.loaded(gen)) return false;
    const signal = this.abort.signal;
    try {
      await this.api.removeDevice(id, signal);
      if (!this.current(gen)) return false;
      if (id === this.currentDeviceId()) {
        const sub = await this.browser.currentSubscription().catch(() => null);
        await sub?.unsubscribe().catch(() => false);
        this.currentDeviceId.set(null);
        this.state.set('supported');
      }
      const fresh = await this.api.settings(signal);
      if (this.current(gen)) this.settings.set(fresh);
      return true;
    } catch {
      return false;
    }
  }

  isTypeEnabled(type: PushAlertType): boolean {
    return !(this.settings()?.mutedTypes ?? []).includes(type);
  }

  /** Coche / décoche un type (retour arrière si l'API refuse). */
  setTypeEnabled(type: PushAlertType, enabled: boolean): Promise<boolean> {
    const muted = this.settings()?.mutedTypes ?? [];
    const next = enabled ? muted.filter((t) => t !== type) : [...new Set([...muted, type])];
    return this.save({ mutedTypes: next }, (s) => ({ ...s, mutedTypes: next }));
  }

  /** `null` = heures silencieuses désactivées. */
  setQuietHours(quietHours: PushQuietHours | null): Promise<boolean> {
    return this.save({ quietHours }, (s) => ({ ...s, quietHours }));
  }

  private async save(
    input: Parameters<PushApi['preferences']>[0],
    optimistic: (s: TraderPushSettings) => TraderPushSettings,
  ): Promise<boolean> {
    const gen = this.generation;
    const previous = this.settings();
    if (!previous || !this.loaded(gen)) return false;
    this.settings.set(optimistic(previous));
    try {
      const saved = await this.api.preferences(input, this.abort.signal);
      if (this.current(gen)) this.settings.set(saved);
      return true;
    } catch {
      if (this.current(gen)) this.settings.set(previous);
      return false;
    }
  }

  /** « Envoyer une notification test » : nombre d'appareils atteints, `null` en cas d'échec. */
  async test(): Promise<number | null> {
    if (!this.loaded(this.generation)) return null;
    try {
      return (await this.api.test(this.abort.signal)).delivered;
    } catch {
      return null;
    }
  }
}
