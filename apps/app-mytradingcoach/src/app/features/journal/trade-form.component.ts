import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { LucideAngularModule, X } from 'lucide-angular';
import { Trade } from '../../core/stores/trades.store';
import { CreateTradeDto, InstrumentDto, TradesApi } from '../../core/api/trades.api';
import { CreateTradeSchema } from '../../core/schemas/trade.schema';

const EMOTIONS: Trade['emotion'][] = ['CONFIDENT', 'FOCUSED', 'NEUTRAL', 'STRESSED', 'FEAR', 'REVENGE'];
const SETUPS: Trade['setup'][] = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];
const SESSIONS: Trade['session'][] = ['LONDON', 'NEW_YORK', 'ASIAN'];
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];

const EMOTION_EMOJIS: Record<string, string> = {
  CONFIDENT: '😎', FOCUSED: '🎯', NEUTRAL: '😐', STRESSED: '😰', FEAR: '😨', REVENGE: '🤬',
};

type NumericField = 'entry' | 'exit' | 'stopLoss' | 'takeProfit' | 'quantity' | 'capitalEngaged';

@Component({
  selector: 'mtc-trade-form',
  standalone: true,
  imports: [FormsModule, TitleCasePipe, DecimalPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './trade-form.component.html',
  styleUrl: './trade-form.component.css',
})
export class TradeFormComponent {
  readonly open = input(false);
  readonly editTrade = input<Trade | null>(null);
  readonly isSaving = input(false);
  readonly apiError = input<string | null>(null);
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
  protected readonly exitTouched = signal(false);
  protected readonly leverage = signal<number>(1);

  // ── Autocomplete instruments ──────────────────────────────────────────────
  private readonly tradesApi = inject(TradesApi);

  protected readonly instruments = toSignal(
    this.tradesApi.getInstruments().pipe(
      map((r) => r.data),
      catchError(() => of([] as InstrumentDto[])),
    ),
    { initialValue: [] as InstrumentDto[] },
  );

  protected readonly assetSearch = signal('');
  protected readonly showDropdown = signal(false);

  protected readonly filteredInstruments = computed(() => {
    const search = this.assetSearch().toLowerCase().trim();
    if (search.length < 1) return [];
    return this.instruments()
      .filter(
        (i) =>
          i.symbol.toLowerCase().includes(search) ||
          i.label.toLowerCase().includes(search),
      )
      .slice(0, 8);
  });

  // ── Form signal ────────────────────────────────────────────────────────────
  protected readonly form = signal<Partial<CreateTradeDto>>(this.emptyForm());

  protected readonly selectedInstrument = computed(
    () =>
      this.instruments().find(
        (i) => i.symbol.toLowerCase() === (this.form().asset ?? '').toLowerCase(),
      ) ?? null,
  );

  protected readonly calculationMode = computed<'futures' | 'forex' | 'crypto-spot' | 'crypto-leverage'>(() => {
    const instr = this.selectedInstrument();
    if (!instr) return 'crypto-spot';
    if (instr.category === 'FUTURES_US') return 'futures';
    if (instr.category === 'FOREX') return 'forex';
    return this.leverage() > 1 ? 'crypto-leverage' : 'crypto-spot';
  });

  protected readonly showCapital = computed(() =>
    this.calculationMode() === 'crypto-spot' ||
    this.calculationMode() === 'crypto-leverage',
  );

  protected readonly liquidationPrice = computed(() => {
    const f = this.form();
    const entry = f.entry ?? 0;
    const lev = this.leverage();
    const mode = this.calculationMode();
    if (!entry || lev <= 1 || mode === 'futures' || mode === 'forex') return null;
    return f.side === 'LONG'
      ? entry * (1 - 1 / lev)
      : entry * (1 + 1 / lev);
  });

  protected readonly autoPoints = computed<number | undefined>(() => {
    const instr = this.selectedInstrument();
    const calcMode = this.calculationMode();
    if (!instr || instr.tickValue === null) return undefined;
    if (calcMode !== 'futures' && calcMode !== 'forex') return undefined;

    const f = this.form();
    const entry = f.entry ?? 0;
    const exit = f.exit ?? 0;
    const sl = f.stopLoss ?? 0;
    const tp = f.takeProfit ?? 0;
    const mode = this.exitMode();
    const isLong = f.side === 'LONG';

    if (!entry) return undefined;

    let effectiveExit = 0;
    if (exit > 0) {
      effectiveExit = exit;
    } else if (mode === 'SL' && sl > 0) {
      effectiveExit = sl;
    } else if (mode === 'TP' && tp > 0) {
      effectiveExit = tp;
    }

    if (!effectiveExit) return undefined;

    const rawPoints = isLong ? effectiveExit - entry : entry - effectiveExit;
    if (calcMode === 'forex') {
      const pipDecimals = instr.pipDecimals ?? 4;
      const pipSize = Math.pow(10, -pipDecimals);
      return rawPoints / pipSize;
    }
    return rawPoints;
  });

  protected readonly todayMax = computed(() =>
    new Date().toLocaleDateString('sv-SE'),
  );
  // ──────────────────────────────────────────────────────────────────────────

  constructor() {
    effect(() => {
      this.open();
      const t = this.editTrade();
      if (t) {
        this.form.set({
          asset: t.asset,
          side: t.side,
          entry: t.entry,
          exit: t.exit ?? undefined,
          stopLoss: t.stopLoss ?? undefined,
          takeProfit: t.takeProfit ?? undefined,
          pnl: t.pnl ?? undefined,
          riskReward: t.riskReward ?? undefined,
          quantity: t.quantity ?? 1,
          capitalEngaged: t.capitalEngaged ?? undefined,
          emotion: t.emotion as CreateTradeDto['emotion'],
          setup: t.setup as CreateTradeDto['setup'],
          session: t.session as CreateTradeDto['session'],
          timeframe: t.timeframe,
          notes: t.notes ?? undefined,
          tradedAt: t.tradedAt
            ? new Date(t.tradedAt).toLocaleDateString('sv-SE')
            : new Date().toLocaleDateString('sv-SE'),
        });
        this.assetSearch.set(t.asset);
        this.autoPnl.set(t.pnl ?? undefined);
        this.autoPnlPct.set(t.pnl != null && t.entry > 0 ? +(t.pnl / t.entry * 100).toFixed(2) : undefined);
        this.autoRR.set(t.riskReward ?? undefined);
      } else {
        this.form.set(this.emptyForm());
        this.assetSearch.set('');
        this.autoPnl.set(undefined);
        this.autoPnlPct.set(undefined);
        this.autoRR.set(undefined);
      }
      this.leverage.set(1);
      this.exitMode.set(null);
      this.exitTouched.set(false);
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
    this.form.update(f => ({ ...f, side }));
    this.recalculate();
  }

  protected setEmotion(emotion: string): void {
    this.form.update(f => ({ ...f, emotion: emotion as CreateTradeDto['emotion'] }));
  }

  protected onExitBlur(): void {
    if (!this.form().exit) {
      this.exitTouched.set(true);
      if (this.exitMode() === null) {
        this.exitMode.set('TP');
        this.recalculate();
      }
    }
  }

  protected setExitMode(mode: 'SL' | 'TP'): void {
    this.exitMode.set(this.exitMode() === mode ? null : mode);
    this.recalculate();
  }

  protected filterNumeric(event: Event, field: NumericField): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^\d.,]/g, '');
    const parsed = parseFloat(input.value.replace(',', '.'));
    this.form.update(f => ({ ...f, [field]: isNaN(parsed) ? undefined : parsed }));
    this.recalculate();
  }

  protected onAssetInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = input.value.toUpperCase();
    input.value = val;
    this.assetSearch.set(val);
    this.form.update(f => ({ ...f, asset: val }));
    this.recalculate();
  }

  protected onAssetBlur(): void {
    setTimeout(() => this.showDropdown.set(false), 150);
  }

  protected selectInstrument(instrument: InstrumentDto): void {
    this.form.update(f => ({ ...f, asset: instrument.symbol }));
    this.assetSearch.set(instrument.symbol);
    this.showDropdown.set(false);
    this.recalculate();
  }

  protected onLeverageInput(e: Event): void {
    const val = (e.target as HTMLInputElement).value;
    const n = parseFloat(val.replace(',', '.'));
    this.leverage.set(isNaN(n) || n < 1 ? 1 : n);
    this.recalculate();
  }

  protected recalculate(): void {
    const f = this.form();
    const exitMode = this.exitMode();
    const entry = f.entry ?? 0;
    const exit = f.exit ?? 0;
    const sl = f.stopLoss ?? 0;
    const tp = f.takeProfit ?? 0;
    const qty = f.quantity ?? 1;
    const capital = f.capitalEngaged ?? 0;
    const lev = this.leverage();
    const isLong = f.side === 'LONG';
    const calcMode = this.calculationMode();
    const instr = this.selectedInstrument();

    if (exit > 0 && exitMode !== null) {
      this.exitMode.set(null);
    }

    let effectiveExit = 0;
    if (exit > 0) {
      effectiveExit = exit;
    } else if (exitMode === 'SL' && sl > 0) {
      effectiveExit = sl;
    } else if (exitMode === 'TP' && tp > 0) {
      effectiveExit = tp;
    }

    // R/R (commun à tous les modes)
    if (entry > 0 && sl > 0 && tp > 0) {
      const reward = Math.abs(tp - entry);
      const risk = Math.abs(entry - sl);
      if (risk > 0) {
        const rr = +(reward / risk).toFixed(2);
        this.autoRR.set(rr);
        this.form.update(ff => ({ ...ff, riskReward: rr }));
      } else {
        this.autoRR.set(undefined);
        this.form.update(ff => ({ ...ff, riskReward: undefined }));
      }
    } else {
      this.autoRR.set(undefined);
      this.form.update(ff => ({ ...ff, riskReward: undefined }));
    }

    // P&L
    if (!entry || !effectiveExit) {
      this.autoPnl.set(undefined);
      this.autoPnlPct.set(undefined);
      this.form.update(ff => ({ ...ff, pnl: undefined }));
      return;
    }

    if ((calcMode === 'futures' || calcMode === 'forex') && instr?.tickValue) {
      const rawPoints = isLong ? effectiveExit - entry : entry - effectiveExit;
      let points = rawPoints;
      if (calcMode === 'forex') {
        const pipDecimals = instr.pipDecimals ?? 4;
        const pipSize = Math.pow(10, -pipDecimals);
        points = rawPoints / pipSize;
      }
      const pnl = +(points * instr.tickValue * qty).toFixed(2);
      this.autoPnl.set(pnl);
      this.autoPnlPct.set(undefined);
      this.form.update(ff => ({ ...ff, pnl }));
    } else {
      const variation = isLong
        ? (effectiveExit - entry) / entry
        : (entry - effectiveExit) / entry;
      if (capital > 0) {
        const pnl = +(variation * capital * lev).toFixed(2);
        const pct = +(variation * lev * 100).toFixed(2);
        this.autoPnl.set(pnl);
        this.autoPnlPct.set(pct);
        this.form.update(ff => ({ ...ff, pnl }));
      } else {
        this.autoPnl.set(undefined);
        this.autoPnlPct.set(undefined);
        this.form.update(ff => ({ ...ff, pnl: undefined }));
      }
    }
  }

  onSubmit(): void {
    this.submitted.set(true);
    // Convertit YYYY-MM-DD en ISO datetime pour le backend
    const tradedAt = this.form().tradedAt;
    const tradedAtIso = tradedAt
      ? new Date(tradedAt + 'T12:00:00').toISOString()
      : new Date().toISOString();
    this.form.update(f => ({
      ...f,
      pnl: this.autoPnl(),
      riskReward: this.autoRR(),
      tradedAt: tradedAtIso,
    }));
    const result = CreateTradeSchema.safeParse(this.form());
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((e) => {
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
      side:           'LONG'     as const,
      emotion:        'FOCUSED'  as const,
      setup:          'BREAKOUT' as const,
      session:        'LONDON'   as const,
      timeframe:      '1h',
      quantity:       1,
      capitalEngaged: undefined,
      tradedAt:       new Date().toLocaleDateString('sv-SE'),
    };
  }
}
