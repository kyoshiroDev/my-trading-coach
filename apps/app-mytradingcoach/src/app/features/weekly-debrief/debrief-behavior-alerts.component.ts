import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BEHAVIOR_DETECTOR_LABELS, type BehaviorAlertHistoryItem } from '@mtc/shared';
import { ErrorStateComponent } from '@mtc/front-ui';
import { BehaviorApi } from '../../core/api/behavior.api';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';

/**
 * Débrief hebdo, « Alertes de la semaine » (#671) : alertes de comportement de la semaine affichée et, pour
 * chacune, les trades clôturés qui ont suivi (P&L dans la devise du compte, #947). Rendu par le débrief
 * seulement quand `BEHAVIOR_ALERTS_UI` est allumé ; bloc masqué sans alerte. Le débrief est déjà Premium.
 */
@Component({
  selector: 'mtc-debrief-behavior-alerts',
  imports: [DatePipe, PnlFormatPipe, ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './debrief-behavior-alerts.component.html',
  styleUrl: './debrief-behavior-alerts.component.css',
})
export class DebriefBehaviorAlertsComponent {
  /** Jours de la semaine affichée (AAAA-MM-JJ), journée CME. */
  readonly from = input.required<string>();
  readonly to = input.required<string>();

  private readonly api = inject(BehaviorApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly labels = BEHAVIOR_DETECTOR_LABELS as Record<string, string>;
  protected readonly alerts = signal<BehaviorAlertHistoryItem[]>([]);
  protected readonly status = signal<'loading' | 'loaded' | 'error'>('loading');

  constructor() {
    effect(() => {
      const from = this.from();
      const to = this.to();
      untracked(() => this.load(from, to));
    });
  }

  protected reload(): void {
    this.load(this.from(), this.to());
  }

  private load(from: string, to: string): void {
    this.status.set('loading');
    this.api
      .getAlerts(from, to)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.alerts.set(res.data ?? []);
          this.status.set('loaded');
        },
        error: () => this.status.set('error'),
      });
  }
}
