import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { EcoCalendarService } from './eco-calendar.service';
import { EcoCalendarController } from './eco-calendar.controller';
import { EcoCalendarCron } from './eco-calendar.cron';
import { EcoCalendarGateway } from './eco-calendar.gateway';
import { MarketContextCron } from './market-context.cron';
import { TradesModule } from '../trades/trades.module';

@Module({
  imports: [PrismaModule, AiModule, TradesModule],
  controllers: [EcoCalendarController],
  providers: [EcoCalendarService, EcoCalendarCron, EcoCalendarGateway, MarketContextCron],
  exports: [EcoCalendarService],
})
export class EcoCalendarModule {}
