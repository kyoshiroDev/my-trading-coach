import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResendModule } from '../resend/resend.module';
import { DiscordModule } from '../discord/discord.module';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';
import { StripeProcessor } from './stripe.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'stripe' }),
    PrismaModule,
    ResendModule,
    DiscordModule,
  ],
  controllers: [StripeController],
  providers: [StripeService, StripeProcessor],
  exports: [StripeService],
})
export class StripeModule {}
