import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EmailCampaignService } from './email-campaign.service';
import { ResendModule } from '../resend/resend.module';

@Module({
  imports: [ResendModule],
  controllers: [AdminController],
  providers: [AdminService, EmailCampaignService],
})
export class AdminModule {}
