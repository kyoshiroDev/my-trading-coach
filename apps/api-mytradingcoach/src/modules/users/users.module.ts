import { PartnerCodeModule } from '../partner-codes/partner-code.module';
import { FounderOfferModule } from '../founder-offer/founder-offer.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AmbassadorModule } from '../ambassador/ambassador.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { stripeClientProvider } from '../stripe/stripe.client';
import { StripeAccountClosureService } from '../stripe/stripe-account-closure.service';

@Module({
  imports: [PrismaModule, AmbassadorModule, FounderOfferModule, PartnerCodeModule],
  controllers: [UsersController],
  // Résiliation Stripe à la suppression : client fourni ici (StripeModule importerait Users en cycle).
  providers: [UsersService, stripeClientProvider, StripeAccountClosureService],
  exports: [UsersService],
})
export class UsersModule {}
