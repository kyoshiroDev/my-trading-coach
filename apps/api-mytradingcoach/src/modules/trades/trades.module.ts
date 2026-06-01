import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';
import { CsvImportService } from './csv-import.service';
import { AiLoggerService } from '../shared/ai-logger.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { MarketDataService } from './market-data.service';
import { MarketNewsCron } from './market-news.cron';

@Module({
  imports: [HttpModule, PrismaModule, AnalyticsModule],
  controllers: [TradesController],
  providers: [TradesService, CoinGeckoService, CsvImportService, AiLoggerService, MarketDataService, MarketNewsCron],
  exports: [TradesService, MarketDataService],
})
export class TradesModule {}
