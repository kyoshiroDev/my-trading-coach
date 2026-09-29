import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import type { ChartConfiguration } from 'chart.js';
import { AdminApi, AdminAmbassador, AdminAmbassadorDetail, AdminAmbassadorPromoteResult } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, gridAxis, noLegend } from '../../shared/charts/chart-theme';
import { PRICING_EUR } from '../../core/constants/pricing.const';
import { apiErrorMessage } from '@mtc/shared';
import { ConfirmService, DialogDirective } from '@mtc/front-ui';

@Component({
  selector: 'mtc-admin-ambassadors',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogDirective, DatePipe, DecimalPipe, ChartCanvasComponent],
  styleUrl: './ambassadors.component.css',
  templateUrl: './ambassadors.component.html',
})
export class AmbassadorsComponent implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ambassadors = signal<AdminAmbassador[]>([]);
  protected readonly loading = signal(true);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedDetail = signal<AdminAmbassadorDetail | null>(null);
  protected readonly selectedAmbassador = signal<AdminAmbassador | null>(null);
  protected readonly paying = signal(false);
  protected readonly pricing = PRICING_EUR;

  // Ajout d'un ambassadeur
  protected readonly showAdd = signal(false);
  protected readonly addEmail = signal('');
  protected readonly addCode = signal('');
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);
  /** Échec du « marquer comme payé » : affiché au-dessus du tableau (avant : silencieux). */
  protected readonly payError = signal<string | null>(null);
  protected readonly addResult = signal<AdminAmbassadorPromoteResult | null>(null);
  protected readonly linkCopied = signal(false);

  // Retrait d'un ambassadeur
  protected readonly revokeTarget = signal<AdminAmbassador | null>(null);
  protected readonly revoking = signal(false);

  protected readonly totalReferrals = computed(() => this.ambassadors().reduce((s, a) => s + a.totalReferrals, 0));
  protected readonly totalPremium = computed(() => this.ambassadors().reduce((s, a) => s + a.premiumReferrals, 0));
  protected readonly totalPending = computed(() => this.ambassadors().reduce((s, a) => s + a.pendingPayout, 0));
  protected readonly totalPaid = computed(() => this.ambassadors().reduce((s, a) => s + a.totalEarned - a.pendingPayout, 0));

  protected readonly earningsConfig = computed<ChartConfiguration>(() => {
    const earnings = this.selectedDetail()?.earningsByMonth ?? {};
    const months = Object.entries(earnings).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      type: 'bar',
      data: { labels: months.map(([m]) => this.formatMonth(m)), datasets: [{ label: '€', data: months.map(([, v]) => v), backgroundColor: CHART_COLORS.purple, borderRadius: 4, barThickness: 22 }] },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true, ticks: { callback: (v) => '€' + v } } } },
    } as ChartConfiguration;
  });

  ngOnInit() { this.loadAmbassadors(); }

  private loadAmbassadors(): void {
    this.loading.set(true);
    this.api.getAmbassadors().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => { this.ambassadors.set(res.data); this.loading.set(false); if (res.data.length > 0) this.selectAmbassador(res.data[0]); },
      error: () => this.loading.set(false),
    });
  }

  protected selectAmbassador(amb: AdminAmbassador): void {
    this.selectedId.set(amb.id);
    this.selectedAmbassador.set(amb);
    this.selectedDetail.set(null);
    this.api.getAmbassadorDetail(amb.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (res) => this.selectedDetail.set(res.data) });
  }

  protected copyLink(code: string): void {
    navigator.clipboard.writeText(`https://mytradingcoach.app?ref=${code}`);
  }

  // ── Ajouter un ambassadeur ──────────────────────────────────────────────
  protected openAdd(): void {
    this.addEmail.set('');
    this.addCode.set('');
    this.addError.set(null);
    this.addResult.set(null);
    this.linkCopied.set(false);
    this.showAdd.set(true);
  }
  protected closeAdd(): void {
    this.showAdd.set(false);
  }
  protected submitAdd(): void {
    const email = this.addEmail().trim();
    if (!email || this.adding()) return;
    const code = this.addCode().trim() || undefined;
    this.adding.set(true);
    this.addError.set(null);
    this.api.promoteAmbassador(email, code).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.adding.set(false);
        this.addResult.set(res.data);
        this.loadAmbassadors();
      },
      error: (err: { status?: number; error?: { message?: string } }) => {
        this.adding.set(false);
        if (err.status === 404) this.addError.set('Aucun utilisateur avec cet email.');
        else if (err.status === 409) this.addError.set('Ce code est déjà utilisé, choisis-en un autre.');
        else this.addError.set(apiErrorMessage(err, 'Une erreur est survenue.'));
      },
    });
  }
  protected copyResultLink(link: string): void {
    navigator.clipboard.writeText(link);
    this.linkCopied.set(true);
  }

  // ── Retirer un ambassadeur ──────────────────────────────────────────────
  protected askRevoke(amb: AdminAmbassador): void {
    this.revokeTarget.set(amb);
  }
  protected cancelRevoke(): void {
    this.revokeTarget.set(null);
  }
  protected confirmRevoke(): void {
    const target = this.revokeTarget();
    if (!target || this.revoking()) return;
    this.revoking.set(true);
    this.api.revokeAmbassador(target.email).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.revoking.set(false);
        this.revokeTarget.set(null);
        this.loadAmbassadors();
      },
      error: () => this.revoking.set(false),
    });
  }

  protected async payAmbassador(amb: AdminAmbassador): Promise<void> {
    if (amb.pendingPayout === 0) return;
    const amount = amb.pendingPayout.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
    const confirmed = await this.confirm.ask({
      title: `Marquer ${amount} comme payé ?`,
      message: `Versement à ${amb.name ?? amb.email}. À faire uniquement une fois le virement envoyé : l'opération n'est pas annulable ici.`,
      confirmLabel: 'Marquer comme payé',
      danger: true,
    });
    if (!confirmed) return;
    this.paying.set(true);
    this.payError.set(null);
    this.api.markAmbassadorPaid(amb.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.paying.set(false); this.loadAmbassadors(); },
      error: (err) => {
        this.paying.set(false);
        this.payError.set(apiErrorMessage(err, `Le paiement de ${amount} n’a pas été enregistré. Réessaie.`));
      },
    });
  }
  protected paySelected(): void {
    const amb = this.selectedAmbassador();
    if (amb) this.payAmbassador(amb);
  }

  protected formatMonth(month: string): string {
    const [year, m] = month.split('-');
    return new Date(+year, +m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  }
}
