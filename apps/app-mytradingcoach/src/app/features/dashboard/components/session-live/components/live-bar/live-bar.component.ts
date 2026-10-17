import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { SessionClock } from '@app/core/utils/session-clock.util';
import type { BannerTicker } from '../../session-live.util';
import { MoneyService } from '@app/core/services/money.service';

/**
 * Bandeau de la session live v3, collant en haut : chrono (cyan = live), `Trades N / max`,
 * P&L total du jour (réalisé + latent). À partir de 768 px, sur une ligne : compte et plan,
 * humeur déclarée, contexte marché réduit (lien vers le détail) et « Clôturer la session ».
 * Session ouverte depuis plus de 24 h : alerte et clôture à la place du chrono (#595).
 */
@Component({
  selector: 'mtc-live-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './live-bar.component.css',
  templateUrl: './live-bar.component.html',
})
export class LiveBarComponent {
  readonly clock = input<SessionClock | null>(null);
  /** Réalisé + latent ; null si le latent d'une position ouverte est inconnu. */
  readonly totalPnl = input<number | null>(null);
  /** Réalisé seul, affiché quand le total est inconnu. */
  readonly realizedPnl = input<number>(0);
  readonly tradesCount = input<number>(0);
  /** Limite du profil (Stratégie de trading), null = pas de limite. */
  readonly tradesMax = input<number | null>(null);
  readonly accountId = input<string | null>(null);
  /** « Apex 50k · EOD » : nom du compte et type de plan. */
  readonly accountLabel = input<string | null>(null);
  readonly mood = input<string | null>(null);
  readonly tickers = input<BannerTicker[]>([]);
  readonly closeSession = output<void>();
  readonly openContext = output<void>();

  private readonly money = inject(MoneyService);

  protected fmt(v: number): string {
    return this.money.formatFor(this.accountId(), v, { decimals: 0, sign: true });
  }
}
