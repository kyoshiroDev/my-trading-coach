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
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { UserStore } from '../../core/stores/user.store';
import { DatePipe } from '@angular/common';
import {
  LucideDynamicIcon,
  LucideCalendarDays as CalendarDays,
  LucideRefreshCw as RefreshCw,
  LucideDownload as Download,
  LucideChevronDown as ChevronDown,
} from '@lucide/angular';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { ToastService } from '../../core/services/toast.service';
import { apiErrorMessage } from '../../core/utils/api-error';
import { map } from 'rxjs/operators';
import { DebriefApi } from '../../core/api/debrief.api';
import type { DebriefAccountSection as AccountSection, DebriefBadgeItem as DebriefItem, DebriefHistoryItem, WeeklyDebrief } from '@mtc/shared';
import { ErrorStateComponent, PctPipe } from '@mtc/front-ui';
import { InfoTooltipComponent } from '@app/shared/components/info-tooltip/info-tooltip.component';
import { DRAWDOWN_LABELS } from '@app/core/constants/drawdown-labels.const';
import { PaywallCtaService } from '@app/core/services/paywall-cta.service';
import { DebriefBehaviorAlertsComponent } from './debrief-behavior-alerts.component';
import { BehaviorAlertsStore } from '@app/core/stores/behavior-alerts.store';

const TAB_KEY = 'mtc.debriefTab';

