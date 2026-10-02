import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideDynamicIcon, LucideAlertTriangle as AlertTriangle, LucideBadgeCheck as BadgeCheck } from '@lucide/angular';
import type { AccountType, PropFirmCatalogFirm, PropFirmPlanSummary } from '@mtc/shared';
import { findPlan, phaseFor, programKey, programsOf, sizeLabel } from './prop-firm-plans.util';

/** Valeur du choix de firm : id du catalogue, `other` (saisie libre) ou '' (rien choisi). */
export type FirmChoice = string;
export const OTHER_FIRM = 'other';

/**
 * Choix d'un plan du catalogue prop firm : firm → programme → taille.
 *
 * Ne touche pas au formulaire du compte : il émet le choix, le parent pré-remplit les règles.
 * « Autre » laisse la main à la saisie libre de la firm (firms absentes du catalogue).
 */
@Component({
  selector: 'mtc-prop-firm-plan-picker',
  imports: [FormsModule, LucideDynamicIcon],
  templateUrl: './prop-firm-plan-picker.component.html',
  styleUrl: './prop-firm-plan-picker.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PropFirmPlanPickerComponent {
  readonly catalog = input.required<readonly PropFirmCatalogFirm[]>();
  readonly accountType = input.required<AccountType>();
  readonly planId = input<string | null>(null);
  /** Compte existant avec une firm saisie à la main et sans plan : ouvrir sur « Autre ». */
  readonly startOnOther = input(false);

  readonly firmChange = output<FirmChoice>();
  readonly planChange = output<PropFirmPlanSummary | null>();

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly BadgeCheckIcon = BadgeCheck;
  protected readonly OTHER = OTHER_FIRM;
  protected readonly sizeLabel = sizeLabel;

  protected readonly firmId = signal<FirmChoice>('');
  protected readonly programId = signal('');

  protected readonly firm = computed(() => this.catalog().find((f) => f.id === this.firmId()) ?? null);
  protected readonly programs = computed(() => {
    const firm = this.firm();
    return firm ? programsOf(firm) : [];
  });
  protected readonly program = computed(() => this.programs().find((p) => p.key === this.programId()) ?? null);
  protected readonly selected = computed(() => findPlan(this.catalog(), this.planId()));
  protected readonly phaseMissing = computed(() => {
    const sel = this.selected();
    return !!sel && !phaseFor(sel.plan, this.accountType());
  });
  protected readonly verifiedLabel = computed(() => {
    const firm = this.firm();
    if (!firm) return '';
    return new Date(`${firm.verifiedAt}T12:00:00Z`).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  });

  constructor() {
    // Ouverture (création, édition) : le choix affiché suit le plan du compte.
    effect(() => {
      const sel = this.selected();
      if (sel) {
        this.firmId.set(sel.firm.id);
        this.programId.set(programKey(sel.plan));
      } else if (this.startOnOther()) {
        this.firmId.set(OTHER_FIRM);
      }
    });
  }

  protected onFirm(id: FirmChoice): void {
    this.firmId.set(id);
    this.programId.set('');
    this.firmChange.emit(id);
    this.planChange.emit(null);
  }

  /** Changer de programme garde la taille choisie quand elle existe dans le nouveau. */
  protected onProgram(key: string): void {
    this.programId.set(key);
    const size = this.selected()?.plan.accountSize;
    const plans = this.program()?.plans ?? [];
    this.planChange.emit(plans.find((p) => p.accountSize === size) ?? null);
  }

  protected onSize(plan: PropFirmPlanSummary): void {
    this.planChange.emit(plan);
  }
}
