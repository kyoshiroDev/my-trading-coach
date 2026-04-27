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
const SESSIONS: Trade['session'][] = ['LONDON', 'NEW_YORK', 'ASIAN'];
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];

const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

type NumericField = 'entry' | 'exit' | 'stopLoss' | 'takeProfit';

@Component({
  selector: 'mtc-trade-form',
  standalone: true,
  imports: [FormsModule, TitleCasePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trade-form.component.html',
  styleUrl: './trade-form.component.css',
})
export class TradeFormComponent {
  readonly open = input(false);
  readonly editTrade = input<Trade | null>(null);
  readonly isSaving = input(false);
  readonly dismissed = output<void>();
  readonly formSave = output<CreateTradeDto>();

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
  protected readonly exitMode = signal<'SL' | 'TP' | null>(null);

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
      this.exitMode.set(null);
      this.submitted.set(false);
      this.zodErrors.set({});
    });
  }

  onOverlayClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('overlay')) {
      this.dismissed.emit();
    }
  }

  protected setSide(side: 'LONG' | 'SHORT'): void {
    this.form.side = side;
    this.recalculate();
  }

  protected setExitMode(mode: 'SL' | 'TP'): void {
    this.exitMode.set(this.exitMode() === mode ? null : mode);
    this.recalculate();
  }

  protected filterNumeric(event: Event, field: NumericField): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    const parsed = parseFloat(input.value.replace(',', '.'));
    this.form[field] = isNaN(parsed) ? undefined : parsed;
    this.recalculate();
  }

  protected recalculate(): void {
    const { entry, exit, stopLoss, takeProfit, side } = this.form;
    const mode = this.exitMode();

    // Reset exitMode si exit est renseigné
    if (exit != null && exit > 0 && mode !== null) {
      this.exitMode.set(null);
    }

    // P&L : priorité à exit, sinon SL/TP selon exitMode
    let effectiveExit: number | undefined;
    if (exit != null && exit > 0) {
      effectiveExit = exit;
    } else if (mode === 'SL' && stopLoss != null && stopLoss > 0) {
      effectiveExit = stopLoss;
    } else if (mode === 'TP' && takeProfit != null && takeProfit > 0) {
      effectiveExit = takeProfit;
    }

    if (entry != null && entry > 0 && effectiveExit != null && side) {
      const dollars = side === 'LONG' ? (effectiveExit - entry) : (entry - effectiveExit);
      const pct = (dollars / entry) * 100;
      this.autoPnl.set(+dollars.toFixed(2));
      this.autoPnlPct.set(+pct.toFixed(2));
      this.form.pnl = +dollars.toFixed(2);
    } else {
      this.autoPnl.set(undefined);
      this.autoPnlPct.set(undefined);
      this.form.pnl = undefined;
    }

    // R/R : toujours planifié (reward/risk depuis SL+TP+entry), jamais affecté par exitMode
    if (entry != null && entry > 0 && stopLoss != null && stopLoss > 0 && takeProfit != null && takeProfit > 0 && side) {
      const risk = Math.abs(entry - stopLoss);
      const reward = side === 'LONG' ? takeProfit - entry : entry - takeProfit;
      if (risk > 0 && reward > 0) {
        this.autoRR.set(+(reward / risk).toFixed(2));
        this.form.riskReward = this.autoRR();
      } else {
        this.autoRR.set(undefined);
        this.form.riskReward = undefined;
      }
    } else {
      this.autoRR.set(undefined);
      this.form.riskReward = undefined;
    }
  }

  onSubmit(): void {
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
