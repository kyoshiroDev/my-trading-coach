import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminAmbassadorsController } from './admin-ambassadors.controller';
import { AdminService } from './admin.service';
import { AnthropicCostService } from './anthropic-cost.service';
import { EmailCampaignService } from './email-campaign.service';
import { MetricsSnapshotCron } from './metrics-snapshot.cron';
import { SignupDigestCron } from './signup-digest.cron';
import { DeletedAccountService } from './deleted-account.service';
import { UserDetailService } from './user-detail.service';
import { DemoSeedService } from './demo-seed.service';
import { DemoSeedCron } from './demo-seed.cron';
import { ResendModule } from '../resend/resend.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiscordModule } from '../discord/discord.module';
import { StripeModule } from '../stripe/stripe.module';
import { VpsModule } from '../vps/vps.module';
import { AmbassadorModule } from '../ambassador/ambassador.module';
import { ReferralModule } from '../referral/referral.module';
import { TradesModule } from '../trades/trades.module';
import { AdminBrokerMappingsController } from './admin-broker-mappings.controller';

@Module({
  imports: [ResendModule, UsersModule, PrismaModule, DiscordModule, StripeModule, VpsModule, AmbassadorModule, ReferralModule, TradesModule],
  // Toutes les routes admin vivent sous /admin (guard au niveau de chaque classe).
  controllers: [AdminController, AdminUsersController, AdminAmbassadorsController, AdminBrokerMappingsController],
  providers: [AdminService, AnthropicCostService, EmailCampaignService, MetricsSnapshotCron, SignupDigestCron, DeletedAccountService, UserDetailService, DemoSeedService, DemoSeedCron],
})
export class AdminModule {}
