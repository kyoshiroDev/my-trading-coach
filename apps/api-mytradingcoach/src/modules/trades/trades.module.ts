import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TradesController } from './trades.controller';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';

@Module({
  imports: [HttpModule],
  controllers: [TradesController],
  providers: [TradesService, CoinGeckoService],
  exports: [TradesService],
})
export class TradesModule {}
