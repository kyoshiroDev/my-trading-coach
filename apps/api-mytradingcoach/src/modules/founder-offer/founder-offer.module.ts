import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { FounderOfferService } from './founder-offer.service';
import { FounderAdminService } from './founder-admin.service';
import { FounderAdminController, PricingController } from './founder-offer.controller';

/** Offre fondateur (#525) : places, numéros, route publique et routes admin. */
@Module({
  imports: [PrismaModule, ResendModule],
  controllers: [PricingController, FounderAdminController],
  providers: [FounderOfferService, FounderAdminService],
  exports: [FounderOfferService],
})
export class FounderOfferModule {}
