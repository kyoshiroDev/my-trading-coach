import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, X, Pencil, Upload } from 'lucide-angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { CreateTradeDto, TradesApi } from '../../core/api/trades.api';
import { UserStore } from '../../core/stores/user.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from './trade-form.component';
import { CsvImportComponent } from './csv-import.component';
import { PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe } from '../../shared/pipes';
import { environment } from '../../../environments/environment';

type FilterSide = 'ALL' | 'LONG' | 'SHORT';

const SETUPS = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];

@Component({
  selector: 'mtc-journal',
  standalone: true,
  imports: [DatePipe, LucideAngularModule, TopbarComponent, TradeFormComponent, CsvImportComponent, PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './journal.component.css',
  template: `
    <mtc-topbar
      title="Journal"
      [showAddButton]="true"
      addLabel="Nouveau trade"
      addTestId="add-trade-btn"
      (addClick)="openModal()"
    />

    <div class="content">
      <!-- Filtres + actions -->
      <div class="journal-filters">
        <button class="filter-chip" [class.active]="filterSide() === 'ALL'" (click)="filterSide.set('ALL')">
          Tous
        </button>
        <button class="filter-chip" data-testid="filter-long" [class.active]="filterSide() === 'LONG'" (click)="filterSide.set('LONG')">
          LONG
        </button>
        <button class="filter-chip" data-testid="filter-short" [class.active]="filterSide() === 'SHORT'" (click)="filterSide.set('SHORT')">
          SHORT
        </button>
        @for (setup of SETUPS; track setup) {
          <button class="filter-chip" [class.active]="filterSetup() === setup" (click)="toggleSetupFilter(setup)">
            {{ setup }}
          </button>
        }
        <button class="filter-chip import-btn"
          [class.import-locked]="!userStore.isPremium()"
          (click)="showImport.set(true)"
          [title]="userStore.isPremium() ? 'Importer un CSV' : 'Fonctionnalité Premium'">
          <lucide-icon [img]="UploadIcon" [size]="12" />
          CSV
          @if (!userStore.isPremium()) { <span class="lock-badge">⚡</span> }
        </button>
      </div>

      <!-- Tableau -->
      @if (tradesStore.isLoading()) {
        <div class="loading-state">Chargement des trades...</div>
      } @else if (filteredTrades().length === 0) {
        <div class="empty-state" data-testid="empty-state">
          <div class="empty-state-icon">📖</div>
          <h3 class="empty-state-title">Aucun trade enregistré</h3>
          <p class="empty-state-desc">
            Commence à journaliser tes trades pour obtenir
            des analyses IA personnalisées
          </p>
          <button class="btn-primary" (click)="openModal()">
            + Ajouter mon premier trade
          </button>
        </div>
      } @else {
        <div class="table-wrap">
        <table class="journal-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Sens</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>P&amp;L</th>
              <th class="col-qty">Qté</th>
              <th>R/R</th>
              <th>Émotion</th>
              <th>Setup</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (trade of filteredTrades(); track trade.id) {
              <tr data-testid="trade-row">
                <td class="td-asset">{{ trade.asset }}</td>
                <td>
                  <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">
                    {{ trade.side }}
                  </span>
                </td>
                <td class="mono">{{ trade.entry }}</td>
                <td class="mono">{{ trade.exit ?? '—' }}</td>
                <td class="mono" data-testid="trade-pnl" [style.color]="trade.pnl | pnlColor">
                  {{ trade.pnl | pnlFormat:trade.entry }}
                </td>
                <td class="mono col-qty">{{ trade.quantity ?? 1 }}</td>
                <td class="mono">{{ trade.riskReward !== null ? trade.riskReward.toFixed(2) : '—' }}</td>
                <td>
                  <span class="emotion-cell">
                    {{ trade.emotion | emotionEmoji }} <span class="emotion-text">{{ trade.emotion }}</span>
                  </span>
                </td>
                <td><span class="setup-badge">{{ trade.setup }}</span></td>
                <td class="mono td-date">{{ trade.tradedAt | date:'dd/MM/yy' }}</td>
                <td>
                  <div class="td-actions">
                    <button class="btn-edit" (click)="openEditModal(trade)" title="Modifier">
                      <lucide-icon [img]="PencilIcon" [size]="12" />
                    </button>
                    <button class="btn-delete" data-testid="trade-delete" (click)="deleteTrade(trade.id)" title="Supprimer">
                      <lucide-icon [img]="XIcon" [size]="12" />
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
        </div>

        @if (tradesStore.hasNextPage()) {
          <button class="btn-load-more" (click)="loadMore()">Charger plus de trades</button>
        }
      }
    </div>

    <mtc-trade-form
      [open]="showModal()"
      [editTrade]="selectedTrade()"
      [isSaving]="isSubmitting()"
      [apiError]="submitError()"
      (dismissed)="closeModal()"
      (formSave)="submitTrade($event)"
    />

    <mtc-csv-import
      [open]="showImport()"
      (close)="showImport.set(false)"
      (imported)="onImported()"
    />
  `,
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
    if (side !== 'ALL') trades = trades.filter(t => t.side === side);
    if (setup) trades = trades.filter(t => t.setup === setup);
    return trades;
  });

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
      this.tradesApi.update(edit.id, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.tradesStore.updateTrade(res.data);
            this.closeModal();
            this.isSubmitting.set(false);
          },
          error: (err) => {
            const msg = err?.error?.message ?? 'Erreur lors de la modification';
            this.submitError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
            this.isSubmitting.set(false);
          },
        });
    } else {
      this.http.post<{ data: Trade }>(`${environment.apiUrl}/trades`, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.tradesStore.addTrade(res.data);
            this.closeModal();
            this.isSubmitting.set(false);
          },
          error: (err) => {
            const msg = err?.error?.message ?? "Erreur lors de l'enregistrement du trade";
            this.submitError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
            this.isSubmitting.set(false);
          },
        });
    }
  }

  deleteTrade(id: string) {
    this.http.delete(`${environment.apiUrl}/trades/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.tradesStore.removeTrade(id),
      });
  }

  loadMore() { this.tradesStore.loadMore(); }

  onImported() {
    this.showImport.set(false);
    this.tradesStore.reset();
    this.tradesStore.loadTrades();
  }
}