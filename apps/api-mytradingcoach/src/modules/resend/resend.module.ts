import { Module } from '@nestjs/common';
import { ResendService } from './resend.service';
import { ResendCron } from './resend.cron';
import { EmailDispatchService } from './email-dispatch.service';
import { AutoCampaignsCron } from './crons/auto-campaigns.cron';
import { EmailsController } from './emails.controller';

@Module({
  controllers: [EmailsController],
  providers: [ResendService, ResendCron, EmailDispatchService, AutoCampaignsCron],
  exports: [ResendService, EmailDispatchService],
})
export class ResendModule {}
