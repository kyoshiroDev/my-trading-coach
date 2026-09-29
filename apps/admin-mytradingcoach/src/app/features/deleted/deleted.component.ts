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
  imports: [DatePipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './deleted.component.css',
  templateUrl: './deleted.component.html',
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

  // Libellé du mois courant (« juin 2026 ») : sans dépendance de locale enregistrée.
  private static readonly MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  protected readonly monthLabel = (() => {
    const d = new Date();
    return `${DeletedComponent.MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
  })();

  protected initials(a: DeletedAccount): string {
    return (a.name ?? a.email ?? '??').slice(0, 2).toUpperCase();
  }
  protected lifetime(days: number): string {
    return days <= 0 ? '< 1j' : `${days}j`;
  }
  /** Vrai si la suppression a eu lieu aujourd'hui (mise en évidence rouge, comme le mockup). */
  protected isDeletedToday(iso: string | null | undefined): boolean {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }
}