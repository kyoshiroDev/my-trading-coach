import { Module } from '@nestjs/common';
import { resolvePushConfig, resolveTraderPushFlag, type PushConfigResult } from '../../config/push-config';
import { PUSH_CONFIG, PUSH_SENDER, TRADER_PUSH_FLAG, WebPushLibSender } from './push-sender';

/**
 * Socle Web Push commun à l'admin et aux traders : configuration VAPID (une seule paire de clés
 * pour les deux origines) et émetteur. `PUSH_SENDER` vaut `null` quand le push est désactivé.
 * `TRADER_PUSH_FLAG` : second interrupteur, propre aux traders (l'admin ne le lit pas).
 */
@Module({
  providers: [
    { provide: PUSH_CONFIG, useFactory: (): PushConfigResult => resolvePushConfig(process.env) },
    { provide: TRADER_PUSH_FLAG, useFactory: (): boolean => resolveTraderPushFlag(process.env) },
    {
      provide: PUSH_SENDER,
      inject: [PUSH_CONFIG],
      useFactory: (cfg: PushConfigResult) => (cfg.enabled ? new WebPushLibSender(cfg.config) : null),
    },
  ],
  exports: [PUSH_CONFIG, PUSH_SENDER, TRADER_PUSH_FLAG],
})
export class PushCoreModule {}
