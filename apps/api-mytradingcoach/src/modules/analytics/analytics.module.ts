import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { DailyRecapModule } from '../daily-recap/daily-recap.module';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [DailyRecapModule, AccountsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
