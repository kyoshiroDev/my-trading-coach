import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { LucideDynamicIcon, LucideChevronLeft as ChevronLeft, LucideChevronRight as ChevronRight } from '@lucide/angular';
import { guessPlan, type AccountPlanHint, type PropFirmCatalogFirm, type PropFirmPlanSummary } from '@mtc/shared';
import { AccountsApi, type TradingAccount, type UpdateAccountPayload } from '@app/core/api/accounts.api';
import { PropFirmsApi } from '@app/core/api/prop-firms.api';
import { apiErrorMessage } from '@app/core/utils/api-error';
import { programKey, programLabel, rulesFromPlan, sizeLabel } from '../prop-firm-plan-picker/prop-firm-plans.util';

export type PlanPhase = 'evaluation' | 'funded';
type Step = 'loading' | 'guess' | 'firm' | 'size' | 'phase' | 'program' | 'unlisted';

/** Programme proposé pour une firm, une taille et une phase : un plan par programme. */
interface ProgramChoice {
  key: string;
  label: string;
  inviteOnly: boolean;
  plan: PropFirmPlanSummary;
}

/** Phases que propose un plan : `direct` (funded sans évaluation) compte comme funded. */
function phasesOf(plan: PropFirmPlanSummary): PlanPhase[] {
  const out = new Set<PlanPhase>();
  for (const p of plan.phases) out.add(p.phase === 'evaluation' ? 'evaluation' : 'funded');
  return [...out];
}

/**
 * « Quel est ce compte ? » (#612) : relie un compte à son plan du catalogue, un choix par écran
 * (firm → taille → phase → programme). Pré-sélection quand les indices du sous-compte broker
 * suffisent (`guessPlan`). « Compte perso », « Ma firm n'est pas dans la liste » et « Plus tard »
 * sont enregistrés (`planLinkChoice`) : un compte sans plan sait pourquoi il n'en a pas.
 *
 * Enregistre lui-même (PATCH du compte) et émet le compte à jour : le parent recharge son store.
 */
