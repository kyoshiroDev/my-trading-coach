import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { stripeClientProvider } from '../stripe/stripe.client';
import { PartnerCodeService } from './partner-code.service';
import { PartnerCodeAdminController, PartnerPricingController } from './partner-code.controller';

/** Codes partenaires (#525) : coupons Stripe, validation, utilisations, routes publique et admin. */
@Module({
  imports: [PrismaModule],
  controllers: [PartnerPricingController, PartnerCodeAdminController],
  providers: [PartnerCodeService, stripeClientProvider],
  exports: [PartnerCodeService],
})
export class PartnerCodeModule {}
