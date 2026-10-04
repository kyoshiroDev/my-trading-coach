import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { DiscordModule } from '../discord/discord.module';
import { StripeController } from './stripe.controller';
import { StripeProcessor } from './stripe.processor';
import { stripeClientProvider } from './stripe.client';
import { STRIPE_QUEUE } from './stripe.helpers';
import { StripeBillingService } from './stripe-billing.service';
import { StripeCouponService } from './stripe-coupon.service';
import { StripeCustomerService } from './stripe-customer.service';
import { StripeReferralService } from './stripe-referral.service';
import { StripeSubscriptionService } from './stripe-subscription.service';
import { StripeWebhookService } from './stripe-webhook.service';
import { runsQueueProcessors } from '../../config/app-role';

@Module({
  imports: [
    BullModule.registerQueue({ name: STRIPE_QUEUE }),
    PrismaModule,
    ResendModule,
    DiscordModule,
  ],
  controllers: [StripeController],
  providers: [
    stripeClientProvider,
    StripeCustomerService,
    StripeCouponService,
    StripeSubscriptionService,
    StripeReferralService,
    StripeBillingService,
    StripeWebhookService,
    // Processeur de file : worker seulement (SCA-B6-01) ; le web ne fait qu'alimenter la file.
    ...(runsQueueProcessors() ? [StripeProcessor] : []),
  ],
  // Admin (réconciliation des abonnements) et referral (avoir du parrain).
  exports: [StripeSubscriptionService, StripeCustomerService],
})
export class StripeModule {}
