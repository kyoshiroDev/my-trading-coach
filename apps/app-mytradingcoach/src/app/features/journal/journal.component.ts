import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, effect, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { computeTradeStats } from '../../core/utils/trade-stats.util';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { LucideAngularModule, X, Pencil, Upload, ChevronDown, ChevronRight, Calendar, Trash2, ArrowRightLeft } from 'lucide-angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import { SelectedAccountStore } from '../../core/stores/selected-account.store';
import { SetupsStore } from '../../core/stores/setups.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from './trade-form.component';
import { CsvImportComponent } from './csv-import.component';
import { PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe } from '../../shared/pipes';
import { InfoTooltipComponent } from '../../shared/components/info-tooltip/info-tooltip.component';
import { environment } from '../../../environments/environment';

type FilterSide = 'ALL' | 'LONG' | 'SHORT';
type FilterResult = 'ALL' | 'WIN' | 'LOSS' | 'BREAKEVEN';
type FilterExecution = 'ALL' | 'EXCELLENT' | 'BON' | 'MOYEN' | 'MAUVAIS' | 'NONE';
type FilterEmotion =
  | 'ALL' | 'CONFIDENT' | 'FOCUSED' | 'NEUTRAL' | 'STRESSED'
  | 'REVENGE' | 'FEAR' | 'TIRED' | 'NONE';
type DatePreset = 'today' | 'week' | 'month' | 'custom' | 'all';

interface DayGroup {
  key: string;
  label: string;
  trades: Trade[];
  totalPnl: number;
  totalPnlNet: number;
  totalCommission: number;
  count: number;
  winCount: number;
}

interface WeekGroup {
  key: string;        // clé stable = lundi ISO de la semaine (ex. 'week-2026-07-06')
  label: string;      // 'Semaine du 06/07/2026 au 12/07/2026'
  days: DayGroup[];   // jours de la semaine, du plus récent au plus ancien
  count: number;
  winCount: number;
  totalPnl: number;
  totalPnlNet: number;
  totalCommission: number;
}

@Component({
  selector: 'mtc-journal',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, TitleCasePipe, LucideAngularModule,
    TopbarComponent, TradeFormComponent, CsvImportComponent,
    PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe, InfoTooltipComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './journal.component.css',
  templateUrl: './journal.component.html',
})
export class JournalComponent {
  protected readonly tradesStore = inject(TradesStore);
  private readonly tradesApi     = inject(TradesApi);
  private readonly http          = inject(HttpClient);
  private readonly destroyRef    = inject(DestroyRef);
  private readonly selectedAccount = inject(SelectedAccountStore);
  protected readonly setupsStore = inject(SetupsStore);

  constructor() {
    this.setupsStore.load();
    // Liste paginée ET KPIs rechargés côté serveur à tout changement de filtre
    // (compte, preset/dates, side, setup). Les KPIs viennent de l'agrégat backend
    // → stables, indépendants de « Charger plus ».
    effect(() => this.refreshJournal());
  }

