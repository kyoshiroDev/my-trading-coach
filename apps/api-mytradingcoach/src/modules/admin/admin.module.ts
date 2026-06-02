import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { EmailCampaignService } from './email-campaign.service';
import { ResendModule } from '../resend/resend.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiscordModule } from '../discord/discord.module';

@Module({
  imports: [ResendModule, UsersModule, PrismaModule, DiscordModule],
  controllers: [AdminController],
  providers: [AdminService, EmailCampaignService],
})
export class AdminModule {}
