import { Module } from '@nestjs/common';
import { ResendService } from './resend.service';
import { ResendCron } from './resend.cron';

@Module({
  providers: [ResendService, ResendCron],
  exports: [ResendService],
})
export class ResendModule {}