import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { AdminApi, AiUsageData } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, gridAxis, noLegend } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-ai-usage',
  standalone: true,
  imports: [DecimalPipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-usage.component.css',
  templateUrl: './ai-usage.component.html',
})
export class AiUsageComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<AiUsageData | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  /** Libellé court d'un identifiant de modèle Anthropic. */
  protected modelLabel(model: string): string {
    if (model.includes('haiku')) return 'Haiku 4.5';
    if (model.includes('sonnet')) return 'Sonnet 4.6';
    if (model.includes('opus')) return 'Opus';
    return model;
  }

  /** Classe de la barre/pastille selon le modèle (Haiku en bleu, Sonnet en teal). */
  protected modelClass(model: string): string {
    return model.includes('haiku') ? 'haiku' : '';
  }

  /** Note de complétude : depuis la date de déploiement du logging IA, sinon générique. */
  protected readonly trackingNote = computed(() => {
    const s = this.data()?.trackingSince;
    return s ? `Tracking complet depuis le ${this.frDate(s)}` : 'Tracking complet depuis l\'activation du logging';
  });

  /** `2026-06-27` → `27/06/2026`. */
  private frDate(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  // Coût quotidien sur 30 jours (ligne) — aligné sur le mockup « Coût quotidien (30j) ».
  protected readonly dailyConfig = computed<ChartConfiguration>(() => {
    const d = this.data()?.daily ?? [];
    return {
      type: 'line',
      data: {
        labels: d.map((p) => this.shortDate(p.date)),
        datasets: [{
          label: 'Coût USD',
          data: d.map((p) => p.cost),
          borderColor: CHART_COLORS.amber,
          backgroundColor: (ctx: ScriptableContext<'line'>) => fade(ctx, CHART_COLORS.amber),
          fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true } } },
    } as ChartConfiguration;
  });

  private shortDate(iso: string): string {
    const [, m, day] = iso.split('-');
    return `${day}/${m}`;
  }

  constructor() {
    this.adminApi.aiUsage().pipe(
      catchError(() => { this.error.set(true); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.data.set(r.data); this.loading.set(false); });
  }
}
