import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { ResendModule } from '../resend/resend.module';
import { AccountsModule } from '../accounts/accounts.module';
import { DailyRecapService } from './daily-recap.service';
import { DailyRecapCron } from './daily-recap.cron';

@Module({
  // AccountsModule : bloc « prop firm » du prompt (#374).
  imports: [PrismaModule, AiModule, ResendModule, AccountsModule],
  providers: [DailyRecapService, DailyRecapCron],
  exports: [DailyRecapService],
})
export class DailyRecapModule {}
