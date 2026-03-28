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
                  {{ trade.pnl != null ? ((trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2)) : '—' }}
                </td>
                <td class="mono">{{ trade.riskReward != null ? trade.riskReward.toFixed(2) : '—' }}</td>
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
      <div class="modal-overlay" (click)="closeModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title">Nouveau Trade</span>
            <button class="modal-close" (click)="closeModal()">
              <lucide-icon [img]="XIcon" [size]="14" />
            </button>
          </div>

          <div class="modal-body">
            <form (ngSubmit)="submitTrade()" class="form-grid">
              <div class="field">
                <label>Asset</label>
                <input [(ngModel)]="form.asset" name="asset" required placeholder="BTC/USDT, EUR/USD..." />
              </div>
              <div class="field">
                <label>Sens</label>
                <select [(ngModel)]="form.side" name="side">
                  <option value="LONG">LONG</option>
                  <option value="SHORT">SHORT</option>
                </select>
              </div>
              <div class="field">
                <label>Entry</label>
                <input type="number" [(ngModel)]="form.entry" name="entry" required step="any" />
              </div>
              <div class="field">
                <label>Exit (optionnel)</label>
                <input type="number" [(ngModel)]="form.exit" name="exit" step="any" />
              </div>
              <div class="field">
                <label>Stop Loss</label>
                <input type="number" [(ngModel)]="form.stopLoss" name="stopLoss" step="any" />
              </div>
              <div class="field">
                <label>Take Profit</label>
                <input type="number" [(ngModel)]="form.takeProfit" name="takeProfit" step="any" />
              </div>

              <!-- Emotion selector -->
              <div class="field form-full">
                <label>État émotionnel</label>
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
                <label>Setup</label>
                <select [(ngModel)]="form.setup" name="setup">
                  @for (s of SETUPS; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              <div class="field">
                <label>Session</label>
                <select [(ngModel)]="form.session" name="session">
                  @for (s of SESSIONS; track s) { <option [value]="s">{{ s }}</option> }
                </select>
              </div>
              <div class="field">
                <label>Timeframe</label>
                <input [(ngModel)]="form.timeframe" name="timeframe" placeholder="15m, 1h, 4h..." />
              </div>
              <div class="field">
                <label>P&amp;L ($)</label>
                <input type="number" [(ngModel)]="form.pnl" name="pnl" step="any" placeholder="Optionnel" />
              </div>
              <div class="field form-full">
                <label>Notes</label>
                <textarea [(ngModel)]="form.notes" name="notes" rows="3" placeholder="Contexte, raison du trade, observations..."></textarea>
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
  styles: [`
    .content { padding: 28px; flex: 1; }

    /* ─── Filters ─── */
    .journal-filters {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .filter-chip {
      padding: 6px 14px;
      border-radius: 100px;
      font-size: 12px;
      font-family: var(--font-mono);
      cursor: pointer;
      border: 1px solid var(--border);
      color: var(--text-2);
      background: transparent;
      transition: all 0.15s;
    }

    .filter-chip:hover, .filter-chip.active {
      background: var(--blue-glow);
      border-color: var(--blue);
      color: var(--blue-bright);
    }

    /* ─── Table ─── */
    .journal-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0 6px;
    }

    .journal-table th {
      font-size: 10px;
      font-family: var(--font-mono);
      font-weight: 500;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 6px 14px;
      text-align: left;
    }

    .journal-table td {
      padding: 13px 14px;
      font-size: 13px;
      color: var(--text-2);
      background: var(--bg-card);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
    }

    .journal-table td:first-child {
      border-left: 1px solid var(--border);
      border-radius: 10px 0 0 10px;
    }

    .journal-table td:last-child {
      border-right: 1px solid var(--border);
      border-radius: 0 10px 10px 0;
    }

    .journal-table tr:hover td { background: var(--bg-3); }

    .td-asset { font-weight: 600; font-family: var(--font-mono); color: var(--text); }
    .td-emotion { display: flex; align-items: center; gap: 6px; }
    .td-date { color: var(--text-3); font-size: 12px; }
    .emotion-text { font-size: 11px; color: var(--text-3); }

    .trade-side {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 46px; height: 22px;
      border-radius: 5px;
      font-family: var(--font-mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.8px;
    }

    .trade-side.long { background: var(--green-dim); color: var(--green); }
    .trade-side.short { background: var(--red-dim); color: var(--red); }

    .setup-badge {
      font-size: 11px;
      font-family: var(--font-mono);
      background: var(--bg-3);
      border: 1px solid var(--border);
      padding: 2px 7px;
      border-radius: 4px;
      color: var(--text-2);
    }

    .mono { font-family: var(--font-mono); font-size: 13px; }
    .pos { color: var(--green); }
    .neg { color: var(--red); }

    .btn-delete {
      background: none;
      border: none;
      color: var(--text-3);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      transition: all 0.15s;
      display: flex;
      align-items: center;
    }

    .btn-delete:hover { color: var(--red); background: var(--red-dim); }

    .btn-load-more {
      width: 100%;
      background: none;
      border: 1px dashed var(--border);
      color: var(--text-2);
      padding: 12px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 13px;
      margin-top: 8px;
      transition: all 0.15s;
    }

    .btn-load-more:hover { border-color: var(--blue); color: var(--blue-bright); }

    .loading-state, .empty-state { color: var(--text-2); padding: 3rem; text-align: center; }
    .empty-state small { display: block; font-size: 12px; color: var(--text-3); margin-top: 4px; }

    /* ─── Modal ─── */
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s;
    }

    .modal {
      background: var(--bg-2);
      border: 1px solid var(--border-hover);
      border-radius: 16px;
      width: 560px;
      max-height: 90vh;
      overflow-y: auto;
      animation: slideUp 0.25s;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
    }

    .modal-header {
      padding: 22px 24px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-title {
      font-family: var(--font-display);
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--text);
    }

    .modal-close {
      width: 30px; height: 30px;
      border-radius: 8px;
      background: var(--bg-3);
      border: 1px solid var(--border);
      color: var(--text-2);
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }

    .modal-close:hover { background: var(--red-dim); color: var(--red); }

    .modal-body { padding: 22px 24px; }

    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .form-full { grid-column: 1 / -1; }

    .field { display: flex; flex-direction: column; gap: 6px; }

    .field label {
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 500;
      color: var(--text-3);
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .field input, .field select, .field textarea {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text);
      font-size: 13.5px;
      font-family: var(--font-body);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      width: 100%;
    }

    .field input:focus, .field select:focus, .field textarea:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .field textarea { resize: vertical; min-height: 72px; }
    .field select option { background: var(--bg-2); }

    /* ─── Emotion selector ─── */
    .emotion-selector {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
    }

    .emotion-btn {
      padding: 10px 6px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg-card);
      cursor: pointer;
      text-align: center;
      font-size: 18px;
      transition: all 0.15s;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      color: var(--text-3);
    }

    .emotion-btn span:last-child {
      font-size: 9px;
      font-family: var(--font-mono);
      color: var(--text-3);
      letter-spacing: 0.5px;
    }

    .emotion-btn:hover, .emotion-btn.selected {
      border-color: var(--blue);
      background: var(--blue-glow);
      color: var(--blue-bright);
    }

    .emotion-btn.selected span:last-child { color: var(--blue-bright); }

    /* ─── Form actions ─── */
    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }

    .btn-cancel {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-2);
      border-radius: 8px;
      padding: 9px 18px;
      font-size: 13px;
      cursor: pointer;
      font-family: var(--font-body);
      transition: all 0.15s;
    }

    .btn-cancel:hover { background: var(--bg-3); border-color: var(--border-hover); color: var(--text); }

    .btn-submit {
      background: var(--blue);
      border: none;
      color: white;
      border-radius: 8px;
      padding: 9px 20px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: var(--font-body);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
      transition: all 0.15s;
    }

    .btn-submit:hover { background: var(--blue-bright); transform: translateY(-1px); }
    .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

    .error-msg {
      background: var(--red-dim);
      border: 1px solid var(--red);
      color: var(--red);
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12px;
    }
  `],
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
