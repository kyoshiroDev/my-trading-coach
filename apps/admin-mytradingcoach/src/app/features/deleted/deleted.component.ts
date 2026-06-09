import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { ChartConfiguration } from 'chart.js';
import { AdminApi, DeletedAccount, DeletedAccountsData } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, gridAxis, noLegend } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-deleted',
  standalone: true,
  imports: [DatePipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deleted.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Comptes supprimés</div>
        <span class="page-meta">infos conservées 90j puis anonymisées</span>
      </div>

      @if (data(); as d) {
        <div class="del-body">
          <div class="del-left">
            <div class="kpi-strip cols-2">
              <div class="kpi"><div class="kpi-top red"></div><div class="kpi-label">Supprimés ce mois</div><div class="kpi-value red">{{ d.stats.thisMonth }}</div><div class="kpi-sub">mois en cours</div></div>
              <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Total supprimés</div><div class="kpi-value amber">{{ d.stats.total }}</div><div class="kpi-sub">depuis le lancement</div></div>
              <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Durée de vie médiane</div><div class="kpi-value blue">{{ d.stats.medianLifetimeDays }}j</div><div class="kpi-sub">inscription → suppression</div></div>
              <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Partis sans trade</div><div class="kpi-value purple">{{ d.stats.noTradePct }}%</div><div class="kpi-sub">{{ d.stats.noTradeCount }} / {{ d.stats.total }} jamais tradé</div></div>
            </div>
            <div class="card grow">
              <div class="card-head"><span class="card-label">Suppressions par mois</span></div>
              <div class="card-body"><div class="chart-box"><mtc-chart [config]="monthConfig()" /></div></div>
            </div>
            <div class="card grow">
              <div class="card-head"><span class="card-label">Motifs de départ</span><span class="card-label muted">si renseigné</span></div>
              <div class="card-body"><div class="chart-box"><mtc-chart [config]="reasonConfig()" /></div></div>
            </div>
          </div>

          <div class="del-right">
            <div class="card fill">
              <div class="card-head"><span class="card-label">Historique des suppressions</span><span class="card-label muted">anonymisation auto après 90j</span></div>
              <table class="tbl">
                <thead><tr><th>Utilisateur</th><th>Inscrit le</th><th>Supprimé le</th><th>Durée de vie</th><th>Plan</th><th>A tradé</th><th>Parrainé par</th><th>Par</th><th>Motif</th></tr></thead>
                <tbody>
                  @for (a of d.accounts; track a.id) {
                    <tr>
                      <td data-label="Utilisateur"><div class="u-cell"><div class="u-av del-av">{{ initials(a) }}</div><div><div class="u-name">{{ a.name ?? 'anonymisé' }}</div><div class="u-mail">{{ a.email ?? '—' }}</div></div></div></td>
                      <td data-label="Inscrit le" class="td-mono muted">{{ a.signedUpAt | date:'dd/MM/yyyy' }}</td>
                      <td data-label="Supprimé le" class="td-mono">{{ a.deletedAt | date:'dd/MM/yyyy' }}</td>
                      <td data-label="Durée de vie" class="td-mono">{{ lifetime(a.lifetimeDays) }}</td>
                      <td data-label="Plan"><span class="badge" [class.b-premium]="a.plan==='PREMIUM'" [class.b-starter]="a.plan==='STARTER'" [class.b-free]="a.plan==='FREE'">{{ a.plan }}</span></td>
                      <td data-label="A tradé">@if (a.hadTraded) { <span class="badge b-ok">oui</span> } @else { <span class="badge b-free">jamais</span> }</td>
                      <td data-label="Parrainé par" class="td-mono" [class.muted]="!a.referredBy" [class.ref]="a.referredBy">{{ a.referredBy ?? '—' }}</td>
                      <td data-label="Par"><span class="role-tag">{{ a.deletedBy === 'self' ? 'utilisateur' : 'admin' }}</span></td>
                      <td data-label="Motif" class="td-mono" [class.muted]="!a.reason">{{ a.reason ?? '—' }}</td>
                    </tr>
                  } @empty {
                    <tr><td colspan="9" class="empty">Aucun compte supprimé</td></tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      } @else if (error()) {
        <div class="card"><div class="empty">⚠ {{ error() }}</div></div>
      } @else {
        <div class="card"><div class="empty">Chargement…</div></div>
      }
    </div>
  `,
})
export class DeletedComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<DeletedAccountsData | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly monthConfig = computed<ChartConfiguration>(() => {
    const b = this.data()?.byMonth ?? [];
    return {
      type: 'bar',
      data: { labels: b.map((m) => m.month), datasets: [{ label: 'Suppressions', data: b.map((m) => m.count), backgroundColor: CHART_COLORS.red, borderRadius: 4, barThickness: 26 }] },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true, ticks: { precision: 0 } } } },
    } as ChartConfiguration;
  });

  protected readonly reasonConfig = computed<ChartConfiguration>(() => {
    const r = this.data()?.byReason ?? [];
    const palette = [CHART_COLORS.text3, CHART_COLORS.amber, CHART_COLORS.purple, CHART_COLORS.blue, CHART_COLORS.teal, CHART_COLORS.green];
    return {
      type: 'doughnut',
      data: { labels: r.map((x) => x.reason), datasets: [{ data: r.map((x) => x.count), backgroundColor: r.map((_, i) => palette[i % palette.length]), borderColor: '#0c0e10', borderWidth: 2 }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 12 } } } },
    } as ChartConfiguration;
  });

  constructor() {
    this.api.deletedAccounts().pipe(
      catchError((e: unknown) => { this.error.set(e instanceof Error ? e.message : 'Erreur de chargement'); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.data.set(r.data); });
  }

  protected initials(a: DeletedAccount): string {
    return (a.name ?? a.email ?? '??').slice(0, 2).toUpperCase();
  }
  protected lifetime(days: number): string {
    return days <= 0 ? '< 1j' : `${days}j`;
  }
}