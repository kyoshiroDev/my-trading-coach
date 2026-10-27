import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiscordModule } from '../discord/discord.module';
import { TrialEndService } from './trial-end.service';

/** Essai Premium d'inscription et fin des Premium sans abonnement Stripe (#769). */
@Module({
  imports: [PrismaModule, DiscordModule],
  providers: [TrialEndService],
  exports: [TrialEndService],
})
export class TrialModule {}
