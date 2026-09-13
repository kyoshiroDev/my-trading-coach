import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  LucideDynamicIcon,
  LucideCheckCircle2 as CheckCircle2,
  LucideAlertCircle as AlertCircle,
  LucideInfo as Info,
  LucideAlertTriangle as AlertTriangle,
  LucideX as X,
} from '@lucide/angular';
import { ToastService, ToastType } from '../../../core/services/toast.service';

/** Distance minimale de glisser pour fermer (px), ou 35 % de la largeur si plus grand. */
export const SWIPE_MIN_PX = 80;
export const SWIPE_RATIO = 0.35;

interface Drag {
  id: number;
  startX: number;
  dx: number;
  width: number;
}

/**
 * Pile de toasts, montée UNE seule fois dans le composant racine (`mtc-root`). Au-dessus de
 * tout (z-index 10000, cf. hiérarchie angular.md) : une modale ouverte ne masque jamais
 * un message d'erreur.
 *
 * Comportement usuel d'un toast : il glisse depuis le bord, la pile se décale en douceur,
 * une barre en haut montre le temps restant, il repart vers le bord et la pile se referme ;
 * on peut le chasser d'un glisser (souris ou doigt).
 */
@Component({
  selector: 'mtc-toasts',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toasts.component.html',
  styleUrl: './toasts.component.css',
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly XIcon = X;

  private readonly ICONS = { success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertTriangle };

  /** Glisser en cours (un seul toast à la fois). */
  protected readonly drag = signal<Drag | null>(null);
  /** Toasts chassés vers la gauche : leur sortie part de ce côté. */
  private readonly leftExits = signal<ReadonlySet<number>>(new Set());

  protected icon(type: ToastType) {
    return this.ICONS[type];
  }

  /** Erreur : annoncée immédiatement ; le reste attend la fin de la phrase en cours. */
  protected live(type: ToastType): 'assertive' | 'polite' {
    return type === 'error' ? 'assertive' : 'polite';
  }

  /** Classe posée par `animate.leave` : la sortie suit le sens du geste. */
  protected leaveClass(id: number): string {
    return this.leftExits().has(id) ? 'toast-leave toast-leave-left' : 'toast-leave';
  }

  protected dragTransform(id: number): string | null {
    const d = this.drag();
    return d && d.id === id ? `translateX(${d.dx}px)` : null;
  }

  protected dragOpacity(id: number): number | null {
    const d = this.drag();
    if (!d || d.id !== id) return null;
    return Math.max(0.35, 1 - Math.abs(d.dx) / Math.max(d.width, 200));
  }

  // ── Glisser pour fermer ────────────────────────────────────────────────────

  protected onPointerDown(e: PointerEvent, id: number): void {
    if (e.button > 0) return; // clic droit / milieu : pas un geste de fermeture
    if ((e.target as HTMLElement | null)?.closest('.toast-x')) return; // la croix garde son clic
    const el = e.currentTarget as HTMLElement;
    this.drag.set({ id, startX: e.clientX, dx: 0, width: el.getBoundingClientRect().width });
    this.toasts.pause(id);
    el.setPointerCapture?.(e.pointerId);
  }

  protected onPointerMove(e: PointerEvent, id: number): void {
    const d = this.drag();
    if (!d || d.id !== id) return;
    this.drag.set({ ...d, dx: e.clientX - d.startX });
  }

  protected onPointerUp(e: PointerEvent, id: number): void {
    const d = this.drag();
    if (!d || d.id !== id) return;
    this.drag.set(null);
    if (Math.abs(d.dx) >= Math.max(SWIPE_MIN_PX, d.width * SWIPE_RATIO)) {
      if (d.dx < 0) {
        // On ne garde que les toasts encore affichés (+ celui-ci) : l'ensemble ne grossit pas.
        const shown = new Set(this.toasts.visible().map((t) => t.id));
        this.leftExits.update((s) => new Set([...s].filter((x) => shown.has(x))).add(id));
      }
      this.toasts.dismiss(id);
      return;
    }
    // Revient en place. À la souris, le survol continue : c'est `mouseleave` qui reprendra.
    if (e.pointerType !== 'mouse') this.toasts.resume(id);
  }

  protected onPointerCancel(id: number): void {
    if (this.drag()?.id !== id) return;
    this.drag.set(null);
    this.toasts.resume(id);
  }
}
