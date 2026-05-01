import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, X } from 'lucide-angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { CreateTradeDto } from '../../core/api/trades.api';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { TradeFormComponent } from './trade-form.component';
import { PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe } from '../../shared/pipes';
import { environment } from '../../../environments/environment';

type FilterSide = 'ALL' | 'LONG' | 'SHORT';

const SETUPS = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];

@Component({
  selector: 'mtc-journal',
  standalone: true,
  imports: [DatePipe, LucideAngularModule, TopbarComponent, TradeFormComponent, PnlColorPipe, PnlFormatPipe, EmotionEmojiPipe],
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
      <!-- Filtres -->
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
                <td class="mono">{{ trade.riskReward !== null ? trade.riskReward.toFixed(2) : '—' }}</td>
                <td>
                  <span class="emotion-cell">
                    {{ trade.emotion | emotionEmoji }} <span class="emotion-text">{{ trade.emotion }}</span>
                  </span>
                </td>
                <td><span class="setup-badge">{{ trade.setup }}</span></td>
                <td class="mono td-date">{{ trade.tradedAt | date:'dd/MM/yy' }}</td>
                <td>
                  <button class="btn-delete" data-testid="trade-delete" (click)="deleteTrade(trade.id)" title="Supprimer">
                    <lucide-icon [img]="XIcon" [size]="12" />
                  </button>
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

    <!--
      TradeFormComponent (Smart/Dumb pattern) :
      - Journal = composant "Smart" : gère l'état (showModal, isSubmitting) et les appels API
      - TradeFormComponent = composant "Dumb" : reçoit des inputs, émet des outputs, pas d'état métier
    -->
    <mtc-trade-form
      [open]="showModal()"
      [isSaving]="isSubmitting()"
      (dismissed)="closeModal()"
      (formSave)="submitTrade($event)"
    />
  `,
})
export class JournalComponent implements OnInit {
  protected readonly tradesStore = inject(TradesStore);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly SETUPS = SETUPS;
  protected readonly XIcon = X;

  protected readonly showModal = signal(false);
  protected readonly isSubmitting = signal(false);
  protected readonly filterSide = signal<FilterSide>('ALL');
  protected readonly filterSetup = signal<string | null>(null);

  /** computed() : recalculé uniquement quand les trades ou les filtres changent */
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

  openModal() { this.showModal.set(true); }
  closeModal() { this.showModal.set(false); }

  toggleSetupFilter(setup: string) {
    this.filterSetup.set(this.filterSetup() === setup ? null : setup);
  }

  /**
   * Reçoit un CreateTradeDto déjà validé depuis TradeFormComponent.
   * Le journal n'a plus besoin de connaître la logique de validation du formulaire.
   */
  submitTrade(dto: CreateTradeDto) {
    this.isSubmitting.set(true);

    this.http.post<{ data: Trade }>(`${environment.apiUrl}/trades`, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tradesStore.addTrade(res.data);
          this.closeModal();
          this.isSubmitting.set(false);
        },
        error: () => this.isSubmitting.set(false),
      });
  }

  deleteTrade(id: string) {
    this.http.delete(`${environment.apiUrl}/trades/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.tradesStore.removeTrade(id),
      });
  }

  loadMore() { this.tradesStore.loadMore(); }
}
