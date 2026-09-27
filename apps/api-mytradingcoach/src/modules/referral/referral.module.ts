import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { StripeModule } from '../stripe/stripe.module';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';

@Module({
  imports: [PrismaModule, ResendModule, StripeModule],
  controllers: [ReferralController],
  exports: [ReferralService],
  providers: [ReferralService],
})
export class ReferralModule {}
