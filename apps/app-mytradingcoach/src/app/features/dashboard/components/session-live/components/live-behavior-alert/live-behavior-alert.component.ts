import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LucideDynamicIcon, LucideOctagonAlert as OctagonAlert, LucideTriangleAlert as TriangleAlert, LucideX as X } from '@lucide/angular';
import { BEHAVIOR_DETECTOR_LABELS, BEHAVIOR_MUTABLE_DETECTORS } from '@mtc/shared';
import { BehaviorAlertsStore } from '@app/core/stores/behavior-alerts.store';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { ToastService } from '@app/core/services/toast.service';
import { apiErrorMessage } from '@app/core/utils/api-error';

/**
 * Bandeau d'alerte de comportement de la Session live (#671) : ambre, rouge si la gravité est haute ou
 * si un 2ᵉ signal du même compte arrive en 30 min. Une phrase, texte exact du détecteur. L'annonce aux
 * lecteurs d'écran passe par deux zones `aria-live` persistantes (polie et assertive) : le bandeau
 * visible n'a pas de rôle d'annonce, pour qu'une alerte ne soit lue qu'une fois.
 */
@Component({
  selector: 'mtc-live-behavior-alert',
  imports: [LucideDynamicIcon, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './live-behavior-alert.component.html',
  styleUrl: './live-behavior-alert.component.css',
})
export class LiveBehaviorAlertComponent {
  /** Compte de la séance : le bandeau ne cite le compte de l'alerte que s'il est différent. */
  readonly sessionAccountId = input<string | null>(null);

  protected readonly store = inject(BehaviorAlertsStore);
  private readonly accounts = inject(SelectedAccountStore);
  private readonly toast = inject(ToastService);
  protected readonly TriangleIcon = TriangleAlert;
  protected readonly OctagonIcon = OctagonAlert;
  protected readonly XIcon = X;

  protected readonly alert = this.store.current;
  protected readonly tone = this.store.tone;
  protected readonly label = computed(() => {
    const a = this.alert();
    return a ? (BEHAVIOR_DETECTOR_LABELS as Record<string, string>)[a.type] ?? 'Comportement' : '';
  });
  protected readonly accountLabel = computed(() => {
    const a = this.alert();
    if (!a || a.accountId === this.sessionAccountId()) return null;
    return this.accounts.accounts().find((x) => x.id === a.accountId)?.label ?? null;
  });
  protected readonly mutable = computed(() => {
    const a = this.alert();
    return !!a && (BEHAVIOR_MUTABLE_DETECTORS as readonly string[]).includes(a.type);
  });
  /** Texte des zones d'annonce : vide quand l'alerte est de l'autre gravité, pour ne rien lire deux fois. */
  protected readonly politeText = computed(() => (this.alert() && this.tone()?.tone === 'amber' ? `${this.label()}. ${this.alert()!.message}` : ''));
  protected readonly assertiveText = computed(() => (this.alert() && this.tone()?.tone === 'red' ? `${this.label()}. ${this.alert()!.message}` : ''));

  protected mute(): void {
    this.store.muteCurrent((err) => this.toast.error(apiErrorMessage(err, 'Ce détecteur n’a pas pu être coupé. Réessaie.')));
  }
}
