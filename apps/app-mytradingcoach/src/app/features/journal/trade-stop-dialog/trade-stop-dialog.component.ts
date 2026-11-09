import {
  ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, map, of } from 'rxjs';
import { plannedRiskReward, stopPlacementError, stopRiskAmount } from '@mtc/shared';
import { DialogDirective } from '@mtc/front-ui';
import { InstrumentDto, Trade, TradesApi } from '../../../core/api/trades.api';
import { MoneyPipe } from '../../../shared/pipes';

/** Saisie d'un prix : vide → null, sinon nombre (virgule décimale acceptée). NaN si illisible. */
function parsePrice(raw: string): number | null {
  const v = raw.trim().replace(',', '.');
  return v === '' ? null : Number(v);
}

/**
 * Saisie rapide du stop initial (et de l'objectif, facultatif) d'un trade depuis le Journal,
 * typiquement un trade synchronisé : la synchronisation ne récupère pas le stop. Aperçu en direct du
 * risque (table de valeur du point) et du R/R, mêmes règles que l'API (@mtc/shared), qui revérifie.
 */
@Component({
  selector: 'mtc-trade-stop-dialog',
  imports: [DialogDirective, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './trade-stop-dialog.component.css',
  templateUrl: './trade-stop-dialog.component.html',
})
export class TradeStopDialogComponent {
  private readonly tradesApi = inject(TradesApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly trade = input.required<Trade>();
  readonly dismissed = output<void>();
  readonly saved = output<Trade>();

  protected readonly stopRaw = signal('');
  protected readonly targetRaw = signal('');
  protected readonly isSaving = signal(false);
  protected readonly apiError = signal<string | null>(null);

  private readonly instruments = toSignal(
    this.tradesApi.getInstruments().pipe(
      map((r) => r.data),
      catchError(() => of([] as InstrumentDto[])),
    ),
    { initialValue: null },
  );

  constructor() {
    // Pré-remplit avec ce que le trade porte déjà (stop sans objectif, par exemple).
    effect(() => {
      const t = this.trade();
      this.stopRaw.set(t.stopLoss != null ? String(t.stopLoss) : '');
      this.targetRaw.set(t.takeProfit != null ? String(t.takeProfit) : '');
    });
  }

  protected readonly stop = computed(() => parsePrice(this.stopRaw()));
  protected readonly target = computed(() => parsePrice(this.targetRaw()));

  protected readonly instrument = computed(() => {
    const asset = this.trade().asset.toUpperCase();
    return this.instruments()?.find((i) => i.symbol.toUpperCase() === asset) ?? null;
  });

  /** Message de cohérence (côté du stop / de l'objectif), affiché dès qu'un prix est saisi. */
  protected readonly placementError = computed(() => {
    const t = this.trade();
    const stop = this.stop();
    const target = this.target();
    if (stop == null) return null;
    if (Number.isNaN(stop)) return 'Le stop doit être un nombre.';
    if (target != null && Number.isNaN(target)) return "L'objectif doit être un nombre.";
    return stopPlacementError(t.side, t.entry, stop, target);
  });

  protected readonly valid = computed(() => this.stop() != null && this.placementError() === null);

  /** Risque en devise du compte ; null si l'instrument n'a pas de valeur du point connue. */
  protected readonly riskAmount = computed(() => {
    if (!this.valid()) return null;
    const t = this.trade();
    const i = this.instrument();
    return stopRiskAmount(t.entry, this.stop() as number, t.quantity, i?.tickSize, i?.tickValue);
  });

  protected readonly riskPoints = computed(() =>
    this.valid() ? +Math.abs(this.trade().entry - (this.stop() as number)).toFixed(6) : null);

  protected readonly riskReward = computed(() => {
    if (!this.valid()) return null;
    const t = this.trade();
    return plannedRiskReward(t.side, t.entry, this.stop(), this.target()) ?? null;
  });

  /** Valeur du point manquante : on le dit au lieu de deviner un montant. */
  protected readonly missingPointValue = computed(() =>
    this.instruments() !== null && this.instrument()?.tickValue == null);

  protected onInput(field: 'stop' | 'target', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    (field === 'stop' ? this.stopRaw : this.targetRaw).set(value);
    this.apiError.set(null);
  }

  protected save(): void {
    if (!this.valid() || this.isSaving()) return;
    this.isSaving.set(true);
    this.apiError.set(null);
    const t = this.trade();
    const target = this.target();
    // Objectif vidé alors qu'il existait → null (retiré) ; jamais saisi → absent (inchangé).
    const takeProfit = target ?? (t.takeProfit != null ? null : undefined);
    this.tradesApi
      .setStop(t.id, { stopLoss: this.stop() as number, ...(takeProfit !== undefined ? { takeProfit } : {}) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isSaving.set(false);
          this.saved.emit(res.data);
        },
        error: (err: HttpErrorResponse) => {
          const msg = (err?.error as { message?: string | string[] })?.message ?? "Le stop n'a pas pu être enregistré.";
          this.apiError.set(Array.isArray(msg) ? msg.join(', ') : String(msg));
          this.isSaving.set(false);
        },
      });
  }
}
