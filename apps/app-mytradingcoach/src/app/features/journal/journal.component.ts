import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, X, Pencil, Upload } from 'lucide-angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import { UserStore } from '../../core/stores/user.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from './trade-form.component';
import { CsvImportComponent } from './csv-import.component';
import {
  PnlColorPipe,
  PnlFormatPipe,
  EmotionEmojiPipe,
} from '../../shared/pipes';
import { environment } from '../../../environments/environment';

type FilterSide = 'ALL' | 'LONG' | 'SHORT';

const SETUPS = [
  'BREAKOUT',
  'PULLBACK',
  'RANGE',
  'REVERSAL',
  'SCALPING',
  'NEWS',
];

@Component({
  selector: 'mtc-journal',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    LucideAngularModule,
    TopbarComponent,
    TradeFormComponent,
    CsvImportComponent,
    PnlColorPipe,
    PnlFormatPipe,
    EmotionEmojiPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './journal.component.css',
  templateUrl: './journal.component.html',
})
export class JournalComponent implements OnInit {
  protected readonly tradesStore = inject(TradesStore);
  protected readonly userStore = inject(UserStore);
  private readonly tradesApi = inject(TradesApi);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly SETUPS = SETUPS;
  protected readonly XIcon = X;
  protected readonly PencilIcon = Pencil;
  protected readonly UploadIcon = Upload;

  protected readonly showModal = signal(false);
  protected readonly showImport = signal(false);
  protected readonly isSubmitting = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly selectedTrade = signal<Trade | null>(null);
  protected readonly filterSide = signal<FilterSide>('ALL');
  protected readonly filterSetup = signal<string | null>(null);

  protected readonly filteredTrades = computed(() => {
    let trades = this.tradesStore.trades();
    const side = this.filterSide();
    const setup = this.filterSetup();
    if (side !== 'ALL') trades = trades.filter((t) => t.side === side);
    if (setup) trades = trades.filter((t) => t.setup === setup);
    return trades;
  });

  protected readonly collapsedDays = signal<Set<string>>(new Set());

  protected readonly tradesByDay = computed(() => {
    const trades = this.filteredTrades();
    if (!trades.length) return [];

    const groups = new Map<string, Trade[]>();
    for (const trade of trades) {
      const key = new Date(trade.tradedAt).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      const existing = groups.get(key) ?? [];
      existing.push(trade);
      groups.set(key, existing);
    }

    return Array.from(groups.entries())
      .sort(([, a], [, b]) =>
        new Date(b[0].tradedAt).getTime() - new Date(a[0].tradedAt).getTime(),
      )
      .map(([label, dayTrades]) => ({
        label,
        trades: dayTrades.sort(
          (a, b) => new Date(b.tradedAt).getTime() - new Date(a.tradedAt).getTime(),
        ),
        totalPnl: dayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
        totalCommission: dayTrades.reduce((s, t) => s + Math.abs(t.commission ?? 0), 0),
        count: dayTrades.length,
        winCount: dayTrades.filter((t) => (t.pnl ?? 0) > 0).length,
      }));
  });

  protected toggleDay(label: string): void {
    this.collapsedDays.update((set) => {
      const next = new Set(set);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }

  protected isDayCollapsed(label: string): boolean {
    return this.collapsedDays().has(label);
  }

  ngOnInit() {
    this.tradesStore.loadTrades();
  }

  openModal() {
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

  toggleSetupFilter(setup: string) {
    this.filterSetup.set(this.filterSetup() === setup ? null : setup);
  }

  submitTrade(dto: CreateTradeDto): void {
    const edit = this.selectedTrade();
    this.isSubmitting.set(true);
    this.submitError.set(null);

    if (edit) {
      this.tradesApi
        .update(edit.id, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.tradesStore.updateTrade(res.data);
            this.closeModal();
            this.isSubmitting.set(false);
          },
          error: (err) => {
            const msg = err?.error?.message ?? 'Erreur lors de la modification';
            this.submitError.set(
              Array.isArray(msg) ? msg.join(', ') : String(msg),
            );
            this.isSubmitting.set(false);
          },
        });
    } else {
      this.http
        .post<{ data: Trade }>(`${environment.apiUrl}/trades`, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.tradesStore.addTrade(res.data);
            this.closeModal();
            this.isSubmitting.set(false);
          },
          error: (err) => {
            const msg =
              err?.error?.message ?? "Erreur lors de l'enregistrement du trade";
            this.submitError.set(
              Array.isArray(msg) ? msg.join(', ') : String(msg),
            );
            this.isSubmitting.set(false);
          },
        });
    }
  }

  deleteTrade(id: string) {
    this.http
      .delete(`${environment.apiUrl}/trades/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.tradesStore.removeTrade(id),
      });
  }

  loadMore() {
    this.tradesStore.loadMore();
  }

  onImported() {
    this.showImport.set(false);
    this.tradesStore.reset();
    this.tradesStore.loadTrades();
  }
}
