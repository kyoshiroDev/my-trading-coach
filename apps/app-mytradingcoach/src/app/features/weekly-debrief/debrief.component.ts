import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PlanModalComponent } from '../../shared/components/plan-modal/plan-modal.component';
import { PnlFormatPipe } from '../../shared/pipes/pnl-format.pipe';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserStore } from '../../core/stores/user.store';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule,
  CalendarDays,
  RefreshCw,
  Download,
} from 'lucide-angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { environment } from '../../../environments/environment';
import { timer } from 'rxjs';
import { switchMap, map, takeWhile } from 'rxjs/operators';

interface DebriefItem {
  badge: string;
  text: string;
}
interface Objective {
  title: string;
  reason: string;
}
interface AccountSection {
  accountId: string;
  name: string;
  type: string;
  status: string;
  stats: { totalTrades: number; winRate: number; totalPnl: number };
  rules: {
    startingBalance: number | null;
    profitTarget: number | null;
    maxDrawdown: number | null;
    drawdownType: string | null;
  } | null;
  summary: string;
  strengths: DebriefItem[];
  weaknesses: DebriefItem[];
  objectives: Objective[];
  propNote: string | null;
}
interface DebriefInsights {
  // Nouveau format (par compte)
  overview?: { summary: string };
  accounts?: AccountSection[];
  // Ancien format à plat (rétrocompat)
  summary?: string;
  strengths?: DebriefItem[];
  weaknesses?: DebriefItem[];
  emotionInsight?: string;
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
  stats: { winRate: number; totalPnl: number; totalTrades: number };
  generatedAt: string;
}

const TAB_KEY = 'mtc.debriefTab';

function badgeClass(badge: string): string {
  const map: Record<string, string> = {
    Force: 'green',
    'Très bien': 'blue',
    Critique: 'red',
    Attention: 'amber',
  };
  return map[badge] ?? 'blue';
}

/** Badge de type compte (ÉVAL / FUNDED) — null pour les comptes perso. */
function typeBadge(type: string): { label: string; cls: string } | null {
  if (type === 'EVALUATION') return { label: 'ÉVAL', cls: 'eval' };
  if (type === 'FUNDED') return { label: 'FUNDED', cls: 'funded' };
  return null;
}

