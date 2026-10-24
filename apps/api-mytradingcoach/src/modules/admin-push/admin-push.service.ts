import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { AdminPushEvent, Role } from '@prisma/client';
import type { AdminPushDevice, AdminPushPublicKey, AdminPushTestResult } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { PushConfigResult } from '../../config/push-config';
import { PUSH_CONFIG, PUSH_SENDER, type PushSender } from '../push/push-sender';
import { deliverPush, hostOf } from '../push/push-delivery';
import { ADMIN_PUSH_MESSAGES, angularPushPayload, type AdminPushMessage } from './push-messages';
import type { SubscribePushDto } from './dto/admin-push.dto';

/** Un événement non lu en 24 h n'a plus d'intérêt (le service push l'abandonne). */
const TTL_SECONDS = 24 * 3600;

export { hostOf };

/** Abonnements Web Push des appareils ADMIN et livraison des notifications business. */
@Injectable()
export class AdminPushService implements OnModuleInit {
  private readonly logger = new Logger(AdminPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_CONFIG) private readonly config: PushConfigResult,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
  ) {}

  onModuleInit(): void {
    if (this.config.enabled) this.logger.log('Notifications push admin : activées');
    else this.logger.log(`Notifications push admin : désactivées (${this.config.reason})`);
  }

  get enabled(): boolean {
    return this.config.enabled && this.sender !== null;
  }

  publicKey(): AdminPushPublicKey {
    return this.config.enabled
      ? { enabled: true, publicKey: this.config.config.publicKey }
      : { enabled: false, publicKey: null };
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Notifications push désactivées sur le serveur (PUSH_ENABLED).');
    }
  }

  /** Abonne (ou réabonne) cet appareil. Un endpoint déjà connu est rattaché à l'admin courant. */
  async subscribe(userId: string, dto: SubscribePushDto, userAgent: string | null): Promise<AdminPushDevice> {
    this.requireEnabled();
    const ua = userAgent?.slice(0, 300) ?? null;
    const row = await this.prisma.adminPushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: ua },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: ua },
      select: { mutedEvents: true },
    });
    this.logger.log(`Appareil admin abonné (${hostOf(dto.endpoint)})`);
    return { subscribed: true, mutedEvents: row.mutedEvents };
  }

  async unsubscribe(userId: string, endpoint: string): Promise<{ removed: boolean }> {
    const { count } = await this.prisma.adminPushSubscription.deleteMany({ where: { userId, endpoint } });
    if (count > 0) this.logger.log(`Appareil admin désabonné (${hostOf(endpoint)})`);
    return { removed: count > 0 };
  }

  async device(userId: string, endpoint: string): Promise<AdminPushDevice> {
    const row = await this.prisma.adminPushSubscription.findFirst({
      where: { userId, endpoint },
      select: { mutedEvents: true },
    });
    return { subscribed: row !== null, mutedEvents: row?.mutedEvents ?? [] };
  }

  async setPreferences(userId: string, endpoint: string, mutedEvents: AdminPushEvent[]): Promise<AdminPushDevice> {
    const unique = [...new Set(mutedEvents)];
    const { count } = await this.prisma.adminPushSubscription.updateMany({
      where: { userId, endpoint },
      data: { mutedEvents: unique },
    });
    if (count === 0) throw new NotFoundException('Cet appareil n’est pas abonné aux notifications.');
    return { subscribed: true, mutedEvents: unique };
  }

  /** « Tester la notification » : envoyé à tous les appareils ADMIN, sans filtre de préférence. */
  async test(): Promise<AdminPushTestResult> {
    this.requireEnabled();
    return this.deliver(null, ADMIN_PUSH_MESSAGES.test());
  }

  /**
   * Envoie `message` à chaque appareil ADMIN abonné qui n'a pas coupé `event` (`null` = test,
   * envoyé à tous). 2xx → livré ; 404/410 → abonnement mort, supprimé ; autre → échec journalisé.
   * Ne lève que si la base est indisponible (AdminNotifier l'absorbe).
   */
  async deliver(event: AdminPushEvent | null, message: AdminPushMessage): Promise<AdminPushTestResult> {
    const report: AdminPushTestResult = { subscriptions: 0, delivered: 0, failed: 0, removed: 0 };
    if (!this.enabled || !this.sender) return report;
    const sender = this.sender;

    const targets = await this.prisma.adminPushSubscription.findMany({
      where: {
        user: { role: Role.ADMIN },
        ...(event ? { NOT: { mutedEvents: { has: event } } } : {}),
      },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (targets.length === 0) return report;

    const payload = JSON.stringify(angularPushPayload(message, Date.now()));
    const db = this.prisma.adminPushSubscription;
    return deliverPush(
      sender,
      targets,
      payload,
      { ttlSeconds: TTL_SECONDS, urgency: message.urgency },
      {
        delivered: (id) => db.update({ where: { id }, data: { lastSuccessAt: new Date() } }),
        gone: (id) => db.deleteMany({ where: { id } }),
      },
      this.logger,
      'admin',
    );
  }
}
