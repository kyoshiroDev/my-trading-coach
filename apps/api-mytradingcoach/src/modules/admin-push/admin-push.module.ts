import { Module } from '@nestjs/common';
import { resolvePushConfig, type PushConfigResult } from '../../config/push-config';
import { AdminPushController } from './admin-push.controller';
import { AdminPushService, PUSH_CONFIG } from './admin-push.service';
import { AdminNotifier } from './admin-notifier.service';
import { PUSH_SENDER, WebPushLibSender } from './push-sender';

/**
 * Notifications push (Web Push, PWA) vers les appareils ADMIN, pour les événements business.
 * Les modules métier importent ce module et injectent `AdminNotifier` (jamais AdminPushService).
 */
@Module({
  controllers: [AdminPushController],
  providers: [
    { provide: PUSH_CONFIG, useFactory: (): PushConfigResult => resolvePushConfig(process.env) },
    {
      provide: PUSH_SENDER,
      inject: [PUSH_CONFIG],
      useFactory: (cfg: PushConfigResult) => (cfg.enabled ? new WebPushLibSender(cfg.config) : null),
    },
    AdminPushService,
    AdminNotifier,
  ],
  exports: [AdminNotifier],
})
export class AdminPushModule {}
