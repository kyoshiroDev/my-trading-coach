import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { TEST_ACQUISITION_PATTERNS, acquisitionQueryParams } from '@mtc/shared';
import type { ChartConfiguration } from 'chart.js';
import { AdminApi, AcquisitionData, FunnelData, LandingEngagementData, SignupFunnelData, SignupMethodsData } from '../../core/api/admin.api';
import { INSTALL_COLUMNS, demoSummary, funnelRows, installRows, placeLabel, placeRows, signupTrialTiles } from './funnel.util';
import { SIGNUP_COLUMNS, signupErrors, signupLines, signupTotal, type BrowserFilter } from './signup-funnel.util';
import { ENGAGEMENT_COLUMNS, engagementGroups } from './landing-engagement.util';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, gridAxis } from '../../shared/charts/chart-theme';

/**
 * Trafic de la landing (compteurs sans cookie) et acquisition par source :
 * visites → inscriptions → Premium (GET /admin/acquisition).
 */
@Component({
  selector: 'mtc-admin-acquisition',
  imports: [ChartCanvasComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './acquisition.component.css',
  templateUrl: './acquisition.component.html',
})
export class AcquisitionComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  /** Inscrits d'une ligne campagne → liste Utilisateurs filtrée sur ce triplet exact (#625). */
  protected readonly utmParams = acquisitionQueryParams;

  /**
   * « Inclure les tests » (#1029) : faux par défaut, les 5 blocs excluent les campagnes / sources de
   * test (`TEST_ACQUISITION_PATTERNS`) et les comptes internes et ADMIN. Vrai : chiffres bruts.
   */
  protected readonly includeTests = signal(false);
  protected readonly testPatterns = TEST_ACQUISITION_PATTERNS.join(', ');

  protected readonly data = signal<AcquisitionData | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Entonnoir Premium (GET /admin/funnel) : chargé à part, une panne ne masque pas l'acquisition. */
  protected readonly funnel = signal<FunnelData | null>(null);
  protected readonly funnelSteps = computed(() => funnelRows(this.funnel()));
  protected readonly funnelPlaces = computed(() => placeRows(this.funnel()));
  /** Essai Premium de l'inscription (#769, B3). */
  protected readonly trialTiles = computed(() => signupTrialTiles(this.funnel()));
  /** Installation de l'app par plateforme (même réponse que l'entonnoir). */
  protected readonly installs = computed(() => installRows(this.funnel()));
  protected readonly installColumns = INSTALL_COLUMNS;
  protected readonly placeLabel = placeLabel;
  /** Démo : ouvertures, bandeau vu, relance, clics par placement (#1029). */
  protected readonly demo = computed(() => demoSummary(this.funnel()));

  /** Inscriptions par méthode, e-mail / Google (GET /admin/signup-methods, #618) : chargé à part. */
  protected readonly methods = signal<SignupMethodsData | null>(null);
  protected readonly methodLabel = { EMAIL: 'Email', GOOGLE: 'Google' } as const;

  /** Parcours d'inscription par source (GET /admin/signup-funnel) : chargé à part, comme l'entonnoir. */
  protected readonly signupDays = signal<7 | 30>(30);
  protected readonly browser = signal<BrowserFilter>('all');
  protected readonly signup = signal<SignupFunnelData | null>(null);
  protected readonly signupLoading = signal(false);
  protected readonly signupColumns = SIGNUP_COLUMNS;
  protected readonly signupLines = computed(() => signupLines(this.signup(), this.browser()));
  protected readonly signupTotal = computed(() => signupTotal(this.signupLines()));
  protected readonly signupErrors = computed(() => signupErrors(this.signup()?.errors, this.browser()));
  protected readonly browserTabs: readonly { key: BrowserFilter; label: string }[] = [
    { key: 'all', label: 'Tous' },
    { key: 'inApp', label: 'Navigateur intégré' },
    { key: 'normal', label: 'Navigateur normal' },
  ];

  /** Engagement de / et /prop-firm (GET /admin/landing-engagement) : chargé à part, avec sa propre période. */
  protected readonly engagementDays = signal<7 | 30>(30);
  protected readonly engagement = signal<LandingEngagementData | null>(null);
  protected readonly engagementLoading = signal(false);
  protected readonly engagementColumns = ENGAGEMENT_COLUMNS;
  protected readonly engagementGroups = computed(() => engagementGroups(this.engagement()));

  /** Visites et pages vues par jour sur 30 jours. */
  protected readonly dailyConfig = computed<ChartConfiguration>(() => {
    const d = this.data()?.daily ?? [];
    return {
      type: 'line',
      data: {
        labels: d.map((x) => `${x.date.slice(8, 10)}/${x.date.slice(5, 7)}`),
        datasets: [
          { label: 'Visites', data: d.map((x) => x.visits), borderColor: CHART_COLORS.teal, backgroundColor: (ctx: never) => fade(ctx, CHART_COLORS.teal), fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 },
          { label: 'Pages vues', data: d.map((x) => x.pageviews), borderColor: CHART_COLORS.blue, fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.5, borderDash: [4, 4] },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } }, y: { grid: gridAxis, beginAtZero: true, ticks: { precision: 0 } } },
      },
    } as ChartConfiguration;
  });

  constructor() {
    this.loadAll();
  }

  /** Interrupteur « Inclure les tests » : recharge les 5 blocs avec ou sans les tests. */
  protected toggleTests(): void {
    this.includeTests.update((v) => !v);
    this.loadAll();
  }

  private loadAll(): void {
    const tests = this.includeTests();
    this.loadSignup(this.signupDays());
    this.loadEngagement(this.engagementDays());
    this.api.signupMethods(tests).pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r && tests === this.includeTests()) this.methods.set(r.data); });
    this.api.funnel(tests).pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r && tests === this.includeTests()) this.funnel.set(r.data); });
    this.api.acquisition(tests).pipe(
      catchError((e: unknown) => { this.error.set(e instanceof Error ? e.message : 'Erreur de chargement'); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r && tests === this.includeTests()) this.data.set(r.data); });
  }

  protected loadSignup(days: 7 | 30): void {
    this.signupDays.set(days);
    this.signupLoading.set(true);
    const tests = this.includeTests();
    this.api.signupFunnel(days, tests).pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      // Une réponse arrivée après un changement de période est ignorée.
      if (days === this.signupDays() && tests === this.includeTests()) {
        this.signup.set(r?.data ?? null);
        this.signupLoading.set(false);
      }
    });
  }

  protected loadEngagement(days: 7 | 30): void {
    this.engagementDays.set(days);
    this.engagementLoading.set(true);
    const tests = this.includeTests();
    this.api.landingEngagement(days, tests).pipe(
      catchError(() => of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      if (days === this.engagementDays() && tests === this.includeTests()) {
        this.engagement.set(r?.data ?? null);
        this.engagementLoading.set(false);
      }
    });
  }
}
