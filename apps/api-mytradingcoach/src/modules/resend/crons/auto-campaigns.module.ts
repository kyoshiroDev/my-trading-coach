import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { FounderOfferModule } from '../../founder-offer/founder-offer.module';
import { ResendModule } from '../resend.module';
import { AutoCampaignsCron } from './auto-campaigns.cron';

/**
 * Cron des campagnes automatiques, à part de ResendModule : il lit l'état de l'offre fondateur
 * (founder_followup) et FounderOfferModule importe déjà ResendModule.
 */
@Module({
  imports: [PrismaModule, ResendModule, FounderOfferModule],
  providers: [AutoCampaignsCron],
})
export class AutoCampaignsModule {}
