import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EmailCampaignService } from './email-campaign.service';
import { MetricsSnapshotCron } from './metrics-snapshot.cron';
import { DeletedAccountService } from './deleted-account.service';
import { UserDetailService } from './user-detail.service';
import { DemoSeedService } from './demo-seed.service';
import { ResendModule } from '../resend/resend.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiscordModule } from '../discord/discord.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [ResendModule, UsersModule, PrismaModule, DiscordModule, StripeModule],
  controllers: [AdminController],
  providers: [AdminService, EmailCampaignService, MetricsSnapshotCron, DeletedAccountService, UserDetailService, DemoSeedService],
})
export class AdminModule {}
