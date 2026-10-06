import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, finalize, interval, of } from 'rxjs';
import type { LiveBrokerState } from '@mtc/shared';
import { TradovateApi } from '@app/core/api/tradovate.api';
import { SessionStore } from '@app/core/stores/session.store';
import { MoneyService } from '@app/core/services/money.service';
import { InfoTooltipComponent } from '@app/shared/components/info-tooltip/info-tooltip.component';
import { ageLabel, liveTotals } from './live-position.util';

/**
 * « Trade en cours » de la session live (bêta) : positions ouvertes chez le broker dès l'entrée,
 * et P&L réalisé / latent / total comparable à Tradovate.
 *
 * Le latent vient du broker (ses cotations, refusées à MTC) et n'est relu qu'à un événement du
 * compte ou sur « Actualiser » (bridé 20 s côté API) : jamais en boucle, la doc Tradovate le
 * déconseille. D'où l'âge affiché à côté du chiffre.
 */
@Component({
  selector: 'mtc-live-position',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InfoTooltipComponent],
  styleUrl: './live-position.component.css',
  templateUrl: './live-position.component.html',
})
export class LivePositionComponent {
  readonly broker = input<LiveBrokerState | null>(null);
  /** P&L réalisé de la session (trades clôturés, frais déduits). */
  readonly realized = input<number>(0);
  readonly accountId = input<string | null>(null);

  private readonly tradovateApi = inject(TradovateApi);
  private readonly session = inject(SessionStore);
  private readonly money = inject(MoneyService);
  private readonly destroyRef = inject(DestroyRef);

  /** Horloge 5 s : l'âge du latent vieillit à l'écran sans relire le broker. */
  private readonly now = signal(Date.now());
  protected readonly refreshing = signal(false);

  protected readonly totals = computed(() => liveTotals(this.realized(), this.broker()));
  protected readonly latentAge = computed(() => ageLabel(this.broker()?.openPnlAt ?? null, this.now()));

  protected readonly tooltip =
    'Réalisé : trades clôturés de la session, frais déduits. Latent : résultat de la position ' +
    'ouverte calculé par Tradovate avec ses cotations, relu à chaque entrée, sortie ou renfort, ' +
    'et sur « Actualiser » : il ne suit pas chaque tick. Total = réalisé + latent.';

  constructor() {
    interval(5_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
  }

  protected fmt(value: number): string {
    return this.money.formatFor(this.accountId(), value);
  }

  protected sinceLabel(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : `depuis ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
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
