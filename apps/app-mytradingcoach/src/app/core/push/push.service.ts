import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  PUSH_MAX_DEVICES,
  type AdminPushSubscriptionInput,
  type PushAlertType,
  type PushQuietHours,
  type TraderPushPreferencesInput,
  type TraderPushSettings,
} from '@mtc/shared';
import { PushApi } from '../api/push.api';
import { AuthService } from '../auth/auth.service';
import { UserScopedReset } from '../auth/user-scoped-reset';
import { PUSH_BROWSER, type BrowserEnv } from './push-browser';
import { devicePlace, isInAppBrowser, isIos } from './push-device';
import { ProductEventsService, type InstallEvent } from '../services/product-events.service';

/**
 * Où en est le push sur CET appareil (#666). Ordre de diagnostic : serveur, navigateur intégré,
 * iPhone sans manifest, iPhone sans installation, navigateur sans push, permission refusée, puis
 * abonné ou non.
 */
export type PushState =
  | 'server-disabled'
  | 'in-app-browser'
  | 'ios-unavailable'
  | 'ios-not-installed'
  | 'unsupported'
  | 'denied'
  | 'supported'
  | 'subscribed';

/** Issue d'une écriture des réglages : `skipped` = abandonnée sans envoi (échec précédent, autre compte). */
export type SaveResult = 'saved' | 'failed' | 'skipped';

interface PendingChange {
  apply: (s: TraderPushSettings) => TraderPushSettings;
  input: (s: TraderPushSettings) => TraderPushPreferencesInput;
}

/** Diagnostic côté navigateur seul (sans l'avis du serveur ni l'abonnement). */
export function browserState(env: BrowserEnv): Exclude<PushState, 'server-disabled' | 'subscribed'> {
  if (isInAppBrowser(env)) return 'in-app-browser';
  // Sur iPhone et iPad, rien n'est proposé tant que la page n'a pas de manifest (#715) : sans lui,
  // l'app ajoutée à l'écran d'accueil ne donne pas de push vérifié, même ouverte en mode app (iOS 26).
  // Le critère est le lien réel dans le document : l'activation revient seule avec le manifest.
  if (isIos(env) && !env.hasManifest) return 'ios-unavailable';
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
  private readonly events = inject(ProductEventsService);

  /** Compte à qui appartient l'état affiché, et génération de cet état (changée à chaque remise à zéro). */
  private owner: string | null = null;
  private generation = 0;
  private abort = new AbortController();
  /** Réglages tels qu'enregistrés par le serveur, et changements de l'écran pas encore confirmés. */
  private confirmed: TraderPushSettings | null = null;
  private pending: PendingChange[] = [];
  private writes: Promise<unknown> = Promise.resolve();

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
    this.confirmed = null;
    this.pending = [];
    this.writes = Promise.resolve();
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
    this.setServer(settings);
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
      this.setServer(fresh);
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
      this.setServer(fresh);
      this.track('push_enabled');
    } catch {
      if (!this.current(gen)) return;
      const permission = this.browser.env().notificationPermission;
      // Refus, ou demande fermée sans réponse : la permission n'est pas accordée.
      if (permission !== 'granted') this.track('push_denied');
      if (permission === 'denied') {
        this.state.set('denied');
      } else if (permission === 'default') {
        // Demande fermée sans réponse (revue phase 2 m3) : rien n'a échoué, il reste à répondre.
        this.error.set('Autorise les notifications quand ton navigateur te le demande.');
      } else {
        this.error.set('L’activation des notifications a échoué. Réessaie.');
      }
    } finally {
      if (gen === this.generation) this.busy.set(false);
    }
  }

  /** Mesure de l'activation (plateforme seulement). Jamais pour le compte démo. */
  private track(event: InstallEvent): void {
    if (this.auth.currentUser()?.isDemo) return;
    this.events.track(event, devicePlace(this.browser.env()));
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
      if (this.current(gen)) this.setServer(fresh);
      return true;
    } catch {
      return false;
    }
  }

  isTypeEnabled(type: PushAlertType): boolean {
    return !(this.settings()?.mutedTypes ?? []).includes(type);
  }

  /** Coche / décoche un type. Le type est retiré ou ajouté à la liste au moment de l'envoi. */
  setTypeEnabled(type: PushAlertType, enabled: boolean): Promise<SaveResult> {
    const apply = (s: TraderPushSettings): TraderPushSettings => ({
      ...s,
      mutedTypes: enabled ? s.mutedTypes.filter((t) => t !== type) : [...new Set([...s.mutedTypes, type])],
    });
    return this.save({ apply, input: (s) => ({ mutedTypes: apply(s).mutedTypes }) });
  }

  /** `null` = heures silencieuses désactivées. */
  setQuietHours(quietHours: PushQuietHours | null): Promise<SaveResult> {
    return this.save({ apply: (s) => ({ ...s, quietHours }), input: () => ({ quietHours }) });
  }

  /** Dernier état enregistré par le serveur, affiché avec les changements encore en attente par-dessus. */
  private setServer(settings: TraderPushSettings): void {
    this.confirmed = settings;
    this.render();
  }

  private render(): void {
    const base = this.confirmed;
    this.settings.set(base && this.pending.reduce((s, change) => change.apply(s), base));
  }

  /**
   * Écritures en file, une à la fois (revue phase 2 I1). Chacune part de ce que le serveur a
   * enregistré à la précédente, jamais d'un état optimiste. Après un échec, les changements encore
   * en attente sont abandonnés et l'état du serveur est relu puis réaffiché : un seul `failed`
   * (un seul message), les suivants rendent `skipped`.
   */
  private save(change: PendingChange): Promise<SaveResult> {
    const gen = this.generation;
    if (!this.confirmed || !this.loaded(gen)) return Promise.resolve('skipped');
    this.pending.push(change);
    this.render();
    const run = this.writes.then(() => this.write(change, gen));
    this.writes = run;
    return run;
  }

  private async write(change: PendingChange, gen: number): Promise<SaveResult> {
    if (!this.current(gen) || !this.confirmed || !this.pending.includes(change)) return 'skipped';
    const signal = this.abort.signal;
    try {
      const saved = await this.api.preferences(change.input(this.confirmed), signal);
      if (!this.current(gen)) return 'skipped';
      this.pending = this.pending.filter((c) => c !== change);
      this.setServer(saved);
      return 'saved';
    } catch {
      if (!this.current(gen)) return 'skipped';
      this.pending = [];
      try {
        const fresh = await this.api.settings(signal);
        if (this.current(gen)) this.setServer(fresh);
      } catch {
        // Relecture impossible : dernier état connu du serveur.
        if (this.current(gen)) this.render();
      }
      return 'failed';
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
