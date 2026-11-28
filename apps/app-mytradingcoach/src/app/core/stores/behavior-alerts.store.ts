import { Injectable, computed, inject, signal } from '@angular/core';
import type { BehaviorAlertEvent, BehaviorMutableDetector } from '@mtc/shared';
import { BEHAVIOR_MUTABLE_DETECTORS } from '@mtc/shared';
import { BehaviorApi } from '../api/behavior.api';
import { UserScopedReset } from '../auth/user-scoped-reset';
import { type LiveBehaviorAlert, behaviorTone } from '../utils/behavior-tone';

/**
 * Alertes de comportement de la séance (#671), en mémoire : alimentées par l'événement socket
 * `behavior:alert` (le serveur n'envoie qu'aux comptes Premium, flag allumé, détecteur non coupé).
 * `uiEnabled` vient de `GET /behavior/config` (jamais d'une variable d'environnement côté app).
 */
@Injectable({ providedIn: 'root' })
export class BehaviorAlertsStore {
  private readonly api = inject(BehaviorApi);

  readonly uiEnabled = signal(false);
  readonly alerts = signal<LiveBehaviorAlert[]>([]);
  readonly muting = signal(false);
  private configRequested = false;

  readonly current = computed(() => this.alerts().at(-1) ?? null);

  constructor() {
    inject(UserScopedReset).register(() => this.reset());
  }
  readonly tone = computed(() => behaviorTone(this.alerts()));

  /** Une fois par session d'app : la configuration ne change qu'au redémarrage de l'API. */
  loadConfig(): void {
    if (this.configRequested) return;
    this.configRequested = true;
    this.api.getConfig().subscribe({
      next: (res) => this.uiEnabled.set(!!res.data?.uiEnabled),
      error: () => {
        this.configRequested = false; // réessayé au prochain écran
      },
    });
  }

  push(e: BehaviorAlertEvent, now = Date.now()): void {
    if (!this.uiEnabled()) return;
    this.alerts.update((list) => [...list.filter((a) => a.id !== e.id), { ...e, receivedAt: now }]);
  }

  /** Croix : le bandeau repart vide, le détecteur continue de sonner. */
  dismiss(): void {
    this.alerts.set([]);
  }

  /** « Pas pour mon style » : coupe le détecteur de l'alerte affichée et ferme le bandeau. */
  muteCurrent(onError: (err: unknown) => void): void {
    const cur = this.current();
    if (!cur || this.muting() || !(BEHAVIOR_MUTABLE_DETECTORS as readonly string[]).includes(cur.type)) return;
    this.muting.set(true);
    this.api.mute(cur.type as BehaviorMutableDetector).subscribe({
      next: () => {
        this.muting.set(false);
        this.alerts.update((list) => list.filter((a) => a.type !== cur.type));
      },
      error: (err: unknown) => {
        this.muting.set(false);
        onError(err);
      },
    });
  }

  /** Déconnexion : rien ne reste d'un compte à l'autre. */
  reset(): void {
    this.alerts.set([]);
    this.uiEnabled.set(false);
    this.configRequested = false;
  }
}
