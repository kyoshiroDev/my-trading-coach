import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
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

type NumericField = 'entry' | 'exit' | 'stopLoss' | 'takeProfit' | 'quantity';

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

  // ── Form signal (résout OnPush + mutation non détectée) ───────────────────
  protected readonly form = signal<Partial<CreateTradeDto>>(this.emptyForm());

  protected readonly selectedInstrument = computed(
    () =>
      this.instruments().find(
        (i) => i.symbol.toLowerCase() === (this.form().asset ?? '').toLowerCase(),
      ) ?? null,
  );

  protected readonly unknownInstrumentWarning = computed(() => {
    const asset = this.form().asset;
    if (!asset || asset.length < 2) return null;
    const found = this.instruments().find(
      (i) => i.symbol.toLowerCase() === asset.toLowerCase(),
    );
    const looksLikeFuture = !asset.includes('/') &&
      !asset.includes('USD') && asset.length <= 5;
    if (!found && looksLikeFuture) {
      return `"${asset}" non reconnu — sélectionne depuis la liste pour un P&L correct`;
    }
    return null;
  });
  // ─────────────────────────────────────────────────────────────────────────

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
          emotion: t.emotion as CreateTradeDto['emotion'],
          setup: t.setup as CreateTradeDto['setup'],
          session: t.session as CreateTradeDto['session'],
          timeframe: t.timeframe,
          notes: t.notes ?? undefined,
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

  protected recalculate(): void {
    const { entry, exit, stopLoss, takeProfit, side, quantity } = this.form();
    const mode = this.exitMode();
    const instrument = this.selectedInstrument();
    const tickValue = instrument?.tickValue ?? null;
    const qty = quantity ?? 1;

    if (exit != null && exit > 0 && mode !== null) {
      this.exitMode.set(null);
    }

    let effectiveExit: number | undefined;
    if (exit != null && exit > 0) {
      effectiveExit = exit;
    } else if (mode === 'SL' && stopLoss != null && stopLoss > 0) {
      effectiveExit = stopLoss;
    } else if (mode === 'TP' && takeProfit != null && takeProfit > 0) {
      effectiveExit = takeProfit;
    }

    if (entry != null && entry > 0 && effectiveExit != null && side) {
      const points = side === 'LONG'
        ? effectiveExit - entry
        : entry - effectiveExit;

      const pnl = tickValue != null
        ? points * tickValue * qty
        : points * qty;

      const pct = (points / entry) * 100;
      this.autoPnl.set(+pnl.toFixed(2));
      this.autoPnlPct.set(+pct.toFixed(2));
      this.form.update(f => ({ ...f, pnl: +pnl.toFixed(2) }));
    } else {
      this.autoPnl.set(undefined);
      this.autoPnlPct.set(undefined);
      this.form.update(f => ({ ...f, pnl: undefined }));
    }

    if (entry != null && entry > 0 && stopLoss != null && stopLoss > 0
        && takeProfit != null && takeProfit > 0 && side) {
      const risk = Math.abs(entry - stopLoss);
      const reward = side === 'LONG' ? takeProfit - entry : entry - takeProfit;
      if (risk > 0 && reward > 0) {
        const rr = +(reward / risk).toFixed(2);
        this.autoRR.set(rr);
        this.form.update(f => ({ ...f, riskReward: rr }));
      } else {
        this.autoRR.set(undefined);
        this.form.update(f => ({ ...f, riskReward: undefined }));
      }
    } else {
      this.autoRR.set(undefined);
      this.form.update(f => ({ ...f, riskReward: undefined }));
    }
  }

  onSubmit(): void {
    this.submitted.set(true);
    this.form.update(f => ({ ...f, pnl: this.autoPnl(), riskReward: this.autoRR() }));
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
      side:      'LONG'     as const,
      emotion:   'FOCUSED'  as const,
      setup:     'BREAKOUT' as const,
      session:   'LONDON'   as const,
      timeframe: '1h',
      quantity:  1,
    };
  }
}
