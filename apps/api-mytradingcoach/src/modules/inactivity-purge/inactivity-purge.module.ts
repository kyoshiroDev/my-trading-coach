import { Module } from '@nestjs/common';
import { ResendModule } from '../resend/resend.module';
import { UsersModule } from '../users/users.module';
import { InactivityPurgeService } from './inactivity-purge.service';

/** Purge des comptes inactifs depuis 2 ans (#824). Le @Cron ne tourne que sur le worker cron (ScheduleModule). */
@Module({ imports: [UsersModule, ResendModule], providers: [InactivityPurgeService] })
export class InactivityPurgeModule {}
