import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
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
  imports: [DatePipe, LucideAngularModule, TopbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mtc-topbar
      title="Weekly Debrief"
      [showAddButton]="true"
      addLabel="Générer le débrief"
      (addClick)="generateDebrief()"
    />

    <div class="content">
      @if (error()) {
        <div class="error-msg">{{ error() }}</div>
      }

      @if (isLoading()) {
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
          <button class="export-btn">
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
            <div class="stat-value" [class.text-green]="debrief()!.stats.winRate >= 50" [class.text-red]="debrief()!.stats.winRate < 50">
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
        <div class="ai-summary-block">
          <div class="ai-summary-label">
            <span class="ai-pulse"></span>
            Résumé IA de ta semaine
          </div>
          <p class="ai-summary-text">{{ debrief()!.aiSummary }}</p>
        </div>

        <!-- Strengths / Weaknesses -->
        <div class="two-cols">
          <div class="card">
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

          <div class="card">
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
        <div class="card">
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
    </div>
  `,
  styles: [`
    .content { padding: 28px; flex: 1; max-width: 1100px; }
    .loading { color: var(--text-2); padding: 2rem 0; }

    .error-msg {
      background: var(--red-dim);
      border: 1px solid var(--red);
      color: var(--red);
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 13px;
    }

    /* ─── Empty state ─── */
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text-2);
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .empty-state p { font-size: 15px; font-weight: 500; color: var(--text); margin-bottom: 4px; }
    .empty-state small { display: block; font-size: 12px; color: var(--text-3); margin-top: 4px; }

    /* ─── Debrief header ─── */
    .debrief-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 20px;
      gap: 16px;
    }

    .week-title {
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--text);
      margin-bottom: 4px;
    }

    .week-meta {
      font-size: 12px;
      color: var(--text-3);
      font-family: var(--font-mono);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .export-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-2);
      font-size: 13px;
      cursor: pointer;
      font-family: var(--font-body);
      transition: all 0.15s;
      white-space: nowrap;
    }

    .export-btn:hover { background: var(--bg-3); color: var(--text); border-color: var(--border-hover); }

    /* ─── Stats ─── */
    .stats-row {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }

    .stat-card {
      flex: 1;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
    }

    .stat-label {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-bottom: 6px;
    }

    .stat-value {
      font-family: var(--font-mono);
      font-size: 22px;
      font-weight: 500;
      color: var(--text);
    }

    .text-green { color: var(--green); }
    .text-red { color: var(--red); }

    /* ─── AI summary ─── */
    .ai-summary-block {
      background: linear-gradient(135deg, rgba(59,130,246,0.06), rgba(139,92,246,0.06));
      border: 1px solid rgba(99,155,255,0.15);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
      position: relative;
      overflow: hidden;
    }

    .ai-summary-block::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--blue), #8b5cf6, transparent);
      opacity: 0.4;
    }

    .ai-summary-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--blue-bright);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    .ai-pulse {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: var(--blue);
      animation: pulse 2s infinite;
      flex-shrink: 0;
    }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .ai-summary-text { font-size: 13.5px; color: var(--text); line-height: 1.7; }

    /* ─── Two cols ─── */
    .two-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }

    /* ─── Card ─── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
    }

    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }

    .card-title {
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    /* ─── Item rows ─── */
    .item-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 11px 0;
      border-bottom: 1px solid rgba(99,155,255,0.06);
    }

    .item-row:last-of-type { border-bottom: none; padding-bottom: 0; }

    .debrief-badge {
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .debrief-badge.red { background: var(--red-dim); color: var(--red); }
    .debrief-badge.amber { background: rgba(245,158,11,0.12); color: var(--yellow); }
    .debrief-badge.green { background: var(--green-dim); color: var(--green); }
    .debrief-badge.blue { background: var(--blue-glow); color: var(--blue-bright); }

    .item-text { font-size: 13px; color: var(--text-2); line-height: 1.5; }

    /* ─── Emotion block ─── */
    .emotion-block {
      background: linear-gradient(135deg, rgba(16,185,129,0.06), rgba(59,130,246,0.06));
      border: 1px solid rgba(16,185,129,0.15);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
    }

    /* ─── Objectives ─── */
    .obj-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 11px 0;
      border-bottom: 1px solid rgba(99,155,255,0.06);
    }

    .obj-row:last-child { border-bottom: none; padding-bottom: 0; }

    .obj-num {
      width: 22px; height: 22px;
      min-width: 22px;
      background: var(--blue-glow);
      border: 1px solid var(--blue);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--blue-bright);
      font-weight: 600;
      margin-top: 1px;
    }

    .obj-content { flex: 1; }
    .obj-title { font-size: 13px; color: var(--text); line-height: 1.4; margin-bottom: 3px; }
    .obj-meta { font-size: 11px; color: var(--text-3); font-family: var(--font-mono); }

    .empty { font-size: 13px; color: var(--text-3); padding: 8px 0; }
  `],
})
export class DebriefComponent implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly DownloadIcon = Download;

  protected readonly debrief = signal<WeeklyDebrief | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isGenerating = signal(false);
  protected readonly error = signal<string | null>(null);

  protected getBadgeClass(badge: string): string { return badgeClass(badge); }

  ngOnInit() {
    this.http.get<{ data: WeeklyDebrief | null }>(`${environment.apiUrl}/debrief/current`).subscribe({
      next: (res) => { this.debrief.set(res.data); this.isLoading.set(false); },
      error: () => this.isLoading.set(false),
    });
  }

  generateDebrief() {
    if (this.isGenerating()) return;
    this.isGenerating.set(true);
    this.error.set(null);
    this.http.post<{ data: WeeklyDebrief }>(`${environment.apiUrl}/debrief/generate`, {}).subscribe({
      next: (res) => { this.debrief.set(res.data); this.isGenerating.set(false); },
      error: (err) => {
        this.error.set(err.error?.message ?? 'Erreur lors de la génération du débrief');
        this.isGenerating.set(false);
      },
    });
  }
}