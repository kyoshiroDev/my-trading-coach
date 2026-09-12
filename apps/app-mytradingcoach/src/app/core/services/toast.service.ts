import { Injectable, computed, signal } from '@angular/core';

/**
 * Feedback transitoire unifié (PROMPT-210) : « quelque chose vient de se passer, tu peux
 * continuer ». Un seul service, un seul conteneur monté à la racine (`mtc-toasts`).
 *
 * Ce qui N'EST PAS un toast (règle `.claude/agents/angular.md`) :
 *  - une erreur de validation d'un champ → reste à côté du champ ;
 *  - un récap à relire (import CSV, frais non rapprochés…) → bloc persistant ;
 *  - un état de page (chargement, vide, paywall).
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  /** ms avant fermeture auto ; `null` = reste jusqu'à la croix. */
  duration: number | null;
}

export interface ToastOptions {
  /** ms ; `null` = fermeture manuelle uniquement. Défaut selon le type. */
  duration?: number | null;
}

/** Succès / info : lus d'un coup d'œil. Erreur / alerte : le temps de lire et d'agir. */
export const TOAST_DURATIONS: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 7000,
  error: 7000,
};

/** Au-delà, les toasts attendent leur tour : une rafale ne recouvre pas l'écran. */
export const MAX_VISIBLE_TOASTS = 3;

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly all = signal<Toast[]>([]);
  private readonly timers = new Map<number, Timer>();
  private readonly paused = new Set<number>();
  private nextId = 1;

  /** Toasts affichés (les plus anciens d'abord), au plus MAX_VISIBLE_TOASTS. */
  readonly visible = computed(() => this.all().slice(0, MAX_VISIBLE_TOASTS));
  /** Nombre de toasts en file, affichés dès qu'une place se libère. */
  readonly queued = computed(() => Math.max(0, this.all().length - MAX_VISIBLE_TOASTS));

  success(message: string, opts?: ToastOptions): number { return this.show('success', message, opts); }
  error(message: string, opts?: ToastOptions): number { return this.show('error', message, opts); }
  info(message: string, opts?: ToastOptions): number { return this.show('info', message, opts); }
  warning(message: string, opts?: ToastOptions): number { return this.show('warning', message, opts); }

  show(type: ToastType, message: string, opts: ToastOptions = {}): number {
    // Double-clic, même échec répété : on relance le toast déjà affiché au lieu d'empiler.
    const twin = this.all().find((t) => t.type === type && t.message === message);
    if (twin) {
      this.restart(twin);
      return twin.id;
    }
    const duration = opts.duration === undefined ? TOAST_DURATIONS[type] : opts.duration;
    const toast: Toast = { id: this.nextId++, type, message, duration };
    this.all.update((list) => [...list, toast]);
    this.syncTimers();
    return toast.id;
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this.paused.delete(id);
    this.all.update((list) => list.filter((t) => t.id !== id));
    this.syncTimers(); // un toast en file prend la place libérée
  }

  clear(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    this.paused.clear();
    this.all.set([]);
  }

  /** Survol / focus : le temps de lecture est suspendu, repris à la sortie. */
  pause(id: number): void {
    const timer = this.timers.get(id);
    this.paused.add(id);
    if (!timer?.handle) return;
    clearTimeout(timer.handle);
    timer.remaining -= Date.now() - timer.startedAt;
    timer.handle = null;
  }

  resume(id: number): void {
    this.paused.delete(id);
    const timer = this.timers.get(id);
    if (!timer || timer.handle) return;
    this.arm(id, Math.max(0, timer.remaining));
  }

  /** Le minuteur ne part qu'à l'AFFICHAGE : un toast en file ne s'expire pas sans être vu. */
  private syncTimers(): void {
    for (const t of this.visible()) {
      if (t.duration === null || this.timers.has(t.id)) continue;
      this.timers.set(t.id, { handle: null, remaining: t.duration, startedAt: Date.now() });
      if (!this.paused.has(t.id)) this.arm(t.id, t.duration);
    }
  }

  private arm(id: number, ms: number): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    timer.startedAt = Date.now();
    timer.remaining = ms;
    timer.handle = setTimeout(() => this.dismiss(id), ms);
  }

  private restart(t: Toast): void {
    if (t.duration === null || !this.visible().some((v) => v.id === t.id)) return;
    this.clearTimer(t.id);
    this.timers.set(t.id, { handle: null, remaining: t.duration, startedAt: Date.now() });
    if (!this.paused.has(t.id)) this.arm(t.id, t.duration);
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
    this.timers.delete(id);
  }
}
