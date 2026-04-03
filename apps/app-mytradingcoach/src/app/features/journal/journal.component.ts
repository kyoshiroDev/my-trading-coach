import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule, Plus, X, Filter } from 'lucide-angular';
import { TradesStore, Trade } from '../../core/stores/trades.store';
import { TopbarComponent } from '../../shared/components/topbar/topbar.component';
import { PnlColorPipe } from '../../shared/pipes/pnl-color.pipe';
import { EmotionEmojiPipe } from '../../shared/pipes/emotion-emoji.pipe';
import { environment } from '../../../environments/environment';

const EMOTIONS = ['CONFIDENT', 'FOCUSED', 'NEUTRAL', 'STRESSED', 'FEAR', 'REVENGE'];
const SETUPS = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];
const SESSIONS = ['LONDON', 'NEW_YORK', 'ASIAN', 'PRE_MARKET', 'OVERLAP'];
const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

type FilterSide = 'ALL' | 'LONG' | 'SHORT';

@Component({
  selector: 'mtc-journal',
  standalone: true,
  imports: [FormsModule, DatePipe, LucideAngularModule, TopbarComponent, PnlColorPipe, EmotionEmojiPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './journal.component.css',
  template: `
    <mtc-topbar
      title="Journal"
      [showAddButton]="true"
      addLabel="Nouveau trade"
      (addClick)="openModal()"
    />

    <div class="content">
      <!-- Filters -->
      <div class="journal-filters">
        <button class="filter-chip" [class.active]="filterSide() === 'ALL'" (click)="filterSide.set('ALL')">
          Tous
        </button>
        <button class="filter-chip" [class.active]="filterSide() === 'LONG'" (click)="filterSide.set('LONG')">
          LONG
        </button>
        <button class="filter-chip" [class.active]="filterSide() === 'SHORT'" (click)="filterSide.set('SHORT')">
          SHORT
        </button>
        @for (setup of SETUPS; track setup) {
          <button class="filter-chip" [class.active]="filterSetup() === setup" (click)="toggleSetupFilter(setup)">
            {{ setup }}
          </button>
        }
      </div>

      <!-- Table -->
      @if (tradesStore.isLoading$()) {
        <div class="loading-state">Chargement des trades...</div>
      } @else if (filteredTrades().length === 0) {
        <div class="empty-state">
          <p>Aucun trade trouvé</p>
          <small>Modifie les filtres ou ajoute ton premier trade</small>
        </div>
      } @else {
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
              <tr>
                <td class="td-asset">{{ trade.asset }}</td>
                <td>
                  <span class="trade-side" [class]="trade.side === 'LONG' ? 'long' : 'short'">
                    {{ trade.side }}
                  </span>
                </td>
                <td class="mono">{{ trade.entry }}</td>
                <td class="mono">{{ trade.exit ?? '—' }}</td>
                <td class="mono" [class]="trade.pnl | pnlColor">
                  {{ trade.pnl !== null ? ((trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2)) : '—' }}
                </td>
                <td class="mono">{{ trade.riskReward !== null ? trade.riskReward.toFixed(2) : '—' }}</td>
                <td class="td-emotion">
                  {{ trade.emotion | emotionEmoji }} <span class="emotion-text">{{ trade.emotion }}</span>
                </td>
                <td><span class="setup-badge">{{ trade.setup }}</span></td>
                <td class="mono td-date">{{ trade.tradedAt | date:'dd/MM/yy' }}</td>
                <td>
                  <button class="btn-delete" (click)="deleteTrade(trade.id)" title="Supprimer">
                    <lucide-icon [img]="XIcon" [size]="12" />
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>

        @if (tradesStore.hasNextPage$()) {
          <button class="btn-load-more" (click)="loadMore()">Charger plus de trades</button>
        }
      }
    </div>

    <!-- ─── Modal ─── -->
    @if (showModal()) {
      <div class="modal-overlay" role="presentation" (click)="closeModal()" (keydown.escape)="closeModal()">
        <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title">Nouveau Trade</span>
            <button class="modal-close" (click)="closeModal()">
              <lucide-icon [img]="XIcon" [size]="14" />
            </button>
          </div>

          <div class="modal-body">
            <form (ngSubmit)="submitTrade()" class="form-grid">
              <div class="field">
                <label for="f-asset">Asset</label>
                <input id="f-asset" [(ngModel)]="form.asset" name="asset" required placeholder="BTC/USDT, EUR/USD..." />
              </div>
              <div class="field">
                <label for="f-side">Sens</label>
                <select id="f-side" [(ngModel)]="form.side" name="side">
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>
              <div class="field">
                <label for="f-entry">Entry</label>
                <input id="f-entry" type="number" [(ngModel)]="form.entry" name="entry" required step="any" />
              </div>
              <div class="field">
                <label for="f-exit">Exit (optionnel)</label>
                <input id="f-exit" type="number" [(ngModel)]="form.exit" name="exit" step="any" />
              </div>
              <div class="field">
                <label for="f-sl">Stop Loss</label>
                <input id="f-sl" type="number" [(ngModel)]="form.stopLoss" name="stopLoss" step="any" />
              </div>
              <div class="field">
                <label for="f-tp">Take Profit</label>
                <input id="f-tp" type="number" [(ngModel)]="form.takeProfit" name="takeProfit" step="any" />
              </div>

              <!-- Emotion selector -->
              <div class="field form-full">
                <span class="field-label">État émotionnel</span>
                <div class="emotion-selector">
                  @for (e of EMOTIONS; track e) {
                    <button
                      type="button"
                      class="emotion-btn"
                      [class.selected]="form.emotion === e"
                      (click)="form.emotion = $any(e)"
                    >
                      <span>{{ EMOTION_EMOJIS[e] }}</span>
                      <span>{{ e }}</span>
                    </button>
                  }
                </div>
              </div>

              <div class="field">
                <label for="f-setup">Setup</label>
                <select id="f-setup" [(ngModel)]="form.setup" name="setup">
                  @for (s of SETUPS; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="f-session">Session</label>
                <select id="f-session" [(ngModel)]="form.session" name="session">
                  @for (s of SESSIONS; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="f-tf">Timeframe</label>
                <input id="f-tf" [(ngModel)]="form.timeframe" name="timeframe" placeholder="15m, 1h, 4h..." />
              </div>
              <div class="field">
                <label for="f-pnl">P&amp;L ($)</label>
                <input id="f-pnl" type="number" [(ngModel)]="form.pnl" name="pnl" step="any" placeholder="Optionnel" />
              </div>
              <div class="field form-full">
                <label for="f-notes">Notes</label>
                <textarea id="f-notes" [(ngModel)]="form.notes" name="notes" rows="3" placeholder="Contexte, raison du trade, observations..."></textarea>
              </div>

              @if (modalError()) {
                <div class="error-msg form-full">{{ modalError() }}</div>
              }

              <div class="form-actions form-full">
                <button type="button" class="btn-cancel" (click)="closeModal()">Annuler</button>
                <button type="submit" class="btn-submit" [disabled]="isSubmitting()">
                  {{ isSubmitting() ? 'Enregistrement...' : 'Enregistrer le trade' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    }
  `,
})
export class JournalComponent implements OnInit {
  protected readonly tradesStore = inject(TradesStore);
  private readonly http = inject(HttpClient);

  protected readonly EMOTIONS = EMOTIONS;
  protected readonly SETUPS = SETUPS;
  protected readonly SESSIONS = SESSIONS;
  protected readonly EMOTION_EMOJIS = EMOTION_EMOJIS;

  protected readonly XIcon = X;
  protected readonly PlusIcon = Plus;
  protected readonly FilterIcon = Filter;

  protected readonly showModal = signal(false);
  protected readonly isSubmitting = signal(false);
  protected readonly modalError = signal<string | null>(null);
  protected readonly filterSide = signal<FilterSide>('ALL');
  protected readonly filterSetup = signal<string | null>(null);

  protected form = this.defaultForm();

  protected filteredTrades() {
    let trades = this.tradesStore.trades$();
    const side = this.filterSide();
    const setup = this.filterSetup();
    if (side !== 'ALL') trades = trades.filter(t => t.side === side);
    if (setup) trades = trades.filter(t => t.setup === setup);
    return trades;
  }

  ngOnInit() {
    this.tradesStore.loadTrades();
  }

  openModal() { this.form = this.defaultForm(); this.showModal.set(true); }
  closeModal() { this.showModal.set(false); this.modalError.set(null); }

  toggleSetupFilter(setup: string) {
    this.filterSetup.set(this.filterSetup() === setup ? null : setup);
  }

  submitTrade() {
    if (!this.form.asset || !this.form.entry) return;
    this.isSubmitting.set(true);
    this.modalError.set(null);

    this.http.post<{ data: Trade }>(`${environment.apiUrl}/trades`, this.form).subscribe({
      next: (res) => {
        this.tradesStore.addTrade(res.data);
        this.closeModal();
        this.isSubmitting.set(false);
      },
      error: (err) => {
        this.modalError.set(err.error?.message ?? 'Erreur lors de l\'enregistrement');
        this.isSubmitting.set(false);
      },
    });
  }

  deleteTrade(id: string) {
    this.http.delete(`${environment.apiUrl}/trades/${id}`).subscribe({
      next: () => this.tradesStore.removeTrade(id),
    });
  }

  loadMore() { this.tradesStore.loadMore(); }

  private defaultForm() {
    return {
      asset: '',
      side: 'LONG' as const,
      entry: 0,
      exit: null as number | null,
      stopLoss: null as number | null,
      takeProfit: null as number | null,
      pnl: null as number | null,
      emotion: 'NEUTRAL' as const,
      setup: 'BREAKOUT' as const,
      session: 'LONDON' as const,
      timeframe: '1h',
      notes: '',
    };
  }
}
