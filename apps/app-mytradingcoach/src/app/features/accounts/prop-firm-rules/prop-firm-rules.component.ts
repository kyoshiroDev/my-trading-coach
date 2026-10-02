import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import {
  LucideDynamicIcon,
  LucideAlertTriangle as AlertTriangle,
  LucideExternalLink as ExternalLink,
  LucideTarget as Target,
  LucideTrendingDown as TrendingDown,
  LucideCalendarX as CalendarX,
  LucideScale as Scale,
  LucideLayers as Layers,
  LucideClock as Clock,
  LucideWallet as Wallet,
} from '@lucide/angular';
import type { AccountType, PropFirmPlanDetail } from '@mtc/shared';
import {
  PHASE_LABELS,
  amount,
  breachLabel,
  contractsLabel,
  defaultPhase,
  drawdownKindLabel,
  enforcementLabel,
  lockLabel,
  pctLabel,
  scheduleLabel,
  tierRange,
  timeLabel,
  yesNo,
} from './prop-firm-rules.util';

/**
 * Règles officielles du plan prop firm relié à un compte, phase par phase. Lecture seule :
 * ces règles viennent du catalogue MTC, pas du calcul de la firm sur le compte.
 */
@Component({
  selector: 'mtc-prop-firm-rules',
  imports: [LucideDynamicIcon],
  templateUrl: './prop-firm-rules.component.html',
  styleUrl: './prop-firm-rules.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropFirmRulesComponent {
  readonly plan = input.required<PropFirmPlanDetail>();
  readonly accountType = input.required<AccountType>();

  protected readonly icons = {
    AlertTriangle, ExternalLink, Target, TrendingDown, CalendarX, Scale, Layers, Clock, Wallet,
  };
  protected readonly PHASE_LABELS = PHASE_LABELS;
  protected readonly fmt = {
    amount, breachLabel, contractsLabel, drawdownKindLabel, enforcementLabel, lockLabel, pctLabel, scheduleLabel, tierRange, timeLabel, yesNo,
  };

  /** Valeur renseignée (ni null ni absente) : les templates n'acceptent pas `!= null`. */
  protected has<T>(v: T): v is NonNullable<T> {
    return v !== null && v !== undefined;
  }

  /** Phase affichée : suit le type du compte, modifiable par les onglets. */
  protected readonly phaseKey = linkedSignal(() => defaultPhase(this.plan(), this.accountType()));
  protected readonly phase = computed(
    () => this.plan().phases.find((p) => p.phase === this.phaseKey()) ?? this.plan().phases[0],
  );
  protected readonly currency = computed(() => this.plan().currency);
  protected readonly verifiedLabel = computed(() =>
    new Date(`${this.plan().firm.verifiedAt}T12:00:00Z`).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
  );
  protected readonly overrides = computed(() =>
    Object.entries(this.phase().max_drawdown.platform_overrides ?? {}).map(([platform, o]) => ({ platform, ...o })),
  );
  protected readonly sourceHosts = computed(() =>
    this.plan().sourceUrls.map((url) => ({ url, label: url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) })),
  );
}
