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
import {
  LucideDynamicIcon,
  LucideCalendarDays as CalendarDays,
  LucideRefreshCw as RefreshCw,
  LucideDownload as Download,
} from '@lucide/angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import { timer } from 'rxjs';
import { switchMap, map, takeWhile } from 'rxjs/operators';
import { DebriefApi } from '../../core/api/debrief.api';
import type { DebriefAccountSection as AccountSection, DebriefBadgeItem as DebriefItem, WeeklyDebrief } from '@mtc/shared';
import { ErrorStateComponent } from '@mtc/front-ui';

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

/** Badge de type compte (ÉVAL / FUNDED) : null pour les comptes perso. */
function typeBadge(type: string): { label: string; cls: string } | null {
  if (type === 'EVALUATION') return { label: 'ÉVAL', cls: 'eval' };
  if (type === 'FUNDED') return { label: 'FUNDED', cls: 'funded' };
  return null;
}

@Component({
  selector: 'mtc-debrief',
  imports: [
    ErrorStateComponent,
    DatePipe,
    DecimalPipe,
    LucideDynamicIcon,
    TopbarComponent,
    PlanModalComponent,
    PnlFormatPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './debrief.component.css',
  templateUrl: './debrief.component.html',
})
export class DebriefComponent {
  private readonly debriefApi = inject(DebriefApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  protected readonly userStore = inject(UserStore);
  protected readonly showPlanModal = signal(false);

  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly DownloadIcon = Download;

  protected readonly debrief = signal<WeeklyDebrief | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly isGenerating = signal(false);
  protected readonly exportLoading = signal(false);

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
    if (!this.userStore.isPremium()) {
      this.isLoading.set(false);
      return;
    }
    this.pollCurrent();
  }

  protected reload(): void {
    this.isLoading.set(true);
    this.pollCurrent();
  }

  /** Charge le débrief courant et interroge l'API toutes les 15 s tant qu'il est en génération. */
  private pollCurrent(): void {
    this.loadError.set(false);
    timer(0, 15_000)
      .pipe(
        switchMap(() =>
          this.debriefApi
            .getCurrent()
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
        error: () => {
          this.isLoading.set(false);
          this.loadError.set(true);
        },
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
    this.debriefApi
      .exportPdf(d.year, d.weekNumber)
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
        // AVANT : échec muet, le bouton se réactivait sans rien dire.
        error: () => {
          this.exportLoading.set(false);
          this.toast.error('Export PDF impossible pour le moment. Réessaie.');
        },
      });
  }

  generateDebrief() {
    if (this.isGenerating()) return;
    this.isGenerating.set(true);
    this.debriefApi
      .generate()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.debrief.set(res.data);
          this.isGenerating.set(false);
        },
        error: (err) => {
          this.isGenerating.set(false);
          this.toast.error(apiErrorMessage(err, 'Erreur lors de la génération du débrief'));
        },
      });
  }
}
