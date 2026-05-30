import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { ResendModule } from '../resend/resend.module';
import { DailyRecapService } from './daily-recap.service';
import { DailyRecapCron } from './daily-recap.cron';

@Module({
  imports: [PrismaModule, AiModule, ResendModule],
  providers: [DailyRecapService, DailyRecapCron],
  exports: [DailyRecapService],
})
export class DailyRecapModule {}