  /** Filtres serveur dérivés des signaux (n'inclut que les valeurs définies). */
  private readonly journalFilters = computed<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    const acc = this.selectedAccount.accountParam();
    if (acc) f['accountId'] = acc;
    const side = this.filterSide();
    if (side !== 'ALL') f['side'] = side;
    const setup = this.filterSetup();
    if (setup) f['setupId'] = setup;
    const result = this.filterResult();
    if (result !== 'ALL') f['result'] = result;
    const exec = this.filterExecution();
    if (exec !== 'ALL') f['executionGrade'] = exec;
    const emo = this.filterEmotion();
    if (emo !== 'ALL') f['emotion'] = emo;
    const { dateFrom, dateTo } = this.dateRange();
    if (dateFrom) f['dateFrom'] = dateFrom;
    if (dateTo) f['dateTo'] = dateTo;
    return f;
  });

  /** Range ISO dérivé du preset (même logique que l'ancien filtrage client). */
  private readonly dateRange = computed<{ dateFrom?: string; dateTo?: string }>(() => {
    const preset = this.datePreset();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === 'today') return { dateFrom: today.toISOString(), dateTo: now.toISOString() };
    if (preset === 'week') {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay()); // dimanche, comme avant
      return { dateFrom: weekStart.toISOString(), dateTo: now.toISOString() };
    }
    if (preset === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: monthStart.toISOString(), dateTo: now.toISOString() };
    }
    if (preset === 'custom') {
      const from = this.dateFrom();
      if (!from) return {};
      const to = this.dateTo();
      return {
        dateFrom: new Date(from).toISOString(),
        dateTo: to ? new Date(to + 'T23:59:59').toISOString() : now.toISOString(),
      };
    }
    return {}; // 'all' → pas de borne
  });

  /** Reset + recharge liste et KPIs avec les filtres courants. */
  private refreshJournal(): void {
    const filters = this.journalFilters();
    this.tradesStore.reset();
    this.tradesStore.loadTrades(filters);
    this.tradesStore.loadStats(filters);
  }

  /** Recharge seulement les KPIs (la liste est déjà mise à jour de façon optimiste). */
  private refreshStats(): void {
    this.tradesStore.loadStats(this.journalFilters());
  }

  protected readonly XIcon            = X;
  protected readonly PencilIcon       = Pencil;
  protected readonly UploadIcon       = Upload;
  protected readonly ChevronDownIcon  = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CalendarIcon     = Calendar;
  protected readonly TrashIcon        = Trash2;
  protected readonly ReassignIcon     = ArrowRightLeft;

  /** Libellé FR de la note d'exécution calculée (PROMPT-161) ; '-' si non évaluée. */
  protected gradeLabel(g: string | null | undefined): string {
    return { EXCELLENT: 'Excellent', BON: 'Bon', MOYEN: 'Moyen', MAUVAIS: 'Mauvais' }[g ?? ''] ?? '-';
  }

  /** Explication de la note selon le barème utilisé (PROMPT-168). */
  protected gradeTooltip(t: Trade): string {
    const base = `Note calculée : ${t.executionScore}/100. `;
    return t.executionMethod === 'BEHAVIORAL'
      ? base +
          'Note comportementale (aucun stop loss sur ce trade) : perte contenue, absence de revenge trading, régularité de la taille de position.'
      : base +
          "Barème standard : stop respecté, R:R, émotion effective et risque engagé.";
  }

  protected readonly showModal        = signal(false);
  protected readonly showImport       = signal(false);
  protected readonly isSubmitting     = signal(false);
  protected readonly submitError      = signal<string | null>(null);
  protected readonly selectedTrade    = signal<Trade | null>(null);
  protected readonly confirmDeleteDay = signal<DayGroup | null>(null);
  protected readonly isDeletingDay    = signal(false);
  // Réaffectation d'une journée vers un autre compte.
  protected readonly reassignDay      = signal<DayGroup | null>(null);
  protected readonly isReassigning    = signal(false);
  protected readonly reassignError    = signal<string | null>(null);
  protected readonly activeAccounts   = computed(() => this.selectedAccount.activeAccounts());
  protected readonly currentAccountId = computed(() => this.selectedAccount.selectedAccountId());
  // Réaffectation utile seulement s'il existe un compte cible ≠ compte courant.
  protected readonly canReassign      = computed(() =>
    this.activeAccounts().some((a) => a.id !== this.currentAccountId()),
  );
  protected readonly filterSide      = signal<FilterSide>('ALL');
  protected readonly filterSetup     = signal<string | null>(null);
  protected readonly filterResult    = signal<FilterResult>('ALL');
  protected readonly filterExecution = signal<FilterExecution>('ALL');
  protected readonly filterEmotion   = signal<FilterEmotion>('ALL');
  protected readonly collapsedDays  = signal<Set<string>>(new Set());
  // Repli des semaines : override explicite de l'utilisateur (clé → repliée?). Par défaut,
  // seule la semaine la plus récente (index 0) est dépliée ; les autres repliées. Survit à
  // la pagination (les semaines plus anciennes révélées restent repliées par défaut).
  protected readonly weekOverrides = signal<Map<string, boolean>>(new Map());

  /** Vrai dès qu'un filtre (hors période/compte) est actif → affiche « Réinitialiser ». */
  protected readonly hasActiveFilters = computed(() =>
    this.filterSide() !== 'ALL' ||
    this.filterSetup() !== null ||
    this.filterResult() !== 'ALL' ||
    this.filterExecution() !== 'ALL' ||
    this.filterEmotion() !== 'ALL',
  );

  protected resetFilters(): void {
    this.filterSide.set('ALL');
    this.filterSetup.set(null);
    this.filterResult.set('ALL');
    this.filterExecution.set('ALL');
    this.filterEmotion.set('ALL');
  }
  protected readonly datePreset     = signal<DatePreset>('all');
  protected readonly showCustomDate = signal(false);
  protected readonly dateFrom       = signal('');
  protected readonly dateTo         = signal('');

  // ── Vue par jour ──────────────────────────────────────────────────────────
  // Le filtrage (période/side/setup) est désormais fait côté serveur : on groupe
  // simplement les trades renvoyés. « Charger plus » révèle des jours plus anciens
  // dans le même filtre, sans changer les KPIs (qui viennent de l'agrégat backend).

  protected readonly tradesByDay = computed((): DayGroup[] => {
    const trades = this.tradesStore.trades();
    if (!trades.length) return [];

    const groups = new Map<string, Trade[]>();
    for (const trade of trades) {
      const d   = new Date(trade.tradedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const arr = groups.get(key) ?? [];
      arr.push(trade);
      groups.set(key, arr);
    }

    return Array.from(groups.entries())
      .filter(([, dayTrades]) => dayTrades.length > 0)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, dayTrades]) => {
        const d     = new Date(key + 'T12:00:00');
        const label = d.toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        const totalCommission = dayTrades.reduce((s, t) => s + Math.abs(t.commission ?? 0), 0);
        // Stats du jour via le helper unique (BE exclus du win rate, PROMPT-160).
        const st              = computeTradeStats(dayTrades);
        const totalPnl        = st.totalPnl;
        const totalPnlNet     = totalPnl - totalCommission;
        return {
          key, label,
          trades: dayTrades.sort((a, b) => new Date(b.tradedAt).getTime() - new Date(a.tradedAt).getTime()),
          totalPnl, totalPnlNet, totalCommission,
          count: dayTrades.length, winCount: st.wins,
          lossCount: st.losses, breakeven: st.breakeven, winRate: st.winRate,
        };
      });
  });

  // ── Vue par semaine (niveau au-dessus des jours) ────────────────────────────
  // Regroupe les DayGroup en semaines ISO (lundi → dimanche). Les agrégats sont
  // recalculés sur TOUS les trades de la semaine (win rate juste, pas une moyenne
  // de moyennes ; BE exclus via computeTradeStats). Même base de date que les jours.

  protected readonly tradesByWeek = computed((): WeekGroup[] => {
    const days = this.tradesByDay();
    if (!days.length) return [];

    const map = new Map<string, { days: DayGroup[]; label: string }>();
    for (const day of days) {
      const { key, label } = this.isoWeek(day.key);
      const bucket = map.get(key) ?? { days: [], label };
      bucket.days.push(day);
      map.set(key, bucket);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a)) // semaines du plus récent au plus ancien
      .map(([key, { days: weekDays, label }]) => {
        const allTrades = weekDays.flatMap((d) => d.trades);
        const st = computeTradeStats(allTrades);
        const totalCommission = weekDays.reduce((s, d) => s + d.totalCommission, 0);
        const totalPnl = st.totalPnl;
        return {
          key, label, days: weekDays,
          count: st.total, winCount: st.wins,
          totalPnl, totalPnlNet: totalPnl - totalCommission, totalCommission,
        };
      });
  });

  /** Semaine ISO (lundi → dimanche) d'une clé jour 'YYYY-MM-DD'. Clé = lundi, libellé = plage. */
  private isoWeek(dayKey: string): { key: string; label: string } {
    const date = new Date(dayKey + 'T12:00:00'); // midi → insensible au fuseau/DST
    const dow = (date.getDay() + 6) % 7;          // lundi = 0 … dimanche = 6
    const monday = new Date(date);
    monday.setDate(date.getDate() - dow);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fr = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    return { key: `week-${iso(monday)}`, label: `Semaine du ${fr(monday)} au ${fr(sunday)}` };
  }

  // ── Stats période ─────────────────────────────────────────────────────────
  // KPIs issus de l'agrégat backend (ensemble filtré complet, hors pagination).
  // Remappés sur les libellés du template ; null si aucun trade → état vide.

  protected readonly periodStats = computed(() => {
    const s = this.tradesStore.stats();
    if (!s || s.totalTrades === 0) return null;
    return {
      count:            s.totalTrades,
      totalPnl:         s.pnlNet,
      totalPnlBrut:     s.pnlBrut,
      totalCommissions: s.fees,
      winRate:          s.winRate,
      bestTrade:        s.bestTrade,
      worstTrade:       s.worstTrade,
    };
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  toggleDay(key: string): void {
    this.collapsedDays.update(set => {
      const next = new Set(set);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }

  /** Repli effectif d'une semaine : override utilisateur sinon défaut (repliée si pas la plus récente). */
  protected isWeekCollapsed(key: string, index: number): boolean {
    const o = this.weekOverrides();
    return o.has(key) ? o.get(key)! : index !== 0;
  }

  toggleWeek(key: string, index: number): void {
    const collapsed = this.isWeekCollapsed(key, index);
    this.weekOverrides.update(map => {
      const next = new Map(map);
      next.set(key, !collapsed);
      return next;
    });
  }

  setDatePreset(preset: DatePreset): void {
    this.datePreset.set(preset);
    if (preset !== 'custom') this.showCustomDate.set(false);
  }

  toggleCustomDate(): void {
    this.datePreset.set('custom');
    this.showCustomDate.update(v => !v);
  }

  onDateFrom(e: Event): void {
    this.dateFrom.set((e.target as HTMLInputElement).value);
  }

  onDateTo(e: Event): void {
    this.dateTo.set((e.target as HTMLInputElement).value);
  }

  openModal(): void {
    this.selectedTrade.set(null);
    this.showModal.set(true);
    this.submitError.set(null);
  }

  protected openEditModal(trade: Trade): void {
    this.selectedTrade.set(trade);
    this.showModal.set(true);
    this.submitError.set(null);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.selectedTrade.set(null);
    this.submitError.set(null);
  }

  submitTrade(dto: CreateTradeDto): void {
    const edit = this.selectedTrade();
    this.isSubmitting.set(true);
    this.submitError.set(null);

    // Création : rattacher le trade au compte sélectionné (sauf « Tous »). Le backend
    // garde son fallback (session active → compte par défaut) si accountId absent.
    const accountId = this.selectedAccount.accountParam();
    const payload: CreateTradeDto = !edit && accountId ? { ...dto, accountId } : dto;

    const obs = edit
      ? this.tradesApi.update(edit.id, dto)
      : this.http.post<{ data: Trade }>(`${environment.apiUrl}/trades`, payload);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: { data: Trade }) => {
        if (edit) { this.tradesStore.updateTrade(res.data); } else { this.tradesStore.addTrade(res.data); }
        this.refreshStats(); // KPIs recalculés côté serveur sur l'ensemble filtré
        this.closeModal();
        this.isSubmitting.set(false);
      },
      error: (err: HttpErrorResponse) => {
        const msg = (err?.error as { message?: string | string[] })?.message ?? 'Erreur';
        this.submitError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
        this.isSubmitting.set(false);
      },
    });
  }

  deleteTrade(id: string): void {
    this.http.delete(`${environment.apiUrl}/trades/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => { this.tradesStore.removeTrade(id); this.refreshStats(); } });
  }

  protected deleteDay(day: DayGroup): void {
    this.isDeletingDay.set(true);
    const ids = day.trades.map(t => t.id);
    forkJoin(ids.map(id => this.http.delete(`${environment.apiUrl}/trades/${id}`)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          ids.forEach(id => this.tradesStore.removeTrade(id));
          this.refreshStats();
          this.isDeletingDay.set(false);
          this.confirmDeleteDay.set(null);
        },
        error: () => this.isDeletingDay.set(false),
      });
  }

  protected openReassign(day: DayGroup): void {
    this.reassignError.set(null);
    this.reassignDay.set(day);
  }

  protected reassignTo(day: DayGroup, accountId: string): void {
    if (this.isReassigning()) return;
    this.isReassigning.set(true);
    this.reassignError.set(null);
    const ids = day.trades.map((t) => t.id);
    this.tradesApi.reassign(ids, accountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isReassigning.set(false);
          this.reassignDay.set(null);
          // Les trades changent de compte → recharger liste + KPIs du filtre courant.
          this.refreshJournal();
        },
        error: (err: HttpErrorResponse) => {
          this.reassignError.set(err.error?.message ?? 'Erreur lors du déplacement.');
          this.isReassigning.set(false);
        },
      });
  }

  loadMore(): void { this.tradesStore.loadMore(); }

  onImported(): void {
    this.showImport.set(false);
    this.refreshJournal();
  }
}
