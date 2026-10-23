import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AccountIncidentReport, IncidentAiState } from '@mtc/shared';
import { ErrorStateComponent } from '@mtc/front-ui';
import { AccountsApi } from '@app/core/api/accounts.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradesStore } from '@app/core/stores/trades.store';
import { UserStore } from '@app/core/stores/user.store';
import { LostAccountFlowService } from '@app/core/services/lost-account-flow.service';
import { ToastService } from '@app/core/services/toast.service';
import { apiErrorMessage } from '@app/core/utils/api-error';
import { statusBadgeClass, statusLabel } from '@app/core/utils/account-status.util';
import { TopbarComponent } from '@app/shared/components/topbar/topbar.component';
import { PlanModalComponent } from '@app/shared/components/plan-modal/plan-modal.component';
import { aiParagraphs, autopsyKpis, autopsyRows, clock, distanceChart, frenchSpacing, headline, shortDay } from './autopsy.util';

/**
 * Autopsie d'un compte grillé (#669), route `/accounts/:accountId/autopsie/:incidentId`
 * (maquette `maquettes/mockup-autopsie.html`). Chronologie et constats pour tous ; analyse IA
 * pour le Premium, demandée une fois à l'ouverture (le serveur la génère au plus une fois et la
 * conserve). Une colonne sur téléphone, deux à partir de 760 px.
 */
@Component({
  selector: 'mtc-account-autopsy',
  imports: [TopbarComponent, PlanModalComponent, ErrorStateComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-autopsy.component.html',
  styleUrl: './account-autopsy.component.css',
})
export class AccountAutopsyComponent implements OnInit {
  private readonly api = inject(AccountsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(SelectedAccountStore);
  private readonly tradesStore = inject(TradesStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly userStore = inject(UserStore);
  protected readonly lostAccount = inject(LostAccountFlowService);

  private readonly accountId = this.route.snapshot.paramMap.get('accountId') ?? '';
  private readonly incidentId = this.route.snapshot.paramMap.get('incidentId') ?? '';

  protected readonly report = signal<AccountIncidentReport | null>(null);
  protected readonly loadError = signal(false);
  protected readonly ai = signal<IncidentAiState | null>(null);
  protected readonly aiLoading = signal(false);
  protected readonly dismissing = signal(false);
  protected readonly showPlanModal = signal(false);

  protected readonly headline = computed(() => (this.report() ? headline(this.report()!) : ''));
  protected readonly kpis = computed(() => (this.report() ? autopsyKpis(this.report()!) : []));
  protected readonly rows = computed(() => (this.report() ? autopsyRows(this.report()!) : []));
  protected readonly findings = computed(() => (this.report()?.findings ?? []).map(frenchSpacing));
  /** Deux tracés : la carte du téléphone et celle de la colonne large (le SVG s'étire en largeur). */
  protected readonly chartNarrow = computed(() => (this.report() ? distanceChart(this.report()!, 358) : null));
  protected readonly chartWide = computed(() => (this.report() ? distanceChart(this.report()!, 560) : null));
  protected readonly aiText = computed(() => {
    const a = this.ai();
    return a?.status === 'ready' ? { paragraphs: aiParagraphs(a.text), when: `${shortDay(a.generatedAt)} à ${clock(a.generatedAt)}` } : null;
  });
  protected readonly statusLabel = statusLabel;
  protected readonly statusBadgeClass = statusBadgeClass;

  ngOnInit(): void {
    // « Repartir sur une nouvelle tentative » ouvre la feuille du compte, qui le cherche dans la liste.
    if (!this.store.loaded() && !this.store.isLoading()) this.store.load();
    this.load();
  }

  protected load(): void {
    this.loadError.set(false);
    this.api
      .incident(this.accountId, this.incidentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.report.set(res.data);
          this.ai.set(res.data.ai);
          if (res.data.ai.status === 'pending') this.loadAnalysis();
        },
        error: () => this.loadError.set(true),
      });
  }

  /** Premium, analyse jamais générée : le serveur la produit une fois, puis la renvoie telle quelle. */
  private loadAnalysis(): void {
    this.aiLoading.set(true);
    this.api
      .incidentAnalysis(this.accountId, this.incidentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.aiLoading.set(false);
          this.ai.set(res.data);
        },
        error: () => {
          this.aiLoading.set(false);
          this.ai.set({ status: 'unavailable' });
        },
      });
  }

  protected retry(): void {
    this.lostAccount.openRetry(this.accountId);
  }

  /** « Ce n'est pas un échec » : retire l'autopsie ; le serveur décide de la réactivation. */
  protected dismiss(): void {
    const r = this.report();
    if (!r || this.dismissing()) return;
    this.dismissing.set(true);
    this.api
      .dismissIncident(this.accountId, this.incidentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.dismissing.set(false);
          this.store.load();
          this.tradesStore.reset();
          this.toast.success(
            res.data.reactivated
              ? `« ${r.account.label} » est de nouveau actif. Autopsie retirée.`
              : 'Autopsie retirée.',
          );
          void this.router.navigate(['/accounts']);
        },
        error: (err: HttpErrorResponse) => {
          this.dismissing.set(false);
          this.toast.error(apiErrorMessage(err, "L'autopsie n'a pas pu être retirée."));
        },
      });
  }
}
