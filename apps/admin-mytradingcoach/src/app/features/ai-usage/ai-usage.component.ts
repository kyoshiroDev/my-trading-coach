import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { AdminApi, AiCostData } from '../../core/api/admin.api';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, gridAxis, noLegend } from '../../shared/charts/chart-theme';

@Component({
  selector: 'mtc-admin-ai-usage',
  imports: [DecimalPipe, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './ai-usage.component.css',
  templateUrl: './ai-usage.component.html',
})
export class AiUsageComponent {
  private readonly adminApi = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = signal<AiCostData | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  /**
   * Libellé court d'un identifiant de modèle Anthropic, version comprise :
   * 'claude-haiku-5-5' → 'Haiku 5.5', 'claude-haiku-4-5-20251001' → 'Haiku 4.5', 'claude-opus' → 'Opus'.
   */
  protected modelLabel(model: string): string {
    const m = model.match(/(haiku|sonnet|opus|fable|mythos)(?:-(\d+)(?:-(\d{1,2})(?!\d))?)?/);
    if (!m) return model;
    const [, family, major, minor] = m;
    const name = family[0].toUpperCase() + family.slice(1);
    return major ? `${name} ${major}${minor ? '.' + minor : ''}` : name;
  }

  /** Variante de barre/pastille (Haiku en bleu, Sonnet en teal). */
  protected modelClass(model: string): string {
    return model.includes('haiku') ? 'haiku' : '';
  }

  // Split du hero (réel) : Haiku vs Sonnet depuis la Cost API, toutes versions de la famille
  // additionnées (pendant une migration, 4.5 et 5.5 coexistent sur les 30 jours).
  protected readonly haikuBilled = computed(() => this.familyBilled('haiku'));
  protected readonly sonnetBilled = computed(() => this.familyBilled('sonnet'));

  private familyBilled(family: string): { costUsd: number; pct: number } | null {
    const rows = this.data()?.billed.byModel.filter((m) => m.model.includes(family)) ?? [];
    if (!rows.length) return null;
    return {
      costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
      pct: rows.reduce((s, r) => s + r.pct, 0),
    };
  }

  /** Bloc réel vide ET jamais rafraîchi → Cost API non configurée (clé Admin manquante). */
  protected readonly billedNotConfigured = computed(() => {
    const b = this.data()?.billed;
    return !!b && b.total30d === 0 && b.updatedAt === null;
  });

  /** « maj il y a Xh » depuis billed.updatedAt. */
  protected readonly updatedNote = computed(() => {
    const u = this.data()?.billed.updatedAt;
    if (!u) return 'Cost API non configurée';
    const h = Math.floor((Date.now() - new Date(u).getTime()) / 3_600_000);
    return h <= 0 ? 'maj à l’instant' : `maj il y a ${h} h`;
  });

  // Courbe du coût RÉEL par jour (teal, c'est du facturé, pas de l'estimation).
  protected readonly dailyConfig = computed<ChartConfiguration>(() => {
    const d = this.data()?.billed.daily ?? [];
    return {
      type: 'line',
      data: {
        labels: d.map((p) => this.frDateShort(p.date)),
        datasets: [{
          label: 'Coût réel USD',
          data: d.map((p) => p.costUsd),
          borderColor: CHART_COLORS.teal,
          backgroundColor: (ctx: ScriptableContext<'line'>) => fade(ctx, CHART_COLORS.teal),
          fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: { maintainAspectRatio: false, plugins: noLegend, scales: { x: { grid: { display: false } }, y: { grid: gridAxis, beginAtZero: true } } },
    } as ChartConfiguration;
  });

  private frDateShort(iso: string): string {
    const [, m, day] = iso.split('-');
    return `${day}/${m}`;
  }

  constructor() {
    this.adminApi.aiCost().pipe(
      catchError(() => { this.error.set(true); return of(null); }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { if (r) this.data.set(r.data); this.loading.set(false); });
  }
}
