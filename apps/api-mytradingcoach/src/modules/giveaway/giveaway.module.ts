import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { StripeModule } from '../stripe/stripe.module';
import { UsersModule } from '../users/users.module';
import { AdminGiveawayController } from './admin-giveaway.controller';
import { GiveawayController, PublicGiveawayController } from './giveaway.controller';
import { GiveawayPublicService } from './giveaway-public.service';
import { GiveawayAdminService } from './giveaway-admin.service';
import { GiveawayCron } from './giveaway.cron';
import { GiveawayDrawService } from './giveaway-draw.service';
import { GiveawayEligibilityService } from './giveaway-eligibility.service';
import { GiveawayPrizeService } from './giveaway-prize.service';
import { GiveawaySettingsService } from './giveaway-settings.service';

/** Tirage au sort mensuel (PROMPT-tirage-mensuel) : éteint par défaut, piloté dans l'admin. */
@Module({
  imports: [PrismaModule, ResendModule, StripeModule, UsersModule],
  controllers: [AdminGiveawayController, GiveawayController, PublicGiveawayController],
  providers: [
    GiveawaySettingsService,
    GiveawayEligibilityService,
    GiveawayPrizeService,
    GiveawayDrawService,
    GiveawayAdminService,
    GiveawayCron,
    GiveawayPublicService,
  ],
  exports: [GiveawaySettingsService, GiveawayEligibilityService],
})
export class GiveawayModule {}
