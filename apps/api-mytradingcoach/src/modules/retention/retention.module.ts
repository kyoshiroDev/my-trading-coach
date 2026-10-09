import { Module } from '@nestjs/common';
import { RetentionCron } from './retention.cron';

@Module({ providers: [RetentionCron] })
export class RetentionModule {}
