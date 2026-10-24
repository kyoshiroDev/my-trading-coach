import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/prisma/prisma.module';
import { PushCoreModule } from './push-core.module';
import { TraderPushController } from './trader-push.controller';
import { TraderPushService } from './trader-push.service';
import { TraderNotifier } from './trader-notifier.service';

/**
 * Notifications push des traders (#666) : abonnements, réglages, livraison.
 * Les modules métier importent ce module et injectent `TraderNotifier` (jamais TraderPushService).
 */
@Module({
  imports: [PrismaModule, PushCoreModule],
  controllers: [TraderPushController],
  providers: [TraderPushService, TraderNotifier],
  exports: [TraderNotifier],
})
export class TraderPushModule {}
