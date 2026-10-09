import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResendService } from './resend.service';
import { ResendCron } from './resend.cron';
import { EmailDispatchService } from './email-dispatch.service';
import { AutoCampaignsCron } from './crons/auto-campaigns.cron';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';
import { EmailProcessor } from './email.processor';
import { EMAIL_QUEUE } from './email-queue';
import { runsQueueProcessors } from '../../config/app-role';

@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  controllers: [EmailsController],
  // Processeur de file : worker seulement (SCA-B6-01) ; le web ne fait qu'alimenter la file.
  providers: [
    ResendService,
    ResendCron,
    EmailDispatchService,
    AutoCampaignsCron,
    EmailsService,
    ...(runsQueueProcessors() ? [EmailProcessor] : []),
  ],
  exports: [ResendService, EmailDispatchService],
})
export class ResendModule {}
