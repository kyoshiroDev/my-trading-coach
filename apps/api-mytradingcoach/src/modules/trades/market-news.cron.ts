import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketDataService } from './market-data.service';

@Injectable()
export class MarketNewsCron {
  private readonly logger = new Logger(MarketNewsCron.name);
  constructor(private readonly marketData: MarketDataService) {}

  // Toutes les 20 min, 7h-22h Paris, lun-ven
  @Cron('*/20 7-21 * * 1-5', { timeZone: 'Europe/Paris' })
  async refreshNews() {
    const n = await this.marketData.refreshNewsBatch();
    if (n > 0) this.logger.log(`📰 ${n} news traduites + stockées`);
  }
}
