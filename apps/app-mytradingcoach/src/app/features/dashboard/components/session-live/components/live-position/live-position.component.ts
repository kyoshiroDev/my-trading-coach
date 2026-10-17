import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, interval, of } from 'rxjs';
import type { LiveBrokerState } from '@mtc/shared';
import { TradovateApi } from '@app/core/api/tradovate.api';
import type { SessionTrade } from '@app/core/api/session.api';
import type { InstrumentDto } from '@app/core/api/trades.api';
import { SessionStore } from '@app/core/stores/session.store';
import { MoneyService } from '@app/core/services/money.service';
import { NumericInputDirective } from '@app/core/directives/numeric-input.directive';
import { parseDecimal } from '@app/core/utils/parse-decimal';
import { InfoTooltipComponent } from '@app/shared/components/info-tooltip/info-tooltip.component';
import { closeKind, formatPrice, pointValue, positionBar, priceFromLatent } from '../../session-live.util';

/** Position affichée : chez le broker (lecture seule) ou trade saisi à la main encore ouvert. */
interface CurrentTrade {
  kind: 'broker' | 'manual';
  tradeId: string | null;
  side: 'LONG' | 'SHORT';
  asset: string;
  quantity: number | null;
  entry: number | null;
  since: string | null;
  stop: number | null;
  target: number | null;
  /** Latent ; null = inconnu (jamais un chiffre inventé). */
  latent: number | null;
  /** Prix au relevé du latent, déduit (une seule position), sinon null. */
  price: number | null;
  priceAt: string | null;
}

/**
 * « Trade en cours » de la session live v3 (#598) : une position à la fois, latent en grand,
 * barre SL / entrée / TP, et « Clôturer ce trade » pour un trade saisi à la main.
 *
 * Position broker (Tradovate, rôles bêta) : lecture seule, elle devient un trade à la sortie. Les
 * ordres SL/TP ne sont pas lus (#601) → barre de repli entrée → prix au relevé. Le prix vient du
 * latent broker (cotations refusées à MTC), relu à chaque événement du compte ou sur « Actualiser »
 * (bridé 20 s côté API), jamais en boucle : d'où l'heure du relevé à côté.
 */
@Component({
  selector: 'mtc-live-position',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InfoTooltipComponent, NumericInputDirective],
  styleUrl: './live-position.component.css',
  templateUrl: './live-position.component.html',
})
export class LivePositionComponent {
  readonly broker = input<LiveBrokerState | null>(null);
  /** Trades du jour encore ouverts (saisis à la main, sans sortie). */
  readonly openTrades = input<SessionTrade[]>([]);
  readonly instruments = input<InstrumentDto[]>([]);
  readonly accountId = input<string | null>(null);
  readonly tradeClosed = output<{ tradeId: string; exitPrice: number }>();

  private readonly tradovateApi = inject(TradovateApi);
  private readonly session = inject(SessionStore);
  private readonly money = inject(MoneyService);
  private readonly destroyRef = inject(DestroyRef);

  /** Horloge 5 s : « ouvert depuis » avance sans relire le broker. */
  private readonly now = signal(Date.now());
  protected readonly refreshing = signal(false);
  protected readonly closing = signal(false);
  protected readonly exitPriceInput = signal('');

  protected readonly tooltip =
    'Latent : résultat de la position ouverte calculé par Tradovate avec ses cotations, relu à ' +
    'chaque entrée, sortie ou renfort, et sur « Actualiser » : il ne suit pas chaque tick. Le prix ' +
    'affiché en est déduit, à l’heure du relevé.';

  protected readonly positions = computed(() => this.broker()?.openPositions ?? []);

  protected readonly current = computed<CurrentTrade | null>(() => {
    const b = this.broker();
    const p = this.positions()[0];
    if (b && p) {
      const single = this.positions().length === 1;
      const pv = pointValue(p.asset, this.instruments());
      return {
        kind: 'broker', tradeId: null, side: p.side, asset: p.asset, quantity: p.quantity,
        entry: p.entryPrice, since: p.since, stop: null, target: null, latent: b.openPnl,
        price: single ? priceFromLatent(p.side, p.entryPrice, p.quantity, b.openPnl, pv) : null,
        priceAt: b.openPnlAt,
      };
    }
    const t = this.openTrades()[0];
    if (!t) return null;
    return {
      kind: 'manual', tradeId: t.id, side: t.side, asset: t.asset, quantity: t.quantity ?? null,
      entry: t.entry, since: t.tradedAt, stop: t.stopLoss, target: t.takeProfit, latent: null,
      price: null, priceAt: null,
    };
  });

  protected readonly bar = computed(() => {
    const c = this.current();
    if (!c || c.entry === null) return null;
    return positionBar({
      side: c.side, entry: c.entry, stop: c.stop, target: c.target, current: c.price,
      quantity: c.quantity, pv: pointValue(c.asset, this.instruments()),
    });
  });

  protected readonly openedFor = computed(() => {
    const since = this.current()?.since;
    if (!since) return '';
    const min = Math.floor((this.now() - new Date(since).getTime()) / 60_000);
    if (!Number.isFinite(min) || min < 0) return '';
    return min < 60 ? `ouvert depuis ${min} min` : `ouvert depuis ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  });

  constructor() {
    interval(5_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  protected readonly price = formatPrice;

  protected fmt(value: number, sign = false): string {
    return this.money.formatFor(this.accountId(), value, { decimals: 0, sign });
  }

  protected timeOf(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  protected exitKind(): string {
    const c = this.current();
    const exit = parseDecimal(this.exitPriceInput());
    if (!c || exit === undefined) return '';
    const kind = closeKind({ side: c.side, exit, stopLoss: c.stop, takeProfit: c.target });
    return kind === 'Manuel' ? 'Clôture manuelle' : `${kind} détecté`;
  }

  protected toggleClose(): void {
    this.closing.update((v) => !v);
    this.exitPriceInput.set('');
  }

  protected submitClose(): void {
    const id = this.current()?.tradeId;
    const exitPrice = parseDecimal(this.exitPriceInput());
    if (!id || exitPrice == null || exitPrice <= 0) return;
    this.tradeClosed.emit({ tradeId: id, exitPrice });
    this.closing.set(false);
    this.exitPriceInput.set('');
  }

  protected refresh(): void {
    const id = this.accountId();
    if (!id || this.refreshing()) return;
    this.refreshing.set(true);
    this.tradovateApi
      .refreshBalance(id)
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.refreshing.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.session.refreshLive());
  }
}
