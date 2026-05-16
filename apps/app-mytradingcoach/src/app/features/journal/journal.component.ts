import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit,
  computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, X, Pencil, Upload, ChevronDown, ChevronRight, Calendar } from 'lucide-angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import { UserStore } from '../../core/stores/user.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from './trade-form.component';
import { CsvImportComponent } from './csv-import.component';
import { PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe } from '../../shared/pipes';
import { environment } from '../../../environments/environment';

type FilterSide = 'ALL' | 'LONG' | 'SHORT';
type DatePreset = 'today' | 'week' | 'month' | 'custom' | 'all';

const SETUPS = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];

interface DayGroup {
  key: string;
  label: string;
  trades: Trade[];
  totalPnl: number;
  totalCommission: number;
  count: number;
  winCount: number;
}

@Component({
  selector: 'mtc-journal',
  standalone: true,
  imports: [
    DatePipe, DecimalPipe, LucideAngularModule,
    TopbarComponent, TradeFormComponent, CsvImportComponent,
    PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './journal.component.css',
  templateUrl: './journal.component.html',
})
export class JournalComponent implements OnInit {
  protected readonly tradesStore = inject(TradesStore);
  protected readonly userStore   = inject(UserStore);
  private readonly tradesApi     = inject(TradesApi);
  private readonly http          = inject(HttpClient);
  private readonly destroyRef    = inject(DestroyRef);

  protected readonly SETUPS = SETUPS;
  protected readonly XIcon            = X;
  protected readonly PencilIcon       = Pencil;
  protected readonly UploadIcon       = Upload;
  protected readonly ChevronDownIcon  = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CalendarIcon     = Calendar;

  protected readonly showModal      = signal(false);
  protected readonly showImport     = signal(false);
  protected readonly isSubmitting   = signal(false);
  protected readonly submitError    = signal<string | null>(null);
  protected readonly selectedTrade  = signal<Trade | null>(null);
  protected readonly filterSide     = signal<FilterSide>('ALL');
  protected readonly filterSetup    = signal<string | null>(null);
  protected readonly collapsedDays  = signal<Set<string>>(new Set());
  protected readonly datePreset     = signal<DatePreset>('all');
  protected readonly showCustomDate = signal(false);
  protected readonly dateFrom       = signal('');
  protected readonly dateTo         = signal('');

  // ── Filtres combinés ──────────────────────────────────────────────────────

  protected readonly filteredTrades = computed(() => {
    let trades = this.tradesStore.trades();
    const side   = this.filterSide();
    const setup  = this.filterSetup();
    const preset = this.datePreset();
    const from   = this.dateFrom();
    const to     = this.dateTo();

    if (side !== 'ALL') trades = trades.filter(t => t.side === side);
    if (setup)          trades = trades.filter(t => t.setup === setup);

    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (preset === 'today') {
      trades = trades.filter(t => new Date(t.tradedAt) >= today);
    } else if (preset === 'week') {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      trades = trades.filter(t => new Date(t.tradedAt) >= weekStart);
    } else if (preset === 'month') {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      trades = trades.filter(t => new Date(t.tradedAt) >= monthStart);
    } else if (preset === 'custom' && from) {
      const f  = new Date(from);
      const t2 = to ? new Date(to + 'T23:59:59') : new Date();
      trades = trades.filter(t => {
        const d = new Date(t.tradedAt);
        return d >= f && d <= t2;
      });
    }

    return trades;
  });

  // ── Vue par jour ──────────────────────────────────────────────────────────

  protected readonly tradesByDay = computed((): DayGroup[] => {
    const trades = this.filteredTrades();
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
        const totalPnl        = dayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
        const totalCommission = dayTrades.reduce((s, t) => s + Math.abs((t as any).commission ?? 0), 0);
        const winCount        = dayTrades.filter(t => (t.pnl ?? 0) > 0).length;
        return {
          key, label,
          trades: dayTrades.sort((a, b) => new Date(b.tradedAt).getTime() - new Date(a.tradedAt).getTime()),
          totalPnl, totalCommission,
          count: dayTrades.length, winCount,
        };
      });
  });

  // ── Stats période ─────────────────────────────────────────────────────────

  protected readonly periodStats = computed(() => {
    const trades = this.filteredTrades();
    if (!trades.length) return null;
    const pnls = trades.map(t => t.pnl ?? 0);
    return {
      count:      trades.length,
      totalPnl:   pnls.reduce((s, v) => s + v, 0),
      winRate:    (trades.filter(t => (t.pnl ?? 0) > 0).length / trades.length) * 100,
      bestTrade:  Math.max(...pnls),
      worstTrade: Math.min(...pnls),
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

  ngOnInit() { this.tradesStore.loadTrades(); }

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

  toggleSetupFilter(setup: string): void {
    this.filterSetup.set(this.filterSetup() === setup ? null : setup);
  }

  submitTrade(dto: CreateTradeDto): void {
    const edit = this.selectedTrade();
    this.isSubmitting.set(true);
    this.submitError.set(null);

    const obs = edit
      ? this.tradesApi.update(edit.id, dto)
      : this.http.post<{ data: Trade }>(`${environment.apiUrl}/trades`, dto);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        if (edit) { this.tradesStore.updateTrade(res.data); } else { this.tradesStore.addTrade(res.data); }
        this.closeModal();
        this.isSubmitting.set(false);
      },
      error: (err: any) => {
        const msg = err?.error?.message ?? 'Erreur';
        this.submitError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
        this.isSubmitting.set(false);
      },
    });
  }

  deleteTrade(id: string): void {
    this.http.delete(`${environment.apiUrl}/trades/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.tradesStore.removeTrade(id) });
  }

  loadMore(): void { this.tradesStore.loadMore(); }

  onImported(): void {
    this.showImport.set(false);
    this.tradesStore.reset();
    this.tradesStore.loadTrades();
  }
}
