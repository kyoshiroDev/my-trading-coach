import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TradesController } from './trades.controller';
import { MarketController } from './market.controller';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';
import { UserAssetsService } from './user-assets.service';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';
import { CsvImportService } from './csv-import.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AccountsModule } from '../accounts/accounts.module';
import { SetupsModule } from '../setups/setups.module';
import { MarketDataService } from './market-data.service';
import { MarketNewsCron } from './market-news.cron';
import { BrokerMappingService } from './broker-mapping.service';

@Module({
  imports: [HttpModule, PrismaModule, AnalyticsModule, AccountsModule, SetupsModule],
  // trades = les trades ; market = données de marché mutualisées ; instruments = catalogue + actifs suivis.
  controllers: [MarketController, InstrumentsController, TradesController],
  providers: [TradesService, InstrumentsService, UserAssetsService, CoinGeckoService, CsvImportService, MarketDataService, MarketNewsCron, BrokerMappingService],
  // BrokerMappingService est expose : le module admin pilote le registre (deduction, apercu,
  // validation) sans reimplementer la lecture des fiches.
  // CsvImportService est expose pour l'admin : le registre des brokers y deduit une fiche
  // depuis un echantillon (seul endroit du code qui parle a Anthropic pour l'import).
  exports: [TradesService, MarketDataService, BrokerMappingService, CsvImportService],
})
export class TradesModule {}
