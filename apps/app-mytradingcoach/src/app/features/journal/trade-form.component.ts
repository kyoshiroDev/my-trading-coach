import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { Trade } from '../../core/stores/trades.store';
import { CreateTradeDto } from '../../core/api/trades.api';

const EMOTIONS: Trade['emotion'][] = ['CONFIDENT', 'FOCUSED', 'NEUTRAL', 'STRESSED', 'FEAR', 'REVENGE'];
const SETUPS: Trade['setup'][] = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];
const SESSIONS: Trade['session'][] = ['LONDON', 'NEW_YORK', 'ASIAN', 'PRE_MARKET', 'OVERLAP'];
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];

const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

@Component({
  selector: 'mtc-trade-form',
  standalone: true,
  imports: [FormsModule, TitleCasePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="overlay" (click)="onOverlayClick($event)">
        <div class="modal" role="dialog" aria-modal="true">
          <!-- Header -->
          <div class="modal-header">
            <h2 class="modal-title">{{ editTrade ? 'Modifier le trade' : 'Nouveau trade' }}</h2>
            <button class="close-btn" (click)="cancel.emit()">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>

          <form (ngSubmit)="onSubmit()" class="modal-body">
            <!-- Row 1: Asset + Side -->
            <div class="form-row">
              <div class="form-group">
                <label>Actif</label>
                <input type="text" [(ngModel)]="form.asset" name="asset" required placeholder="BTC/USDT" />
              </div>
              <div class="form-group">
                <label>Direction</label>
                <div class="side-toggle">
                  <button type="button" class="side-btn" [class.active-long]="form.side === 'LONG'" (click)="form.side = 'LONG'">LONG</button>
                  <button type="button" class="side-btn" [class.active-short]="form.side === 'SHORT'" (click)="form.side = 'SHORT'">SHORT</button>
                </div>
              </div>
            </div>

            <!-- Row 2: Entry + Exit -->
            <div class="form-row">
              <div class="form-group">
                <label>Entry</label>
                <input type="number" [(ngModel)]="form.entry" name="entry" required placeholder="0.00" step="any" />
              </div>
              <div class="form-group">
                <label>Exit <span class="optional">(optionnel)</span></label>
                <input type="number" [(ngModel)]="form.exit" name="exit" placeholder="0.00" step="any" />
              </div>
            </div>

            <!-- Row 3: SL + TP -->
            <div class="form-row">
              <div class="form-group">
                <label>Stop Loss <span class="optional">(optionnel)</span></label>
                <input type="number" [(ngModel)]="form.stopLoss" name="stopLoss" placeholder="0.00" step="any" />
              </div>
              <div class="form-group">
                <label>Take Profit <span class="optional">(optionnel)</span></label>
                <input type="number" [(ngModel)]="form.takeProfit" name="takeProfit" placeholder="0.00" step="any" />
              </div>
            </div>

            <!-- Row 4: PnL + RR -->
            <div class="form-row">
              <div class="form-group">
                <label>P&amp;L ($) <span class="optional">(optionnel)</span></label>
                <input type="number" [(ngModel)]="form.pnl" name="pnl" placeholder="0.00" step="any" />
              </div>
              <div class="form-group">
                <label>R/R <span class="optional">(optionnel)</span></label>
                <input type="number" [(ngModel)]="form.riskReward" name="riskReward" placeholder="0.00" step="any" />
              </div>
            </div>

            <!-- Emotion selector -->
            <div class="form-group">
              <label>État émotionnel</label>
              <div class="emotion-grid">
                @for (e of EMOTIONS; track e) {
                  <button
                    type="button"
                    class="emotion-btn"
                    [class.selected]="form.emotion === e"
                    (click)="form.emotion = $any(e)"
                  >
                    {{ EMOTION_EMOJIS[e] }} {{ e | titlecase }}
                  </button>
                }
              </div>
            </div>

            <!-- Row: Setup + Session + Timeframe -->
            <div class="form-row trio">
              <div class="form-group">
                <label>Setup</label>
                <select [(ngModel)]="form.setup" name="setup">
                  @for (s of SETUPS; track s) {
                    <option [value]="s">{{ s }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label>Session</label>
                <select [(ngModel)]="form.session" name="session">
                  @for (s of SESSIONS; track s) {
                    <option [value]="s">{{ s }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label>Timeframe</label>
                <select [(ngModel)]="form.timeframe" name="timeframe">
                  @for (tf of TIMEFRAMES; track tf) {
                    <option [value]="tf">{{ tf }}</option>
                  }
                </select>
              </div>
            </div>

            <!-- Notes -->
            <div class="form-group">
              <label>Notes <span class="optional">(optionnel)</span></label>
              <textarea [(ngModel)]="form.notes" name="notes" rows="3" placeholder="Contexte, raison du trade, leçons apprises..."></textarea>
            </div>

            <!-- Footer -->
            <div class="modal-footer">
              <button type="button" class="btn-cancel" (click)="cancel.emit()">Annuler</button>
              <button type="submit" class="btn-save" [disabled]="isSaving()">
                @if (isSaving()) {
                  <span class="spinner"></span> Enregistrement...
                } @else {
                  {{ editTrade ? 'Modifier' : 'Enregistrer' }}
                }
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fadeIn 0.15s ease;
    }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    .modal {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 100%;
      max-width: 560px;
      max-height: 90vh;
      overflow-y: auto;
      animation: slideUp 0.2s ease;
    }

    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    /* ─── Header ─── */
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
    }

    .modal-title {
      font-family: var(--font-display);
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
    }

    .close-btn {
      width: 32px; height: 32px;
      border: none;
      border-radius: 8px;
      background: var(--bg-3);
      color: var(--text-2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .close-btn:hover { background: var(--border); color: var(--text); }

    /* ─── Body ─── */
    .modal-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }

    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-row.trio { grid-template-columns: 1fr 1fr 1fr; }

    .form-group { display: flex; flex-direction: column; gap: 6px; }

    label {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-2);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .optional { font-size: 10px; color: var(--text-3); }

    input, select, textarea {
      background: var(--bg-2);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 13px;
      font-family: var(--font-body);
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
      box-sizing: border-box;
    }

    input:focus, select:focus, textarea:focus {
      border-color: var(--blue);
      box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
    }

    input::placeholder, textarea::placeholder { color: var(--text-3); }

    select { cursor: pointer; }

    textarea { resize: vertical; min-height: 72px; }

    /* ─── Side toggle ─── */
    .side-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 4px;
    }

    .side-btn {
      padding: 7px;
      border: none;
      border-radius: 5px;
      font-size: 11px;
      font-family: var(--font-mono);
      font-weight: 600;
      cursor: pointer;
      background: transparent;
      color: var(--text-3);
      transition: all 0.15s;
    }

    .side-btn.active-long { background: rgba(16,185,129,0.15); color: var(--green); }
    .side-btn.active-short { background: rgba(239,68,68,0.15); color: var(--red); }

    /* ─── Emotion grid ─── */
    .emotion-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }

    .emotion-btn {
      padding: 8px 6px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-2);
      color: var(--text-2);
      font-size: 11px;
      font-family: var(--font-body);
      cursor: pointer;
      transition: all 0.15s;
      text-align: center;
    }

    .emotion-btn:hover { border-color: var(--border-hover); color: var(--text); }

    .emotion-btn.selected {
      background: var(--blue-glow);
      border-color: var(--blue);
      color: var(--blue-bright);
    }

    /* ─── Footer ─── */
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }

    .btn-cancel {
      padding: 9px 20px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-2);
      font-size: 13px;
      font-family: var(--font-body);
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-cancel:hover { background: var(--bg-3); color: var(--text); border-color: var(--border-hover); }

    .btn-save {
      padding: 9px 24px;
      background: var(--blue);
      border: none;
      border-radius: 8px;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      font-family: var(--font-body);
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 0 16px rgba(59,130,246,0.2);
    }

    .btn-save:hover:not(:disabled) { background: #2563eb; }
    .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }

    .spinner {
      width: 12px; height: 12px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class TradeFormComponent implements OnChanges {
  @Input() open = signal(false);
  @Input() editTrade: Trade | null = null;
  @Input() isSaving = signal(false);
  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateTradeDto>();

  protected readonly XIcon = X;
  protected readonly EMOTIONS = EMOTIONS;
  protected readonly SETUPS = SETUPS;
  protected readonly SESSIONS = SESSIONS;
  protected readonly TIMEFRAMES = TIMEFRAMES;
  protected readonly EMOTION_EMOJIS = EMOTION_EMOJIS;

  protected form: Partial<CreateTradeDto & { pnl?: number; riskReward?: number }> = this.emptyForm();

  ngOnChanges(changes: SimpleChanges) {
    if (changes['editTrade'] && this.editTrade) {
      this.form = {
        asset: this.editTrade.asset,
        side: this.editTrade.side,
        entry: this.editTrade.entry,
        exit: this.editTrade.exit ?? undefined,
        stopLoss: this.editTrade.stopLoss ?? undefined,
        takeProfit: this.editTrade.takeProfit ?? undefined,
        pnl: this.editTrade.pnl ?? undefined,
        riskReward: this.editTrade.riskReward ?? undefined,
        emotion: this.editTrade.emotion as CreateTradeDto['emotion'],
        setup: this.editTrade.setup as CreateTradeDto['setup'],
        session: this.editTrade.session as CreateTradeDto['session'],
        timeframe: this.editTrade.timeframe,
        notes: this.editTrade.notes ?? undefined,
      };
    } else if (changes['editTrade'] && !this.editTrade) {
      this.form = this.emptyForm();
    }
  }

  onOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.cancel.emit();
    }
  }

  onSubmit() {
    if (!this.form.asset || !this.form.entry || !this.form.emotion || !this.form.setup || !this.form.session || !this.form.side) return;
    this.save.emit(this.form as CreateTradeDto);
  }

  private emptyForm(): Partial<CreateTradeDto> {
    return {
      side: 'LONG',
      emotion: 'FOCUSED',
      setup: 'BREAKOUT',
      session: 'LONDON',
      timeframe: '1h',
    };
  }
}
