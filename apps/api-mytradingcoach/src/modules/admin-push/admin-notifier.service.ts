import { Injectable, Logger } from '@nestjs/common';
import type { AdminPushEvent } from '@prisma/client';
import { errorKind } from '../push/push-delivery';
import { AdminPushService } from './admin-push.service';
import type { AdminPushMessage } from './push-messages';

/**
 * Point d'entrée unique des services métier pour prévenir l'admin d'un événement business.
 *
 * `notify` ne lève JAMAIS et n'attend pas l'envoi : il rend la main tout de suite, la livraison se
 * fait en tâche de fond et ses erreurs sont journalisées. Un push raté ne doit jamais faire
 * échouer l'action métier (webhook Stripe, inscription…).
 *
 * Ce n'est pas une supervision de pannes : UptimeRobot et watch-containers s'en chargent.
 */
@Injectable()
export class AdminNotifier {
  private readonly logger = new Logger(AdminNotifier.name);

  constructor(private readonly push: AdminPushService) {}

  notify(event: AdminPushEvent, message: AdminPushMessage): void {
    try {
      if (!this.push.enabled) return;
      void this.push.deliver(event, message).then(
        (r) => {
          if (r.subscriptions > 0) this.logger.debug(`Push ${event} : ${r.delivered}/${r.subscriptions} livré(s)`);
        },
        (err: unknown) => this.logger.warn(`Push ${event} non envoyé (${errorKind(err)})`),
      );
    } catch (err) {
      this.logger.warn(`Push ${event} non envoyé (${errorKind(err)})`);
    }
  }
}
