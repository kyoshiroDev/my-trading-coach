import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/prisma/prisma.module';
import { TradesModule } from '../../trades/trades.module';
import { SetupsModule } from '../../setups/setups.module';
import { AuthModule } from '../../auth/auth.module';
import { AccountsModule } from '../../accounts/accounts.module';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateSyncService } from './tradovate-sync.service';
import { TradovateBalanceService } from './tradovate-balance.service';
import { TradovateClosingsService } from './tradovate-closings.service';
import { TradovatePayoutsService } from './tradovate-payouts.service';
import { TradovateReportingClient } from './tradovate-reporting.client';
import { TradovateHistoryService } from './tradovate-history.service';
import { TradovateTokenRefreshCron } from './tradovate-token-refresh.cron';
import { TradovateBackgroundRefreshCron } from './tradovate-background-refresh.cron';
import { LIVE_SOCKET_FACTORY, TradovateLiveService } from './tradovate-live.service';
import { nativeSocketFactory } from './tradovate-live.connection';
import { TradovateLiveGateway } from './tradovate-live.gateway';
import { PropAlertsService } from './prop-alerts.service';
import { TiltAlertsService } from './tilt-alerts.service';
import { TradovateCallbackController, TradovateController } from './tradovate.controller';

/**
 * Intégration Tradovate / NinjaTrader — synchro API en LECTURE SEULE.
 * Premier broker « par API » : le pattern (connexion par TradingAccount, secrets chiffrés,
 * mapper pur → `TradesService.importTrades`) est documenté dans `.claude/agents/nestjs.md`
 * pour les suivants (Binance, Bybit).
 */
@Module({
  // AuthModule : JwtService pour authentifier le handshake du canal temps réel.
  // AccountsModule : métriques des règles prop firm, base des alertes (#370).
  imports: [PrismaModule, TradesModule, SetupsModule, AuthModule, AccountsModule],
  controllers: [TradovateController, TradovateCallbackController],
  providers: [
    TradovateApiClient,
    TradovateConnectionService,
    TradovateSyncService,
    // Solde et equity lus chez le broker (WebSocket + instantané sur événement).
    TradovateBalanceService,
    // Soldes de clôture officiels (rapport Account Balance History) : plus haut des règles EOD.
    TradovateClosingsService,
    // Payouts détectés dans l'historique de trésorerie (Cash History) : cycle de payout.
    TradovatePayoutsService,
    // Historique par la Reporting API : la Trade API ne voit que la séance.
    TradovateReportingClient,
    TradovateHistoryService,
    TradovateTokenRefreshCron,
    // Temps réel : WebSocket Tradovate calé sur la présence dans l'app.
    TradovateLiveService,
    // WebSocket natif (Node ≥ 22) ; remplacé par un faux serveur Tradovate en test.
    { provide: LIVE_SOCKET_FACTORY, useValue: nativeSocketFactory },
    TradovateLiveGateway,
    // Alertes prop firm « avant la casse » (Premium) sur chaque solde poussé.
    PropAlertsService,
    // Anti-tilt en direct (Premium) sur chaque trade synchronisé.
    TiltAlertsService,
    TradovateBackgroundRefreshCron,
  ],
})
export class TradovateModule {}
