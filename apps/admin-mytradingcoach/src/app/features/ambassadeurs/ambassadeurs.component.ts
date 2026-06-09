import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import type { ChartConfiguration } from 'chart.js';
import { AdminApi, AdminAmbassador, AdminAmbassadorDetail } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, gridAxis, noLegend } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-ambassadeurs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, ChartCanvasComponent],
  styleUrl: './ambassadeurs.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Ambassadeurs</div>
      </div>

      <div class="kpi-strip">
        <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Ambassadeurs</div><div class="kpi-value purple">{{ ambassadors().length }}</div><div class="kpi-sub">actifs</div></div>
        <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Total référés</div><div class="kpi-value blue">{{ totalReferrals() }}</div><div class="kpi-sub">via liens</div></div>
        <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Référés Starter</div><div class="kpi-value amber">{{ totalStarter() }}</div><div class="kpi-sub">39€/mois</div></div>
        <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Référés Premium</div><div class="kpi-value blue">{{ totalPremium() }}</div><div class="kpi-sub">79€/mois</div></div>
        <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Commissions dues</div><div class="kpi-value amber">{{ totalPending() | number:'1.2-2' }}€</div><div class="kpi-sub">à verser</div></div>
        <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">Total payé</div><div class="kpi-value teal">{{ totalPaid() | number:'1.2-2' }}€</div><div class="kpi-sub">versé</div></div>
      </div>

      <div class="card">
        <div class="card-head"><span class="card-label">Ambassadeurs</span><span class="card-action" (click)="copyCommand()">⧉ Copier SQL ajout</span></div>
        @if (loading()) {
          <div class="empty">Chargement…</div>
        } @else if (ambassadors().length === 0) {
          <div class="empty">Aucun ambassadeur configuré</div>
        } @else {
          <table class="tbl">
            <thead><tr><th>Ambassadeur</th><th>Code / Lien</th><th>Taux</th><th>Référés</th><th>Starter / Prem.</th><th class="num">Dû</th><th class="num">Total payé</th><th class="actions-col">Actions</th></tr></thead>
            <tbody>
              @for (amb of ambassadors(); track amb.id) {
                <tr [class.row-selected]="selectedId() === amb.id" (click)="selectAmbassador(amb)">
                  <td data-label="Ambassadeur"><div class="u-cell"><div class="u-av amb-av">{{ (amb.name || amb.email).slice(0,2).toUpperCase() }}</div><div><div class="u-name">{{ amb.name ?? '—' }}</div><div class="u-mail">{{ amb.email }}</div></div></div></td>
                  <td data-label="Code / Lien"><div class="code-cell"><span class="pill teal-pill">{{ amb.referralCode }}</span><button class="pill" (click)="$event.stopPropagation(); copyLink(amb.referralCode)">Copier lien</button></div><div class="amb-link">mytradingcoach.app?ref={{ amb.referralCode }}</div></td>
                  <td data-label="Taux" class="td-mono blue">20%</td>
                  <td data-label="Référés" class="td-mono">{{ amb.totalReferrals }}</td>
                  <td data-label="Starter / Prem." class="td-mono">{{ amb.starterReferrals }} S / {{ amb.premiumReferrals }} P</td>
                  <td data-label="Dû" class="td-mono num amber">{{ amb.pendingPayout | number:'1.2-2' }}€</td>
                  <td data-label="Total payé" class="td-mono num">{{ (amb.totalEarned - amb.pendingPayout) | number:'1.2-2' }}€</td>
                  <td data-label="Actions"><div class="row-actions"><button class="btn pay-btn" [disabled]="amb.pendingPayout === 0" (click)="$event.stopPropagation(); payAmbassador(amb)">✓ Payer</button></div></td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      @if (selectedDetail(); as detail) {
        <div class="card fill">
          <div class="card-head"><span class="card-label">Détail — {{ selectedAmbassador()?.name ?? selectedAmbassador()?.email }}</span>
            <button class="btn" [disabled]="detail.pendingPayout === 0 || paying()" (click)="paySelected()">{{ paying() ? 'En cours…' : '✓ Marquer tout payé (' + (detail.pendingPayout | number:'1.2-2') + '€)' }}</button></div>
          <div class="card-body">
            <div class="mini-stats">
              <div class="mini"><span class="mini-v blue">{{ detail.total }}</span><span class="mini-l">Inscrits</span></div>
              <div class="mini"><span class="mini-v green">{{ detail.premium }}</span><span class="mini-l">Premium</span></div>
              <div class="mini"><span class="mini-v">{{ detail.starter }}</span><span class="mini-l">Starter</span></div>
              <div class="mini"><span class="mini-v">{{ detail.free }}</span><span class="mini-l">Free</span></div>
              <div class="mini"><span class="mini-v amber">{{ detail.pendingPayout | number:'1.2-2' }}€</span><span class="mini-l">À payer</span></div>
              <div class="mini"><span class="mini-v green">{{ detail.totalEarned | number:'1.2-2' }}€</span><span class="mini-l">Total gagné</span></div>
            </div>

            <div class="grid-2">
              <div>
                <div class="card-label sect">Gains par mois</div>
                <div class="chart-box amb-chart"><mtc-chart [config]="earningsConfig()" /></div>
              </div>
              <div>
                <div class="card-label sect">Référés ({{ detail.referrals.length }})</div>
                @if (detail.referrals.length === 0) {
                  <div class="empty">Aucun référé encore</div>
                } @else {
                  <table class="tbl ref-tbl">
                    <thead><tr><th>Email</th><th>Plan</th><th>Actif</th><th>Inscrit</th></tr></thead>
                    <tbody>
                      @for (ref of detail.referrals; track ref.id) {
                        <tr>
                          <td data-label="Email" class="td-mono">{{ ref.email }}</td>
                          <td data-label="Plan"><span class="badge" [class.b-premium]="ref.plan==='PREMIUM'" [class.b-starter]="ref.plan==='STARTER'" [class.b-free]="ref.plan==='FREE'">{{ ref.plan }}</span></td>
                          <td data-label="Actif"><span [class.act-on]="ref.isActive" [class.act-off]="!ref.isActive">{{ ref.isActive ? '✓' : '—' }}</span></td>
                          <td data-label="Inscrit" class="td-mono muted">{{ ref.createdAt | date:'dd/MM/yyyy' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            </div>

            <div class="sql-wrap">
              <div class="card-label sect">SQL — marquer payé manuellement</div>
              <div class="sql-block"><span class="kw">UPDATE</span> <span class="str">"ReferralCommission"</span> <span class="kw">SET</span> status = <span class="str">'paid'</span><br><span class="kw">WHERE</span> "ambassadorId" = <span class="str">'{{ selectedId() }}'</span><br><span class="kw">AND</span> status = <span class="str">'pending'</span>;</div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class AmbassadeursComponent implements OnInit {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly ambassadors = signal<AdminAmbassador[]>([]);
  protected readonly loading = signal(true);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedDetail = signal<AdminAmbassadorDetail | null>(null);
  protected readonly selectedAmbassador = signal<AdminAmbassador | null>(null);
  protected readonly paying = signal(false);

  protected readonly totalReferrals = computed(() => this.ambassadors().reduce((s, a) => s + a.totalReferrals, 0));
  protected readonly totalStarter = computed(() => this.ambassadors().reduce((s, a) => s + a.starterReferrals, 0));
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
  protected copyCommand(): void {
    navigator.clipboard.writeText(`UPDATE "User" SET role = 'AMBASSADOR', "referralCode" = 'CODE' WHERE email = 'email@exemple.com';`);
  }

  protected payAmbassador(amb: AdminAmbassador): void {
    if (amb.pendingPayout === 0) return;
    if (!confirm(`Marquer ${amb.pendingPayout.toFixed(2)}€ comme payé à ${amb.name ?? amb.email} ?`)) return;
    this.paying.set(true);
    this.api.markAmbassadorPaid(amb.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.paying.set(false); this.loadAmbassadors(); },
      error: () => this.paying.set(false),
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
