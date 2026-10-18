import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { SessionTrade } from '@app/core/api/session.api';
import { MoneyPipe } from '@app/shared/pipes/money.pipe';
import { netPnl } from '@mtc/shared';
import { closeKind, formatPrice } from '../../session-live.util';

/**
 * Trades clôturés de la session live v3 (remplace le live feed) : une ligne sur deux niveaux en
 * mobile (sens + actif + résultat ; heure, entrée → sortie, TP/SL/Manuel), grille alignée à partir
 * de 768 px. Les trades encore ouverts sont dans « Trade en cours ».
 */
@Component({
  selector: 'mtc-live-closed-trades',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MoneyPipe],
  styleUrl: './live-closed-trades.component.css',
  templateUrl: './live-closed-trades.component.html',
})
export class LiveClosedTradesComponent {
  readonly trades = input<SessionTrade[]>([]);
  /** Faux quand Trade rapide est déjà affiché (compte non synchronisé) : le lien ne servirait à rien. */
  readonly canEnterManually = input(true);
  /** « Saisir un trade à la main » : le parent affiche Trade rapide. */
  readonly manualEntry = output<void>();

  protected readonly closed = computed(() =>
    this.trades()
      .filter((t) => t.pnl !== null)
      .map((t) => ({ trade: t, net: netPnl(t) ?? 0, kind: closeKind(t) })),
  );
  protected readonly winners = computed(() => this.closed().filter((r) => r.net > 0).length);

  protected readonly price = formatPrice;

  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
