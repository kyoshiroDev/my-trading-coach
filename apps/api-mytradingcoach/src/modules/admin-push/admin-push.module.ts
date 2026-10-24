import { Module } from '@nestjs/common';
import { AdminPushController } from './admin-push.controller';
import { AdminPushService } from './admin-push.service';
import { AdminNotifier } from './admin-notifier.service';
import { PushCoreModule } from '../push/push-core.module';

/**
 * Notifications push (Web Push, PWA) vers les appareils ADMIN, pour les événements business.
 * Les modules métier importent ce module et injectent `AdminNotifier` (jamais AdminPushService).
 */
@Module({
  imports: [PushCoreModule],
  controllers: [AdminPushController],
  providers: [AdminPushService, AdminNotifier],
  exports: [AdminNotifier],
})
export class AdminPushModule {}
