import { Module } from '@nestjs/common';
import { resolvePushConfig, type PushConfigResult } from '../../config/push-config';
import { PUSH_CONFIG, PUSH_SENDER, WebPushLibSender } from './push-sender';

/**
 * Socle Web Push commun à l'admin et aux traders : configuration VAPID (une seule paire de clés
 * pour les deux origines) et émetteur. `PUSH_SENDER` vaut `null` quand le push est désactivé.
 */
@Module({
  providers: [
    { provide: PUSH_CONFIG, useFactory: (): PushConfigResult => resolvePushConfig(process.env) },
    {
      provide: PUSH_SENDER,
      inject: [PUSH_CONFIG],
      useFactory: (cfg: PushConfigResult) => (cfg.enabled ? new WebPushLibSender(cfg.config) : null),
    },
  ],
  exports: [PUSH_CONFIG, PUSH_SENDER],
})
export class PushCoreModule {}
