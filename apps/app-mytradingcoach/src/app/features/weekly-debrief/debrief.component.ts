import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserStore } from '../../core/stores/user.store';
import { DatePipe } from '@angular/common';
import { HttpClient, httpResource } from '@angular/common/http';
import { LucideAngularModule, CalendarDays, RefreshCw, Download } from 'lucide-angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { environment } from '../../../environments/environment';

interface DebriefItem { badge: string; text: string; }
interface Objective { title: string; reason: string; }
interface DebriefInsights {
  summary: string;
  strengths: DebriefItem[];
  weaknesses: DebriefItem[];
  emotionInsight: string;
  objectives: Objective[];
}
interface WeeklyDebrief {
  id: string;
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  aiSummary: string;
  insights: DebriefInsights;
  objectives: Objective[];
  stats: { winRate: number; totalPnl: number; totalTrades: number; };
  generatedAt: string;
}

function badgeClass(badge: string): string {
  const map: Record<string, string> = {
    'Force': 'green', 'Très bien': 'blue', 'Critique': 'red', 'Attention': 'amber',
  };
  return map[badge] ?? 'blue';
}

@Component({
  selector: 'mtc-debrief',
  standalone: true,
  imports: [DatePipe, RouterLink, LucideAngularModule, TopbarComponent, PlanModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './debrief.component.css',
  template: `
    <mtc-topbar
      title="Weekly Debrief"
      [showAddButton]="userStore.isPremium()"
      [addLabel]="isGenerating() ? 'Analyse en cours...' : 'Générer le débrief'"
      [addLoading]="isGenerating()"
      addTestId="debrief-generate-btn"
      (addClick)="generateDebrief()"
    />

    <div class="content">
      @if (!userStore.isPremium()) {
        <div data-testid="debrief-paywall" class="premium-paywall">
          <div class="paywall-icon">📅</div>
          <h3 class="paywall-title">Fonctionnalité Premium</h3>
          <p class="paywall-desc">Le Weekly Debrief est disponible avec le plan Premium.<br>Reçois chaque dimanche un rapport IA complet de ta semaine.</p>
          <button class="paywall-cta" (click)="showPlanModal.set(true)">Essayer 7 jours gratuit →</button>
        </div>
        @if (showPlanModal()) {
          <mtc-plan-modal (closed)="showPlanModal.set(false)" />
        }
      } @else {

      @if (error()) {
        <div class="error-msg">{{ error() }}</div>
      }

      @if (isGenerating()) {
        <div class="generating-state">
          <div class="generating-spinner"></div>
          <p class="generating-title">Analyse en cours...</p>
          <p class="generating-desc">L'IA analyse tes trades, émotions et patterns de la semaine.</p>
        </div>
      } @else if (isLoading()) {
        <div class="loading">Chargement du débrief...</div>
      } @else if (!debrief()) {
        <div class="empty-state">
          <lucide-icon [img]="CalendarDaysIcon" [size]="40" color="var(--text-3)" style="margin-bottom:16px" />
          <p>Aucun débrief pour cette semaine</p>
          <small>Clique sur "Générer le débrief" pour créer ton rapport IA</small>
          <small>Les debriefs sont générés automatiquement chaque dimanche à 23h</small>
        </div>
      } @else {

        <!-- Debrief header -->
        <div class="debrief-header">
          <div>
            <h2 class="week-title">Semaine {{ debrief()!.weekNumber }} — {{ debrief()!.year }}</h2>
            <div class="week-meta">
              <lucide-icon [img]="CalendarDaysIcon" [size]="12" color="var(--text-3)" />
              {{ debrief()!.startDate | date:'d MMM' }} → {{ debrief()!.endDate | date:'d MMM yyyy' }}
              · Généré le {{ debrief()!.generatedAt | date:'d MMM à HH:mm' }}
            </div>
          </div>
          <button class="export-btn" disabled title="Bientôt disponible">
            <lucide-icon [img]="DownloadIcon" [size]="13" />
            Export PDF
          </button>
        </div>

        <!-- Stats row -->
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-label">Trades</div>
            <div class="stat-value">{{ debrief()!.stats.totalTrades }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Win Rate</div>
            <div class="stat-value"
              [class.text-green]="debrief()!.stats.winRate >= 50"
              [class.text-red]="debrief()!.stats.winRate > 0 && debrief()!.stats.winRate < 50"
              [class.text-muted]="!debrief()!.stats.winRate">
              {{ debrief()!.stats.winRate.toFixed(1) }}%
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-label">P&amp;L</div>
            <div class="stat-value" [class.text-green]="debrief()!.stats.totalPnl >= 0" [class.text-red]="debrief()!.stats.totalPnl < 0">
              {{ debrief()!.stats.totalPnl >= 0 ? '+' : '' }}\${{ debrief()!.stats.totalPnl.toFixed(2) }}
            </div>
          </div>
        </div>

        <!-- AI Summary -->
        <div class="ai-summary-block" data-testid="debrief-summary">
          <div class="ai-summary-label">
            <span class="ai-pulse"></span>
            Résumé IA de ta semaine
          </div>
          <p class="ai-summary-text">{{ debrief()!.aiSummary }}</p>
        </div>

        <!-- Strengths / Weaknesses -->
        <div class="two-cols">
          <div class="card" data-testid="debrief-strengths">
            <div class="card-header">
              <div class="card-title">Forces de la semaine</div>
            </div>
            @for (s of debrief()!.insights.strengths; track s.text) {
              <div class="item-row strength">
                <span class="debrief-badge" [class]="getBadgeClass(s.badge)">{{ s.badge }}</span>
                <p class="item-text">{{ s.text }}</p>
              </div>
            }
            @if (!debrief()!.insights.strengths.length) {
              <p class="empty">Aucune force identifiée</p>
            }
          </div>

          <div class="card" data-testid="debrief-weaknesses">
            <div class="card-header">
              <div class="card-title">Points d'amélioration</div>
            </div>
            @for (w of debrief()!.insights.weaknesses; track w.text) {
              <div class="item-row weakness">
                <span class="debrief-badge" [class]="getBadgeClass(w.badge)">{{ w.badge }}</span>
                <p class="item-text">{{ w.text }}</p>
              </div>
            }
            @if (!debrief()!.insights.weaknesses.length) {
              <p class="empty">Aucun point d'amélioration identifié</p>
            }
          </div>
        </div>

        <!-- Emotion insight -->
        @if (debrief()!.insights.emotionInsight) {
          <div class="emotion-block">
            <div class="ai-summary-label">
              <span class="ai-pulse" style="background:var(--green)"></span>
              Émotion &amp; Performance
            </div>
            <p class="ai-summary-text">{{ debrief()!.insights.emotionInsight }}</p>
          </div>
        }

        <!-- Objectives -->
        <div class="card" data-testid="debrief-objectives">
          <div class="card-header">
            <div class="card-title">Objectifs semaine prochaine</div>
          </div>
          @for (obj of debrief()!.objectives; track obj.title; let i = $index) {
            <div class="obj-row">
              <div class="obj-num">{{ i + 1 }}</div>
              <div class="obj-content">
                <div class="obj-title">{{ obj.title }}</div>
                <div class="obj-meta">{{ obj.reason }}</div>
              </div>
            </div>
          }
          @if (!debrief()?.objectives?.length) {
            <p class="empty">Aucun objectif défini</p>
          }
        </div>
      }
      } <!-- end @else (premium) -->
    </div>
  `,
})
export class DebriefComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);

  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly DownloadIcon = Download;

  private readonly debriefResource = httpResource<{ data: WeeklyDebrief | null }>(
    () => `${environment.apiUrl}/debrief/current`
  );

  protected readonly debrief = linkedSignal<WeeklyDebrief | null>(
    () => this.debriefResource.value()?.data ?? null
  );
  protected readonly isLoading = computed(() => this.debriefResource.isLoading());
  protected readonly isGenerating = signal(false);
  protected readonly error = signal<string | null>(null);

  protected getBadgeClass(badge: string): string { return badgeClass(badge); }

  generateDebrief() {
    if (this.isGenerating()) return;
    this.isGenerating.set(true);
    this.error.set(null);
    this.http.post<{ data: WeeklyDebrief }>(`${environment.apiUrl}/debrief/generate`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (res) => { this.debrief.set(res.data); this.isGenerating.set(false); },
      error: (err) => {
        this.error.set(err.error?.message ?? 'Erreur lors de la génération du débrief');
        this.isGenerating.set(false);
      },
    });
  }
}