/** Clé d'une semaine dans le sélecteur (#959). */
function weekKey(w: { year: number; weekNumber: number }): string {
  return `${w.year}-${w.weekNumber}`;
}

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
  imports: [PctPipe,
    ErrorStateComponent,
    InfoTooltipComponent,
    DatePipe,
    LucideDynamicIcon,
    TopbarComponent,
    PlanModalComponent,
    PnlFormatPipe,
    MoneyPipe,
    DebriefBehaviorAlertsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './debrief.component.css',
  templateUrl: './debrief.component.html',
})
export class DebriefComponent {
  /** Libellé unique des boutons de paywall (E3 #1013). */
  protected readonly paywall = inject(PaywallCtaService);
  /** Vocabulaire du drawdown (règle / marge / drawdown max), commun à tous les écrans. */
  protected readonly ddLabels = DRAWDOWN_LABELS;
  private readonly debriefApi = inject(DebriefApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  protected readonly userStore = inject(UserStore);
  private readonly accountStore = inject(SelectedAccountStore);
  protected readonly showPlanModal = signal(false);
  /** Alertes de comportement (#671) : bloc « Alertes de la semaine » si `BEHAVIOR_ALERTS_UI` est allumé. */
  protected readonly behaviorAlerts = inject(BehaviorAlertsStore);

  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly DownloadIcon = Download;
  protected readonly ChevronDownIcon = ChevronDown;

  protected readonly debrief = signal<WeeklyDebrief | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal(false);
  protected readonly isGenerating = signal(false);
  protected readonly exportLoading = signal(false);

  /** Débriefs passés (#959) : semaines du sélecteur, la plus récente en premier. */
  protected readonly history = signal<DebriefHistoryItem[]>([]);
  protected readonly weekLoading = signal(false);
  /** Numéro de la dernière demande d'affichage : une semaine chargée après une génération est ignorée. */
  private viewSeq = 0;
  /** Semaine affichée, au format du sélecteur (`année-semaine`). */
  protected readonly selectedWeek = computed(() => {
    const d = this.debrief();
    return d ? weekKey(d) : '';
  });

  protected readonly activeTab = signal<string>(this.readTab());

  private readonly insights = computed(() => this.debrief()?.insights ?? null);
  protected readonly accounts = computed<AccountSection[]>(() => this.insights()?.accounts ?? []);
  protected readonly overviewSummary = computed(
    () => this.insights()?.overview?.summary ?? this.debrief()?.aiSummary ?? this.insights()?.summary ?? '',
  );
  protected readonly emotionInsight = computed(() => this.insights()?.emotionInsight ?? '');
  /**
   * Bouclier annonces (#670) : deux lignes par compte qui a au moins un trade autour d'une annonce
   * (P&L dans la devise du compte, #947). Absent des anciens débriefs ou sans trade dans une fenêtre :
   * bloc masqué.
   */
  protected readonly newsWindow = computed(() => {
    const w = this.debrief()?.stats.newsWindow;
    if (!w?.accounts) return null;
    const names = new Map(this.accounts().map((a) => [a.accountId, a.name]));
    const rows = w.accounts
      .filter((a) => a.inside.count > 0)
      .flatMap((a) => {
        const name = (a.accountId && names.get(a.accountId)) || 'Sans compte';
        return [
          { key: `${a.accountId}-inside`, label: `${name} · autour des annonces`, b: a.inside, accountId: a.accountId },
          { key: `${a.accountId}-outside`, label: `${name} · reste de la semaine`, b: a.outside, accountId: a.accountId },
        ];
      });
    return rows.length ? { windowMinutes: w.windowMinutes, rows } : null;
  });
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
    // Devise de chaque compte des onglets (`money` / `pnlFormat` par accountId) : comptes chargés
    // même en ouverture directe de /debrief, sinon repli sur l'USD par défaut (#947).
    if (!this.accountStore.loaded() && !this.accountStore.isLoading()) this.accountStore.load();
    this.behaviorAlerts.loadConfig();
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

  /**
   * Charge le débrief courant, une fois (F6 #1047). `null` veut dire « aucun débrief encore », pas
   * « en génération » : l'ancien relevé toutes les 15 s tournait sans fin, onglet caché compris.
   * Le débrief manuel revient dans la réponse de `generate`.
   */
  private pollCurrent(): void {
    this.loadError.set(false);
    this.debriefApi
      .getCurrent()
      .pipe(
        map((res) => res.data),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.debrief.set(data);
          this.isLoading.set(false);
          if (data) this.loadHistory(); // null = aucun débrief du tout : rien à lister
        },
        error: () => {
          this.isLoading.set(false);
          this.loadError.set(true);
        },
      });
  }

  /**
   * Semaines disponibles (#959). En échec, le sélecteur reste masqué et un toast le dit : le débrief
   * affiché reste juste, pas d'écran d'erreur à sa place.
   */
  private loadHistory(): void {
    this.debriefApi
      .getHistory()
      .pipe(map((res) => res.data), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => this.history.set(items),
        error: () => {
          this.history.set([]);
          this.toast.error('Les semaines passées n’ont pas pu être chargées. Recharge la page pour les retrouver.');
        },
      });
  }

  /** Affiche le débrief d'une semaine passée (#959) ; l'export PDF suit la semaine affichée. */
  protected selectWeek(key: string): void {
    const item = this.history().find((h) => weekKey(h) === key);
    if (!item || key === this.selectedWeek() || this.weekLoading()) return;
    this.weekLoading.set(true);
    const seq = ++this.viewSeq;
    this.debriefApi
      .getByWeek(item.year, item.weekNumber)
      .pipe(map((res) => res.data), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.weekLoading.set(false);
          if (seq === this.viewSeq) this.debrief.set(data); // sinon un débrief vient d'être généré
        },
        error: () => {
          this.weekLoading.set(false);
          this.toast.error(`Le débrief de la semaine ${item.weekNumber} n’a pas pu être chargé. Réessaie.`);
        },
      });
  }

  protected weekKey(w: { year: number; weekNumber: number }): string {
    return weekKey(w);
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
    this.viewSeq++; // une semaine passée en cours de chargement ne remplacera pas le débrief généré
    this.debriefApi
      .generate()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.debrief.set(res.data);
          this.isGenerating.set(false);
          this.loadHistory(); // la semaine en cours vient peut-être d'être créée
        },
        error: (err) => {
          this.isGenerating.set(false);
          this.toast.error(apiErrorMessage(err, 'Erreur lors de la génération du débrief'));
        },
      });
  }
}
