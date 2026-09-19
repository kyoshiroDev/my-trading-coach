import { Module } from '@nestjs/common';
import { ResendService } from './resend.service';
import { ResendCron } from './resend.cron';
import { EmailDispatchService } from './email-dispatch.service';
import { AutoCampaignsCron } from './crons/auto-campaigns.cron';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';

@Module({
  controllers: [EmailsController],
  providers: [ResendService, ResendCron, EmailDispatchService, AutoCampaignsCron, EmailsService],
  exports: [ResendService, EmailDispatchService],
})
export class ResendModule {}
