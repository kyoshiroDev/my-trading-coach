import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, afterRenderEffect, computed, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, timeout } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AccountIncidentReport, IncidentAiState } from '@mtc/shared';
import { ConfirmService, ErrorStateComponent } from '@mtc/front-ui';
import { AccountsApi } from '@app/core/api/accounts.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradesStore } from '@app/core/stores/trades.store';
import { UserStore } from '@app/core/stores/user.store';
import { LostAccountFlowService } from '@app/core/services/lost-account-flow.service';
import { DemoService } from '@app/core/services/demo.service';
import { ToastService } from '@app/core/services/toast.service';
import { apiErrorMessage } from '@app/core/utils/api-error';
import { statusBadgeClass, statusLabel } from '@app/core/utils/account-status.util';
import { TopbarComponent } from '@app/shared/components/topbar/topbar.component';
import { PlanModalComponent } from '@app/shared/components/plan-modal/plan-modal.component';
import { aiParagraphs, autopsyKpis, autopsyRows, clock, distanceChart, frenchSpacing, headline, shortDay } from './autopsy.util';

/** Largeur du tracé avant la première mesure (carte d'un téléphone de 390 px). */
const CHART_DEFAULT_WIDTH = 330;

/** Au-delà, la page cesse d'attendre et propose « Réessayer ». */
export const AUTOPSY_TIMEOUT_MS = 15_000;

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
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly userStore = inject(UserStore);
  protected readonly lostAccount = inject(LostAccountFlowService);
  private readonly demo = inject(DemoService);

  private accountId = '';
  private incidentId = '';
  private request: Subscription | null = null;

  protected readonly report = signal<AccountIncidentReport | null>(null);
  /** `notFound` : autopsie retirée, inexistante ou d'un autre compte (404) ; `failed` : autre erreur. */
  protected readonly loadError = signal<'notFound' | 'failed' | null>(null);
  protected readonly ai = signal<IncidentAiState | null>(null);
  protected readonly aiLoading = signal(false);
  protected readonly dismissing = signal(false);
  protected readonly showPlanModal = signal(false);

  protected readonly headline = computed(() => (this.report() ? headline(this.report()!) : ''));
  protected readonly kpis = computed(() => (this.report() ? autopsyKpis(this.report()!) : []));
  protected readonly rows = computed(() => (this.report() ? autopsyRows(this.report()!) : []));
  protected readonly findings = computed(() => (this.report()?.findings ?? []).map(frenchSpacing));
  /**
   * Tracé calculé à la largeur RÉELLE de sa carte (un px du tracé = un px de l'écran) : à toute
   * largeur, textes à 11 px et libellé d'alerte placé sans chevauchement, jamais un SVG étiré.
   */
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chartWidth = signal(CHART_DEFAULT_WIDTH);
  /** Courbe masquée (place gardée) tant que sa carte n'est pas mesurée : jamais d'abord à 330 px. */
  protected readonly chartMeasured = signal(false);
  protected readonly chart = computed(() => (this.report() ? distanceChart(this.report()!, this.chartWidth()) : null));
  /** Vrai/faux seulement : la mesure ne se relance pas à chaque nouvelle largeur. */
  private readonly hasChart = computed(() => this.chart() !== null);
  protected readonly aiText = computed(() => {
    const a = this.ai();
    return a?.status === 'ready' ? { paragraphs: aiParagraphs(a.text), when: `${shortDay(a.generatedAt)} à ${clock(a.generatedAt)}` } : null;
  });
  protected readonly statusLabel = statusLabel;

  constructor() {
    // La carte apparaît avec le rapport : largeur lue juste après son rendu (avant d'être montrée),
    // puis suivie (sans le padding). Sans ResizeObserver, la courbe s'affiche à la largeur par défaut.
    afterRenderEffect((onCleanup) => {
      if (!this.hasChart()) return;
      const box = this.host.nativeElement.querySelector<HTMLElement>('.chart-box');
      if (!box) return;
      const measure = (w: number) => {
        if (w <= 0) return;
        if (w !== this.chartWidth()) this.chartWidth.set(w);
        this.chartMeasured.set(true);
      };
      untracked(() => measure(Math.round(box.clientWidth)));
      if (typeof ResizeObserver === 'undefined') {
        this.chartMeasured.set(true);
        return;
      }
      const ro = new ResizeObserver(([entry]) => measure(Math.round(entry.contentRect.width)));
      ro.observe(box);
      onCleanup(() => ro.disconnect());
    });
  }
  protected readonly statusBadgeClass = statusBadgeClass;

  ngOnInit(): void {
    // « Repartir sur une nouvelle tentative » ouvre la feuille du compte, qui le cherche dans la liste.
    if (!this.store.loaded() && !this.store.isLoading()) this.store.load();
    // Paramètres suivis (et pas lus une fois) : passer d'une autopsie à une autre réutilise la page.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.accountId = params.get('accountId') ?? '';
      this.incidentId = params.get('incidentId') ?? '';
      this.load();
    });
  }

  /**
   * Indépendant de la liste des comptes : seule la réponse de l'autopsie compte. 404 (ou adresse
   * mal formée, 400) : message neutre aussitôt. Autre erreur, ou pas de réponse au bout de
   * `AUTOPSY_TIMEOUT_MS` : état d'erreur avec « Réessayer », jamais un chargement sans fin.
   */
  protected load(): void {
    this.request?.unsubscribe();
    this.report.set(null);
    this.loadError.set(null);
    this.request = this.api
      .incident(this.accountId, this.incidentId)
      .pipe(timeout(AUTOPSY_TIMEOUT_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.report.set(res.data);
          this.ai.set(res.data.ai);
          if (res.data.ai.status === 'pending') this.loadAnalysis();
        },
        error: (err: unknown) =>
          this.loadError.set(err instanceof HttpErrorResponse && (err.status === 404 || err.status === 400) ? 'notFound' : 'failed'),
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

  /**
   * « Ce n'est pas un échec » : retire l'autopsie (définitif, jamais recréée) ; le serveur décide
   * de la réactivation. Confirmation d'abord : un tap ne suffit pas pour un geste sans retour.
   */
  protected async dismiss(): Promise<void> {
    const r = this.report();
    if (!r || this.dismissing()) return;
    // Démo en lecture seule : l'invite « Crée ton compte » dès le premier clic, sans confirmation.
    if (this.userStore.isDemo()) {
      this.demo.promptSignup();
      return;
    }
    const ok = await this.confirm.ask({
      title: "Retirer l'autopsie\u00a0?",
      message: r.canReactivate
        ? `Elle ne reviendra pas, et « ${r.account.label} » redeviendra actif (il compte de nouveau dans tes comptes actifs).`
        : 'Elle ne reviendra pas. Le statut du compte ne change pas.',
      confirmLabel: "Retirer l'autopsie",
    });
    if (!ok) return;
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