@Component({
  selector: 'mtc-debrief',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    LucideAngularModule,
    TopbarComponent,
    PlanModalComponent,
    PnlFormatPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './debrief.component.css',
  template: `
    <mtc-topbar
      title="Weekly Debrief"
      [globalScopeNote]="true"
      [showAddButton]="userStore.isStarterOrAbove()"
      [addLabel]="isGenerating() ? 'Analyse en cours...' : 'Générer le débrief'"
      [addLoading]="isGenerating()"
      addTestId="debrief-generate-btn"
      (addClick)="generateDebrief()"
    />

    <div class="content">
      @if (!userStore.isStarterOrAbove()) {
        <div data-testid="debrief-paywall" class="premium-paywall">
          <div class="paywall-icon"><lucide-icon [img]="CalendarDaysIcon" [size]="40" /></div>
          <h3 class="paywall-title">Fonctionnalité Starter</h3>
          <p class="paywall-desc">
            Le Weekly Debrief est disponible avec le plan Starter.<br />Reçois
            chaque dimanche un rapport IA complet de ta semaine.
          </p>
          <button class="paywall-cta" (click)="showPlanModal.set(true)">
            Essayer 7 jours gratuit →
          </button>
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
            <p class="generating-desc">
              L'IA analyse tes trades par compte, en un seul passage.
            </p>
          </div>
        } @else if (isLoading()) {
          <div class="loading">Chargement du débrief...</div>
        } @else if (!debrief()) {
          <div class="empty-state">
            <lucide-icon
              [img]="CalendarDaysIcon"
              [size]="40"
              color="var(--text-3)"
              style="margin-bottom:16px"
            />
            <p>Aucun débrief pour cette semaine</p>
            <small>Clique sur "Générer le débrief" pour créer ton rapport IA</small>
            <small>Les debriefs sont générés automatiquement chaque dimanche à 23h</small>
          </div>
        } @else {
          <!-- Bandeau global -->
          <div class="debrief-banner">
            <span class="banner-diamond">◆</span>
            un débrief, un onglet par compte · 1 appel IA
          </div>

          <!-- Header -->
          <div class="debrief-header">
            <div>
              <h2 class="week-title">
                Semaine {{ debrief()!.weekNumber }} · {{ debrief()!.year }}
              </h2>
              <div class="week-meta">
                <lucide-icon [img]="CalendarDaysIcon" [size]="12" color="var(--text-3)" />
                {{ debrief()!.startDate | date: 'd MMM' }} →
                {{ debrief()!.endDate | date: 'd MMM yyyy' }} ·
                {{ debrief()!.stats.totalTrades }} trades ·
                {{ accounts().length }} compte(s) · Généré le
                {{ debrief()!.generatedAt | date: 'd MMM à HH:mm' }}
              </div>
            </div>
            @if (userStore.isStarterOrAbove()) {
              <button class="export-btn" [disabled]="exportLoading()" (click)="exportPDF()" title="Exporter en PDF">
                @if (exportLoading()) {
                  <span class="export-spinner"></span>
                } @else {
                  <lucide-icon [img]="DownloadIcon" [size]="13" />
                }
                Export PDF
              </button>
            }
          </div>

          <!-- Onglets -->
          <div class="debrief-tabs" data-testid="debrief-tabs">
            <button
              class="debrief-tab"
              [class.on]="resolvedTab() === 'overview'"
              data-testid="debrief-tab-overview"
              (click)="selectTab('overview')"
            >
              <span class="tab-pin" style="background:var(--violet, #8b5cf6)"></span>
              Vue d'ensemble
            </button>
            @for (a of accounts(); track a.accountId) {
              <button
                class="debrief-tab"
                [class.on]="resolvedTab() === a.accountId"
                [attr.data-testid]="'debrief-tab-' + a.accountId"
                (click)="selectTab(a.accountId)"
              >
                <span class="tab-pin" [style.background]="pinColor(a)"></span>
                {{ a.name }}
                @if (typeBadge(a.type); as tb) {
                  <span class="tab-badge {{ tb.cls }}">{{ tb.label }}</span>
                }
              </button>
            }
          </div>

          <!-- ── Panel Vue d'ensemble ── -->
          @if (resolvedTab() === 'overview') {
            <div class="ai-summary-block" data-testid="debrief-summary">
              <div class="ai-summary-label">
                <span class="ai-pulse"></span>
                Vue d'ensemble IA
              </div>
              <p class="ai-summary-text">{{ overviewSummary() }}</p>
            </div>

            @if (accounts().length) {
              <div class="card">
                <div class="card-header"><div class="card-title">Par compte en un coup d'œil</div></div>
                <div class="cmp">
                  @for (a of accounts(); track a.accountId) {
                    <div class="cmp-row">
                      <div class="cmp-name">
                        <span class="tab-pin" [style.background]="pinColor(a)"></span>{{ a.name }}
                        @if (typeBadge(a.type); as tb) { <span class="tab-badge {{ tb.cls }}">{{ tb.label }}</span> }
                      </div>
                      <div class="cmp-stat"><span class="cmp-l">Trades</span>{{ a.stats.totalTrades }}</div>
                      <div class="cmp-stat"><span class="cmp-l">Win rate</span>
                        @if (a.stats.totalTrades) { <span class="b">{{ a.stats.winRate.toFixed(1) }}%</span> } @else { <span class="muted">—</span> }
                      </div>
                      <div class="cmp-stat"><span class="cmp-l">P&amp;L</span>
                        <span [class.g]="a.stats.totalPnl >= 0" [class.r]="a.stats.totalPnl < 0">{{ a.stats.totalPnl | pnlFormat }}</span>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Forces / faiblesses à plat (ancien débrief) -->
            @if (legacyStrengths().length || legacyWeaknesses().length) {
              <div class="two-cols">
                <div class="card" data-testid="debrief-strengths">
                  <div class="card-header"><div class="card-title">Forces de la semaine</div></div>
                  @for (s of legacyStrengths(); track s.text) {
                    <div class="item-row strength"><span class="debrief-badge" [class]="getBadgeClass(s.badge)">{{ s.badge }}</span><p class="item-text">{{ s.text }}</p></div>
                  }
                </div>
                <div class="card" data-testid="debrief-weaknesses">
                  <div class="card-header"><div class="card-title">Points d'amélioration</div></div>
                  @for (w of legacyWeaknesses(); track w.text) {
                    <div class="item-row weakness"><span class="debrief-badge" [class]="getBadgeClass(w.badge)">{{ w.badge }}</span><p class="item-text">{{ w.text }}</p></div>
                  }
                </div>
              </div>
            }

            @if (emotionInsight()) {
              <div class="emotion-block">
                <div class="ai-summary-label"><span class="ai-pulse" style="background:var(--green)"></span>Émotion &amp; Performance</div>
                <p class="ai-summary-text">{{ emotionInsight() }}</p>
              </div>
            }

            <!-- Objectifs globaux suivis -->
            <div class="card" data-testid="debrief-objectives">
              <div class="card-header"><div class="card-title">Objectifs de la semaine</div></div>
              @for (obj of debrief()!.objectives; track obj.title; let i = $index) {
                <div class="obj-row"><div class="obj-num">{{ i + 1 }}</div><div class="obj-content"><div class="obj-title">{{ obj.title }}</div><div class="obj-meta">{{ obj.reason }}</div></div></div>
              }
              @if (!debrief()?.objectives?.length) { <p class="empty">Aucun objectif défini</p> }
            </div>
          }

          <!-- ── Panel compte ── -->
          @if (activeAccount(); as a) {
            <div class="stats-row">
              <div class="stat-card"><div class="stat-label">Trades</div><div class="stat-value">{{ a.stats.totalTrades }}</div></div>
              @if (isProp(a) && a.rules) {
                <div class="stat-card"><div class="stat-label">Objectif</div><div class="stat-value small">{{ a.rules.profitTarget !== null ? (a.rules.profitTarget | number) + ' $' : '—' }}</div></div>
                <div class="stat-card"><div class="stat-label">Drawdown max</div><div class="stat-value small text-amber">{{ a.rules.maxDrawdown !== null ? (a.rules.maxDrawdown | number) + ' $' : '—' }}</div></div>
              } @else {
                <div class="stat-card"><div class="stat-label">Win Rate</div>
                  <div class="stat-value" [class.text-green]="a.stats.winRate >= 50" [class.text-red]="a.stats.winRate > 0 && a.stats.winRate < 50" [class.text-muted]="!a.stats.totalTrades">
                    {{ a.stats.totalTrades ? a.stats.winRate.toFixed(1) + '%' : '—' }}
                  </div>
                </div>
                <div class="stat-card"><div class="stat-label">P&amp;L</div><div class="stat-value" [class.text-green]="a.stats.totalPnl >= 0" [class.text-red]="a.stats.totalPnl < 0">{{ a.stats.totalPnl | pnlFormat }}</div></div>
              }
            </div>

            @if (a.summary) {
              <div class="ai-summary-block">
                <div class="ai-summary-label"><span class="ai-pulse"></span>Analyse du compte</div>
                <p class="ai-summary-text">{{ a.summary }}</p>
              </div>
            }

            <div class="two-cols">
              <div class="card">
                <div class="card-header"><div class="card-title">Forces</div></div>
                @for (s of a.strengths; track s.text) {
                  <div class="item-row strength"><span class="debrief-badge" [class]="getBadgeClass(s.badge)">{{ s.badge }}</span><p class="item-text">{{ s.text }}</p></div>
                }
                @if (!a.strengths.length) { <p class="empty">Pas de force identifiée ce compte</p> }
              </div>
              <div class="card">
                <div class="card-header"><div class="card-title">Points d'amélioration</div></div>
                @for (w of a.weaknesses; track w.text) {
                  <div class="item-row weakness"><span class="debrief-badge" [class]="getBadgeClass(w.badge)">{{ w.badge }}</span><p class="item-text">{{ w.text }}</p></div>
                }
                @if (!a.weaknesses.length) { <p class="empty">Rien à corriger ce compte</p> }
              </div>
            </div>

            @if (a.propNote) {
              <div class="propfirm-note" data-testid="debrief-propnote">
                <span class="propfirm-ic">⚠</span>
                <p>{{ a.propNote }}</p>
              </div>
            }

            <div class="card">
              <div class="card-header"><div class="card-title">Objectifs sur ce compte</div></div>
              @for (obj of a.objectives; track obj.title; let i = $index) {
                <div class="obj-row"><div class="obj-num">{{ i + 1 }}</div><div class="obj-content"><div class="obj-title">{{ obj.title }}</div><div class="obj-meta">{{ obj.reason }}</div></div></div>
              }
              @if (!a.objectives.length) { <p class="empty">Aucun objectif spécifique</p> }
            </div>
          }
        }
      }
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

  protected readonly debrief = signal<WeeklyDebrief | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly isGenerating = signal(false);
  protected readonly exportLoading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly activeTab = signal<string>(this.readTab());

  private readonly insights = computed(() => this.debrief()?.insights ?? null);
  protected readonly accounts = computed<AccountSection[]>(() => this.insights()?.accounts ?? []);
  protected readonly overviewSummary = computed(
    () => this.insights()?.overview?.summary ?? this.debrief()?.aiSummary ?? this.insights()?.summary ?? '',
  );
  protected readonly emotionInsight = computed(() => this.insights()?.emotionInsight ?? '');
  protected readonly legacyStrengths = computed<DebriefItem[]>(() => this.insights()?.strengths ?? []);
  protected readonly legacyWeaknesses = computed<DebriefItem[]>(() => this.insights()?.weaknesses ?? []);

  /** Onglet effectif : retombe sur « overview » si le compte persisté n'existe plus. */
  protected readonly resolvedTab = computed(() => {
    const t = this.activeTab();
    if (t === 'overview') return 'overview';
    return this.accounts().some((a) => a.accountId === t) ? t : 'overview';
  });
  protected readonly activeAccount = computed<AccountSection | null>(() => {
    const t = this.resolvedTab();
    return t === 'overview' ? null : this.accounts().find((a) => a.accountId === t) ?? null;
  });

  constructor() {
    if (!this.userStore.isStarterOrAbove()) {
      this.isLoading.set(false);
      return;
    }
    timer(0, 15_000)
      .pipe(
        switchMap(() =>
          this.http
            .get<{ data: WeeklyDebrief | null }>(`${environment.apiUrl}/debrief/current`)
            .pipe(map((res) => res.data)),
        ),
        takeWhile((d) => d === null, true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.debrief.set(data);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  protected selectTab(id: string): void {
    this.activeTab.set(id);
    try { localStorage.setItem(TAB_KEY, id); } catch { /* préférence non persistée */ }
  }
  private readTab(): string {
    try { return localStorage.getItem(TAB_KEY) || 'overview'; } catch { return 'overview'; }
  }

  protected getBadgeClass(badge: string): string {
    return badgeClass(badge);
  }
  protected typeBadge(type: string): { label: string; cls: string } | null {
    return typeBadge(type);
  }
  protected isProp(a: AccountSection): boolean {
    return a.type === 'EVALUATION' || a.type === 'FUNDED';
  }
  protected pinColor(a: AccountSection): string {
    return this.isProp(a) ? 'var(--yellow)' : 'var(--blue-bright)';
  }

  exportPDF() {
    const d = this.debrief();
    if (!d || this.exportLoading()) return;
    this.exportLoading.set(true);
    this.http
      .get(`${environment.apiUrl}/debrief/${d.year}/${d.weekNumber}/pdf`, { responseType: 'blob' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `debrief-s${d.weekNumber}-${d.year}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          this.exportLoading.set(false);
        },
        error: () => this.exportLoading.set(false),
      });
  }

  generateDebrief() {
    if (this.isGenerating()) return;
    this.isGenerating.set(true);
    this.error.set(null);
    this.http
      .post<{ data: WeeklyDebrief }>(`${environment.apiUrl}/debrief/generate`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.debrief.set(res.data);
          this.isGenerating.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.message ?? 'Erreur lors de la génération du débrief');
          this.isGenerating.set(false);
        },
      });
  }
}