@Component({
  selector: 'mtc-account-plan-wizard',
  imports: [LucideDynamicIcon],
  templateUrl: './account-plan-wizard.component.html',
  styleUrl: './account-plan-wizard.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPlanWizardComponent implements OnInit {
  private readonly accountsApi = inject(AccountsApi);
  private readonly propFirmsApi = inject(PropFirmsApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly accountId = input.required<string>();
  readonly accountLabel = input<string>('');
  /** Émis après enregistrement (plan, perso, firm absente ou « Plus tard »). */
  readonly done = output<TradingAccount>();

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly sizeLabel = sizeLabel;

  protected readonly catalog = signal<readonly PropFirmCatalogFirm[]>([]);
  protected readonly hint = signal<AccountPlanHint | null>(null);
  protected readonly step = signal<Step>('loading');
  private readonly history = signal<Step[]>([]);
  protected readonly firmId = signal<string | null>(null);
  protected readonly size = signal<number | null>(null);
  protected readonly phase = signal<PlanPhase | null>(null);
  protected readonly unlistedName = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly guess = computed(() => guessPlan(this.hint(), this.catalog()));
  protected readonly canGoBack = computed(() => this.history().length > 0);
  protected readonly firms = computed(() => [...this.catalog()].sort((a, b) => a.name.localeCompare(b.name)));
  protected readonly firm = computed(() => this.catalog().find((f) => f.id === this.firmId()) ?? null);
  /** Nom de la firm devinée, pour la question de pré-sélection. */
  protected readonly guessFirmName = computed(() => {
    const g = this.guess();
    return g.kind === 'found' || g.kind === 'ambiguous' ? (this.catalog().find((f) => f.id === g.firmId)?.name ?? '') : '';
  });
  protected readonly sizes = computed(() => {
    const firm = this.firm();
    return firm ? [...new Set(firm.plans.map((p) => p.accountSize))].sort((a, b) => a - b) : [];
  });
  private readonly plansAtSize = computed(() => (this.firm()?.plans ?? []).filter((p) => p.accountSize === this.size()));
  protected readonly phases = computed<PlanPhase[]>(() => {
    const all = new Set(this.plansAtSize().flatMap(phasesOf));
    return (['evaluation', 'funded'] as const).filter((p) => all.has(p));
  });
  protected readonly programs = computed<ProgramChoice[]>(() => {
    const phase = this.phase();
    const byKey = new Map<string, ProgramChoice>();
    for (const plan of this.plansAtSize()) {
      if (phase && !phasesOf(plan).includes(phase)) continue;
      const key = programKey(plan);
      if (!byKey.has(key)) byKey.set(key, { key, label: programLabel(plan), inviteOnly: plan.availability === 'invite_only', plan });
    }
    return [...byKey.values()].sort((a, b) => Number(a.inviteOnly) - Number(b.inviteOnly) || a.label.localeCompare(b.label));
  });

  ngOnInit(): void {
    forkJoin({
      catalog: this.propFirmsApi.getCatalog().pipe(catchError(() => of({ data: [] as PropFirmCatalogFirm[] }))),
      hint: this.accountsApi.planHint(this.accountId()).pipe(catchError(() => of({ data: null }))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ catalog, hint }) => {
        this.catalog.set(catalog.data ?? []);
        this.hint.set(hint.data ?? null);
        this.start();
      });
  }

  /** Premier écran : la question de pré-sélection si un indice est fiable, sinon le choix de la firm. */
  private start(): void {
    const g = this.guess();
    if (g.kind === 'found' || g.kind === 'personal') {
      this.step.set('guess');
    } else if (g.kind === 'ambiguous') {
      this.firmId.set(g.firmId);
      this.phase.set(g.phase);
      this.step.set('size');
    } else {
      this.step.set('firm');
    }
  }

  private go(next: Step): void {
    this.history.update((h) => [...h, this.step()]);
    this.error.set(null);
    this.step.set(next);
  }

  protected back(): void {
    const h = this.history();
    if (!h.length) return;
    this.history.set(h.slice(0, -1));
    this.error.set(null);
    this.step.set(h[h.length - 1]);
  }

  /** « Oui » à la pré-sélection. */
  protected confirmGuess(): void {
    const g = this.guess();
    if (g.kind === 'personal') {
      this.save({ type: 'PERSONAL', propFirmPlanId: null, planLinkChoice: 'PERSONAL' });
      return;
    }
    if (g.kind !== 'found') return;
    this.firmId.set(g.firmId);
    this.size.set(g.accountSize);
    this.phase.set(g.phase);
    this.afterSize();
  }

  /** « Changer » : parcours complet, rien de pré-choisi. */
  protected changeGuess(): void {
    this.firmId.set(null);
    this.size.set(null);
    this.phase.set(null);
    this.go('firm');
  }

  protected pickFirm(id: string): void {
    if (id !== this.firmId()) {
      this.size.set(null);
      this.phase.set(null);
    }
    this.firmId.set(id);
    const sizes = this.sizes();
    if (sizes.length === 1) {
      this.size.set(sizes[0]);
      this.afterSize();
    } else {
      this.go('size');
    }
  }

  protected pickSize(size: number): void {
    this.size.set(size);
    this.afterSize();
  }

  protected pickPhase(phase: PlanPhase): void {
    this.phase.set(phase);
    this.afterPhase();
  }

  /** Phase demandée seulement si le catalogue en distingue deux pour cette taille. */
  private afterSize(): void {
    const phases = this.phases();
    const current = this.phase();
    if (current && phases.includes(current)) {
      this.afterPhase();
    } else if (phases.length === 1) {
      this.phase.set(phases[0]);
      this.afterPhase();
    } else {
      this.phase.set(null);
      this.go('phase');
    }
  }

  /** Un seul programme : relié tout de suite. Sinon l'utilisateur choisit (aucun indice ne le dit). */
  private afterPhase(): void {
    const programs = this.programs();
    if (programs.length === 1) this.pickProgram(programs[0].plan);
    else this.go('program');
  }

  protected pickProgram(plan: PropFirmPlanSummary): void {
    const type = this.phase() === 'evaluation' ? 'EVALUATION' : 'FUNDED';
    const rules = rulesFromPlan(plan, type);
    this.save({
      propFirmPlanId: plan.id,
      type,
      broker: this.firm()?.name ?? null,
      accountSize: rules.accountSize,
      startingBalance: rules.startingBalance,
      profitTarget: rules.profitTarget,
      maxDrawdown: rules.maxDrawdown,
      ...(rules.drawdownType ? { drawdownType: rules.drawdownType } : {}),
    });
  }

  protected pickPersonal(): void {
    this.save({ type: 'PERSONAL', propFirmPlanId: null, planLinkChoice: 'PERSONAL' });
  }

  protected openUnlisted(): void {
    this.go('unlisted');
  }

  protected onUnlistedInput(event: Event): void {
    this.unlistedName.set((event.target as HTMLInputElement).value);
  }

  protected saveUnlisted(): void {
    const name = this.unlistedName().trim();
    if (!name) return;
    this.save({ propFirmPlanId: null, planLinkChoice: 'UNLISTED', unlistedFirm: name, broker: name });
  }

  protected later(): void {
    this.save({ planLinkChoice: 'LATER' });
  }

  protected phaseLabel(p: PlanPhase): string {
    return p === 'evaluation' ? 'Évaluation' : 'Funded';
  }

  private save(payload: UpdateAccountPayload): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.accountsApi
      .update(this.accountId(), payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.saving.set(false);
          this.done.emit(res.data);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(apiErrorMessage(err, "Le compte n'a pas pu être enregistré. Réessaie."));
        },
      });
  }
}
