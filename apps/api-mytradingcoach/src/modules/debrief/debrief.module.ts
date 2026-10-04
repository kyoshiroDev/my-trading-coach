import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DebriefController } from './debrief.controller';
import { DebriefAdminController } from './debrief-admin.controller';
import { DebriefService } from './debrief.service';
import { DebriefCron } from './debrief.cron';
import { DebriefProcessor } from './debrief.processor';
import { AiModule } from '../ai/ai.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ResendModule } from '../resend/resend.module';
import { PdfModule } from '../pdf/pdf.module';
import { SessionModule } from '../session/session.module';
import { AccountsModule } from '../accounts/accounts.module';
import { runsQueueProcessors } from '../../config/app-role';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'debrief' }),
    AiModule,
    AnalyticsModule,
    ResendModule,
    PdfModule,
    SessionModule,
    // Bloc « prop firm » du prompt (#374).
    AccountsModule,
  ],
  controllers: [DebriefController, DebriefAdminController],
  // Processeur de file : worker seulement (SCA-B6-01) ; le web ne fait qu'alimenter la file.
  providers: [DebriefService, DebriefCron, ...(runsQueueProcessors() ? [DebriefProcessor] : [])],
})
export class DebriefModule {}
