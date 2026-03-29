import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DebriefController } from './debrief.controller';
import { DebriefService } from './debrief.service';
import { DebriefCron } from './debrief.cron';
import { DebriefProcessor } from './debrief.processor';
import { AiModule } from '../ai/ai.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'debrief' }),
    AiModule,
    AnalyticsModule,
  ],
  controllers: [DebriefController],
  providers: [DebriefService, DebriefCron, DebriefProcessor],
})
export class DebriefModule {}
