import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingProcessor } from './billing.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'billing' }),
    PrismaModule,
    ResendModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingProcessor],
  exports: [BillingService],
})
export class BillingModule {}
