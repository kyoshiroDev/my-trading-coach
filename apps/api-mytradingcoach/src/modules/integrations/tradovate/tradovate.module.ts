import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { TradesModule } from '../../trades/trades.module';
import { SetupsModule } from '../../setups/setups.module';
import { TradovateApiClient } from './tradovate-api.client';
import { TradovateConnectionService } from './tradovate-connection.service';
import { TradovateSyncService } from './tradovate-sync.service';
import { TradovateTokenRefreshCron } from './tradovate-token-refresh.cron';
import { TradovateCallbackController, TradovateController } from './tradovate.controller';

/**
 * Intégration Tradovate / NinjaTrader (PROMPT-207) — synchro API en LECTURE SEULE.
 * Premier broker « par API » : le pattern (connexion par TradingAccount, secrets chiffrés,
 * mapper pur → `TradesService.importTrades`) est documenté dans `.claude/agents/nestjs.md`
 * pour les suivants (Binance, Bybit).
 */
@Module({
  imports: [PrismaModule, TradesModule, SetupsModule],
  controllers: [TradovateController, TradovateCallbackController],
  providers: [TradovateApiClient, TradovateConnectionService, TradovateSyncService, TradovateTokenRefreshCron],
})
export class TradovateModule {}
