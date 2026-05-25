import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { EcoCalendarService } from './eco-calendar.service';
import { EcoCalendarController } from './eco-calendar.controller';
import { EcoCalendarCron } from './eco-calendar.cron';
import { EcoCalendarGateway } from './eco-calendar.gateway';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [EcoCalendarController],
  providers: [EcoCalendarService, EcoCalendarCron, EcoCalendarGateway],
  exports: [EcoCalendarService],
})
export class EcoCalendarModule {}
