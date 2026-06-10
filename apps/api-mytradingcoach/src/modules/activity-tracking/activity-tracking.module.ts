import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityTrackingService } from './activity-tracking.service';

/** Tracking des jours d'activité (RedisService est global via SharedModule). */
@Module({
  imports: [PrismaModule],
  providers: [ActivityTrackingService],
  exports: [ActivityTrackingService],
})
export class ActivityTrackingModule {}
