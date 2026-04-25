import {
  ChangeDetectionStrategy, Component, effect, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { Trade } from '../../core/stores/trades.store';
import { CreateTradeDto } from '../../core/api/trades.api';
import { CreateTradeSchema } from '../../core/schemas/trade.schema';

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
      <div class="overlay" role="presentation" (click)="onOverlayClick($event)" (keydown.escape)="dismissed.emit()">
        <div class="modal" role="dialog" aria-modal="true" data-testid="trade-modal">
          <!-- Header -->
          <div class="modal-header">
            <h2 class="modal-title">{{ editTrade() ? 'Modifier le trade' : 'Nouveau trade' }}</h2>
            <button class="close-btn" (click)="dismissed.emit()">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>

          <form (ngSubmit)="onSubmit()" class="modal-body">
            <!-- Row 1: Asset + Side -->
            <div class="form-row">
              <div class="form-group">
                <label for="tf-asset">Actif</label>
                <input id="tf-asset" data-testid="trade-asset" type="text" [(ngModel)]="form.asset" name="asset" required
                  placeholder="BTC/USDT" [class.input-error]="submitted() && (!form.asset || zodErrors()['asset'])" />
                @if (submitted() && (!form.asset || zodErrors()['asset'])) {
                  <span class="field-error">{{ zodErrors()['asset'] || 'Asset requis' }}</span>
                }
              </div>
              <div class="form-group">
                <span class="field-label">Direction</span>
                <div class="side-toggle" [class.input-error]="submitted() && zodErrors()['side']">
                  <button type="button" data-testid="trade-side-long" class="side-btn" [class.active-long]="form.side === 'LONG'" (click)="setSide('LONG')">LONG</button>
                  <button type="button" data-testid="trade-side-short" class="side-btn" [class.active-short]="form.side === 'SHORT'" (click)="setSide('SHORT')">SHORT</button>
                </div>
                @if (submitted() && zodErrors()['side']) {
                  <span class="field-error">Direction requise (LONG ou SHORT)</span>
                }
              </div>
            </div>

            <!-- Row 2: Entry + Exit -->
            <div class="form-row">
              <div class="form-group">
                <label for="tf-entry">Entry</label>
                <input id="tf-entry" data-testid="trade-entry" type="number" [(ngModel)]="form.entry" name="entry" required
                  placeholder="0.00" step="any" (ngModelChange)="recalculate()"
                  [class.input-error]="submitted() && (!form.entry || zodErrors()['entry'])" />
                @if (submitted() && (!form.entry || zodErrors()['entry'])) {
                  <span class="field-error">{{ zodErrors()['entry'] || 'Entry requis (doit être > 0)' }}</span>
                }
              </div>
              <div class="form-group">
                <label for="tf-exit">Exit <span class="optional">(optionnel)</span></label>
                <input id="tf-exit" type="number" [(ngModel)]="form.exit" name="exit"
                  placeholder="0.00" step="any" (ngModelChange)="recalculate()" />
              </div>
            </div>

            <!-- Row 3: SL + TP -->
            <div class="form-row">
              <div class="form-group">
                <label for="tf-sl">Stop Loss <span class="optional">(optionnel)</span></label>
                <input id="tf-sl" type="number" [(ngModel)]="form.stopLoss" name="stopLoss"
                  placeholder="0.00" step="any" (ngModelChange)="recalculate()" />
              </div>
              <div class="form-group">
                <label for="tf-tp">Take Profit <span class="optional">(optionnel)</span></label>
                <input id="tf-tp" type="number" [(ngModel)]="form.takeProfit" name="takeProfit"
                  placeholder="0.00" step="any" (ngModelChange)="recalculate()" />
              </div>
            </div>

            <!-- Row 4: PnL + RR (calculés auto) -->
            <div class="form-row">
              <div class="form-group">
                <label for="tf-pnl">P&amp;L ($) <span class="optional">(calculé auto)</span></label>
                <input id="tf-pnl" type="number" [value]="autoPnl() ?? ''" name="pnl" readonly
                  placeholder="—" step="any"
                  [class.pnl-positive]="(autoPnl() ?? 0) > 0"
                  [class.pnl-negative]="(autoPnl() ?? 0) < 0" />
                @if (autoPnlPct() !== undefined) {
                  <span class="pnl-pct"
                    [class.pnl-positive]="(autoPnlPct() ?? 0) > 0"
                    [class.pnl-negative]="(autoPnlPct() ?? 0) < 0">
                    {{ (autoPnlPct() ?? 0) >= 0 ? '+' : '' }}{{ autoPnlPct()?.toFixed(2) }}%
                  </span>
                }
              </div>
              <div class="form-group">
                <label for="tf-rr">R/R <span class="optional">(calculé auto)</span></label>
                <input id="tf-rr" type="number" [value]="autoRR() ?? ''" name="riskReward" readonly
                  placeholder="—" step="any" />
              </div>
            </div>

            <!-- Emotion selector -->
            <div class="form-group">
              <span class="field-label">État émotionnel</span>
              <div class="emotion-grid">
                @for (e of EMOTIONS; track e) {
                  <button
                    type="button"
                    class="emotion-btn"
                    [attr.data-testid]="'emotion-' + e.toLowerCase()"
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
                <label for="tf-setup">Setup</label>
                <select id="tf-setup" [(ngModel)]="form.setup" name="setup">
                  @for (s of SETUPS; track s) {
                    <option [value]="s">{{ s }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label for="tf-session">Session</label>
                <select id="tf-session" [(ngModel)]="form.session" name="session">
                  @for (s of SESSIONS; track s) {
                    <option [value]="s">{{ s }}</option>
                  }
                </select>
              </div>
              <div class="form-group">
                <label for="tf-timeframe">Timeframe</label>
                <select id="tf-timeframe" [(ngModel)]="form.timeframe" name="timeframe">
                  @for (tf of TIMEFRAMES; track tf) {
                    <option [value]="tf">{{ tf }}</option>
                  }
                </select>
              </div>
            </div>

            <!-- Notes -->
            <div class="form-group">
              <label for="tf-notes">Notes <span class="optional">(optionnel)</span></label>
              <textarea id="tf-notes" [(ngModel)]="form.notes" name="notes" rows="3" placeholder="Contexte, raison du trade, leçons apprises..."></textarea>
            </div>

            <!-- Footer -->
            <div class="modal-footer">
              <button type="button" class="btn-cancel" (click)="dismissed.emit()">Annuler</button>
              <button type="submit" data-testid="trade-submit" class="btn-save" [disabled]="isSaving()">
                @if (isSaving()) {
                  <span class="spinner"></span> Enregistrement...
                } @else {
                  {{ editTrade() ? 'Modifier' : 'Enregistrer' }}
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
      font-family: var(--font-display, 'Syne', sans-serif);
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

    label, .field-label {
      font-size: 11px;
      font-family: var(--font-mono, 'DM Mono', monospace);
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
      font-family: var(--font-body, 'DM Sans', sans-serif);
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
      font-family: var(--font-mono, 'DM Mono', monospace);
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
      font-family: var(--font-body, 'DM Sans', sans-serif);
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
      font-family: var(--font-body, 'DM Sans', sans-serif);
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
      font-family: var(--font-body, 'DM Sans', sans-serif);
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

    .input-error { border-color: var(--red) !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.1) !important; }
    .field-error { font-size: 11px; color: var(--red); margin-top: 2px; }
    .pnl-positive { color: var(--green); font-weight: 600; }
    .pnl-negative { color: var(--red); font-weight: 600; }
    input[readonly] { background: var(--bg-3); cursor: default; color: var(--text-2); }
    .pnl-pct { font-size: 11px; font-family: var(--font-mono, 'DM Mono', monospace); margin-top: 2px; }
  `],
})
export class TradeFormComponent {
  open = input(false);
  editTrade = input<Trade | null>(null);
  isSaving = input(false);
  dismissed = output<void>();
  formSave = output<CreateTradeDto>();

  protected readonly XIcon = X;
  protected readonly EMOTIONS = EMOTIONS;
  protected readonly SETUPS = SETUPS;
  protected readonly SESSIONS = SESSIONS;
  protected readonly TIMEFRAMES = TIMEFRAMES;
  protected readonly EMOTION_EMOJIS = EMOTION_EMOJIS;

  protected readonly submitted = signal(false);
  protected readonly autoPnl = signal<number | undefined>(undefined);
  protected readonly autoPnlPct = signal<number | undefined>(undefined);
  protected readonly autoRR = signal<number | undefined>(undefined);
  protected readonly zodErrors = signal<Record<string, string>>({});
  protected form: Partial<CreateTradeDto> = this.emptyForm();

  constructor() {
    effect(() => {
      const t = this.editTrade();
      if (t) {
        this.form = {
          asset: t.asset,
          side: t.side,
          entry: t.entry,
          exit: t.exit ?? undefined,
          stopLoss: t.stopLoss ?? undefined,
          takeProfit: t.takeProfit ?? undefined,
          pnl: t.pnl ?? undefined,
          riskReward: t.riskReward ?? undefined,
          emotion: t.emotion as CreateTradeDto['emotion'],
          setup: t.setup as CreateTradeDto['setup'],
          session: t.session as CreateTradeDto['session'],
          timeframe: t.timeframe,
          notes: t.notes ?? undefined,
        };
        this.autoPnl.set(t.pnl ?? undefined);
        this.autoPnlPct.set(t.pnl != null && t.entry > 0 ? +(t.pnl / t.entry * 100).toFixed(2) : undefined);
        this.autoRR.set(t.riskReward ?? undefined);
      } else {
        this.form = this.emptyForm();
        this.autoPnl.set(undefined);
        this.autoPnlPct.set(undefined);
        this.autoRR.set(undefined);
      }
      this.submitted.set(false);
      this.zodErrors.set({});
    });
  }

  onOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.dismissed.emit();
    }
  }

  protected setSide(side: 'LONG' | 'SHORT') {
    this.form.side = side;
    this.recalculate();
  }

  protected recalculate() {
    const { entry, exit, stopLoss, takeProfit, side } = this.form;

    // P&L en dollars : LONG = exit - entry | SHORT = entry - exit
    if (entry != null && entry > 0 && exit != null && exit > 0 && side) {
      const dollars = side === 'LONG' ? (exit - entry) : (entry - exit);
      const pct = (dollars / entry) * 100;
      this.autoPnl.set(+dollars.toFixed(2));
      this.autoPnlPct.set(+pct.toFixed(2));
      this.form.pnl = +dollars.toFixed(2);
    } else {
      this.autoPnl.set(undefined);
      this.autoPnlPct.set(undefined);
      this.form.pnl = undefined;
    }

    // R/R : reward / risk (depuis takeProfit + stopLoss avant-trade)
    if (entry != null && entry > 0 && stopLoss != null && stopLoss > 0 && takeProfit != null && takeProfit > 0 && side) {
      const risk   = Math.abs(entry - stopLoss);
      const reward = side === 'LONG' ? takeProfit - entry : entry - takeProfit;
      if (risk > 0 && reward > 0) {
        const rr = +(reward / risk).toFixed(2);
        this.autoRR.set(rr);
        this.form.riskReward = rr;
      } else {
        this.autoRR.set(undefined);
        this.form.riskReward = undefined;
      }
    } else {
      this.autoRR.set(undefined);
      this.form.riskReward = undefined;
    }
  }

  onSubmit() {
    this.submitted.set(true);
    this.form.pnl = this.autoPnl();
    this.form.riskReward = this.autoRR();
    const result = CreateTradeSchema.safeParse(this.form);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach(e => {
        const field = String(e.path[0] ?? 'form');
        if (!errors[field]) errors[field] = e.message;
      });
      this.zodErrors.set(errors);
      return;
    }
    this.zodErrors.set({});
    this.formSave.emit(result.data as CreateTradeDto);
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
