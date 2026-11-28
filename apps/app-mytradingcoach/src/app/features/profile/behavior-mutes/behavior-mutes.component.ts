import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BEHAVIOR_DETECTOR_LABELS, type BehaviorMutableDetector, type BehaviorMute } from '@mtc/shared';
import { ErrorStateComponent } from '@mtc/front-ui';
import { BehaviorApi } from '@app/core/api/behavior.api';
import { UserStore } from '@app/core/stores/user.store';
import { apiErrorMessage } from '@app/core/utils/api-error';
import { PremiumLockComponent } from '@app/shared/components/premium-lock/premium-lock.component';

/**
 * Profil, « Alertes de comportement » (#671) : détecteurs coupés avec « Pas pour mon style », réactivables.
 * Affiché par le Profil seulement quand `BEHAVIOR_ALERTS_UI` est allumé ; verrou Premium pour un gratuit.
 */
@Component({
  selector: 'mtc-behavior-mutes',
  imports: [DatePipe, ErrorStateComponent, PremiumLockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './behavior-mutes.component.html',
  styleUrl: './behavior-mutes.component.css',
})
export class BehaviorMutesComponent {
  private readonly api = inject(BehaviorApi);
  protected readonly userStore = inject(UserStore);
  protected readonly labels = BEHAVIOR_DETECTOR_LABELS as Record<string, string>;

  protected readonly mutes = signal<BehaviorMute[]>([]);
  protected readonly status = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly busy = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    // Le compte peut passer Premium pendant que le Profil est ouvert (modale de plans, /auth/me tardif).
    effect(() => {
      if (this.userStore.isPremium()) untracked(() => this.load());
    });
  }

  protected load(): void {
    this.status.set('loading');
    this.api.getMutes().subscribe({
      next: (res) => {
        this.mutes.set(res.data ?? []);
        this.status.set('loaded');
      },
      error: () => this.status.set('error'),
    });
  }

  protected unmute(detector: BehaviorMutableDetector): void {
    if (this.busy()) return;
    this.busy.set(detector);
    this.actionError.set(null);
    this.api.unmute(detector).subscribe({
      next: () => {
        this.busy.set(null);
        this.mutes.update((list) => list.filter((m) => m.detector !== detector));
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.actionError.set(apiErrorMessage(err, 'Ce détecteur n’a pas pu être réactivé. Réessaie.'));
      },
    });
  }
}
