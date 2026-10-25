import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { ResendModule } from '../resend/resend.module';
import { AccountsModule } from '../accounts/accounts.module';
import { TraderPushModule } from '../push/trader-push.module';
import { DailyRecapService } from './daily-recap.service';
import { DailyRecapCron } from './daily-recap.cron';
import { DailyRecapProcessor } from './daily-recap.processor';
import { DAILY_RECAP_QUEUE } from './daily-recap.queue';
import { runsQueueProcessors } from '../../config/app-role';

@Module({
  // AccountsModule : bloc « prop firm » du prompt (#374).
  // TraderPushModule : push « récap prêt » (#666).
  imports: [PrismaModule, AiModule, ResendModule, AccountsModule, TraderPushModule, BullModule.registerQueue({ name: DAILY_RECAP_QUEUE })],
  // Processeur de file : worker seulement (SCA-B6-01) ; le cron ne fait qu'enfiler.
  providers: [DailyRecapService, DailyRecapCron, ...(runsQueueProcessors() ? [DailyRecapProcessor] : [])],
  exports: [DailyRecapService],
})
export class DailyRecapModule {}
