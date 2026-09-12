import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-angular';
import { ToastService, ToastType } from '../../../core/services/toast.service';

/**
 * Pile de toasts, montée UNE seule fois dans le composant racine (`mtc-root`). Au-dessus de
 * tout (z-index 10000, cf. hiérarchie angular.md) : une modale ouverte ne masque jamais
 * un message d'erreur.
 */
@Component({
  selector: 'mtc-toasts',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toasts.component.html',
  styleUrl: './toasts.component.css',
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly XIcon = X;

  private readonly ICONS = { success: CheckCircle2, error: AlertCircle, info: Info, warning: AlertTriangle };

  protected icon(type: ToastType) {
    return this.ICONS[type];
  }

  /** Erreur : annoncée immédiatement ; le reste attend la fin de la phrase en cours. */
  protected live(type: ToastType): 'assertive' | 'polite' {
    return type === 'error' ? 'assertive' : 'polite';
  }
}
