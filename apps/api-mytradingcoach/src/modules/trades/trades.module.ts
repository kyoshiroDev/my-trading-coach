import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';
import { CsvImportService } from './csv-import.service';
import { AiLoggerService } from '../shared/ai-logger.service';

@Module({
  imports: [HttpModule],
  controllers: [TradesController],
  providers: [TradesService, CoinGeckoService, CsvImportService, AiLoggerService],
  exports: [TradesService],
})
export class TradesModule {}
