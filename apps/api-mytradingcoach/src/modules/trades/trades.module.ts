import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TradesController } from './trades.controller';
import { MarketController } from './market.controller';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';
import { CsvImportService } from './csv-import.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AccountsModule } from '../accounts/accounts.module';
import { SetupsModule } from '../setups/setups.module';
import { MarketDataService } from './market-data.service';
import { MarketNewsCron } from './market-news.cron';

@Module({
  imports: [HttpModule, PrismaModule, AnalyticsModule, AccountsModule, SetupsModule],
  // trades = les trades ; market = données de marché mutualisées ; instruments = catalogue + actifs suivis.
  controllers: [MarketController, InstrumentsController, TradesController],
  providers: [TradesService, InstrumentsService, CoinGeckoService, CsvImportService, MarketDataService, MarketNewsCron],
  exports: [TradesService, MarketDataService],
})
export class TradesModule {}
