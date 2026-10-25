import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import type { PushAlertType } from '@prisma/client';
import {
  DEFAULT_MUTED_PUSH_TYPES,
  PUSH_MAX_DEVICES,
  PUSH_TIME_ZONE,
  type AdminPushTestResult,
  type TraderPushDeviceState,
  type TraderPushPreferencesInput,
  type TraderPushSettings,
} from '@mtc/shared';
import { PrismaService } from '@api/prisma/prisma.service';
import type { PushConfigResult } from '../../config/push-config';
import { PUSH_CONFIG, PUSH_SENDER, TRADER_PUSH_FLAG, type PushSender } from './push-sender';
import { deliverPush, hostOf } from './push-delivery';
import { deviceLabel } from './device-label';
import { TRADER_PUSH_MESSAGES, traderPushPayload, type TraderPushMessage } from './trader-push-messages';
import type { SubscribePushDto } from './dto/push-subscription.dto';

/** Appareils gardés par trader : au-delà, le plus ancien est remplacé (navigateurs réinstallés…). */
export const MAX_PUSH_DEVICES = PUSH_MAX_DEVICES;

/**
 * Abonnements Web Push des traders (#666) et livraison vers TOUS les appareils d'un trader.
 * Les services métier ne l'appellent jamais directement : ils passent par `TraderNotifier`, qui
 * applique démo, plan, types coupés, heures silencieuses et anti-spam.
 */
@Injectable()
export class TraderPushService implements OnModuleInit {
  private readonly logger = new Logger(TraderPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_CONFIG) private readonly config: PushConfigResult,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
    /** `TRADER_PUSH_ENABLED=true` : le push des traders exige les DEUX interrupteurs. */
    @Inject(TRADER_PUSH_FLAG) private readonly traderFlag: boolean,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) this.logger.log(`Notifications push des traders : désactivées (${this.config.reason})`);
    else if (!this.traderFlag) this.logger.log('Notifications push des traders : désactivées (TRADER_PUSH_ENABLED ≠ true)');
    else this.logger.log('Notifications push des traders : activées');
  }

  /**
   * Interrupteur éteint : section masquée dans l'app (`enabled: false`), abonnement et test en 503,
   * aucun envoi. Lecture, retrait d'un appareil et désabonnement à la déconnexion restent possibles.
   */
  get enabled(): boolean {
    return this.traderFlag && this.config.enabled && this.sender !== null;
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Les notifications push ne sont pas disponibles pour le moment.');
    }
  }

  async settings(userId: string): Promise<TraderPushSettings> {
    const [pref, devices] = await Promise.all([
      this.prisma.traderPushPreference.findUnique({ where: { userId } }),
      this.prisma.userPushDevice.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, userAgent: true, createdAt: true, lastSuccessAt: true },
      }),
    ]);
    return {
      enabled: this.enabled,
      publicKey: this.enabled && this.config.enabled ? this.config.config.publicKey : null,
      mutedTypes: pref?.mutedTypes ?? [...DEFAULT_MUTED_PUSH_TYPES],
      // Début égal à la fin (ligne enregistrée avant la revue phase 2 I5) : aucune heure silencieuse.
      quietHours:
        pref?.quietStart != null && pref.quietEnd != null && pref.quietStart !== pref.quietEnd
          ? { start: pref.quietStart, end: pref.quietEnd }
          : null,
      timeZone: PUSH_TIME_ZONE,
      devices: devices.map((d) => ({
        id: d.id,
        label: deviceLabel(d.userAgent),
        createdAt: d.createdAt.toISOString(),
        lastSuccessAt: d.lastSuccessAt?.toISOString() ?? null,
      })),
    };
  }

  /** État de CET appareil, identifié par son endpoint. */
  async device(userId: string, endpoint: string): Promise<TraderPushDeviceState> {
    const row = await this.prisma.userPushDevice.findFirst({ where: { userId, endpoint }, select: { id: true } });
    return { subscribed: row !== null, id: row?.id ?? null };
  }

  /** Abonne (ou réabonne) cet appareil. Un endpoint déjà connu est rattaché au trader courant. */
  async subscribe(userId: string, dto: SubscribePushDto, userAgent: string | null): Promise<TraderPushDeviceState> {
    this.requireEnabled();
    const ua = userAgent?.slice(0, 300) ?? null;
    const row = await this.prisma.userPushDevice.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: ua },
      // `createdAt` remis à maintenant : l'éviction au-delà de 10 appareils garde les plus récents,
      // donc jamais l'appareil qu'on vient de réabonner (revue #717, m3).
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth, userAgent: ua, createdAt: new Date() },
      select: { id: true },
    });
    const stale = await this.prisma.userPushDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_PUSH_DEVICES,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.userPushDevice.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
    this.logger.log(`Appareil trader abonné (${hostOf(dto.endpoint)})`);
    return { subscribed: true, id: row.id };
  }

  async unsubscribe(userId: string, endpoint: string): Promise<{ removed: boolean }> {
    const { count } = await this.prisma.userPushDevice.deleteMany({ where: { userId, endpoint } });
    return { removed: count > 0 };
  }

  /** Suppression depuis la liste du profil (un appareil perdu, un autre navigateur). */
  async removeDevice(userId: string, id: string): Promise<{ removed: true }> {
    const { count } = await this.prisma.userPushDevice.deleteMany({ where: { userId, id } });
    if (count === 0) throw new NotFoundException('Appareil introuvable.');
    return { removed: true };
  }

  async setPreferences(userId: string, input: TraderPushPreferencesInput): Promise<TraderPushSettings> {
    const data: { mutedTypes?: PushAlertType[]; quietStart?: number | null; quietEnd?: number | null } = {};
    if (input.mutedTypes !== undefined) data.mutedTypes = [...new Set(input.mutedTypes)];
    if (input.quietHours !== undefined) {
      data.quietStart = input.quietHours?.start ?? null;
      data.quietEnd = input.quietHours?.end ?? null;
    }
    await this.prisma.traderPushPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.settings(userId);
  }

  /** « Tester » : tous les appareils du trader, sans filtre de préférence. */
  async test(userId: string): Promise<AdminPushTestResult> {
    this.requireEnabled();
    return this.deliverToUser(userId, TRADER_PUSH_MESSAGES.test(), 'TEST');
  }

  /**
   * Envoie `message` à chaque appareil du trader. Aucun filtre ici (c'est `TraderNotifier`).
   * `kind` ne sert qu'aux journaux. Ne lève que si la base est indisponible.
   */
  async deliverToUser(userId: string, message: TraderPushMessage, kind: PushAlertType | 'TEST'): Promise<AdminPushTestResult> {
    const empty = { subscriptions: 0, delivered: 0, failed: 0, removed: 0 };
    if (!this.enabled || !this.sender) return empty;
    const targets = await this.prisma.userPushDevice.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (targets.length === 0) return empty;
    const db = this.prisma.userPushDevice;
    return deliverPush(
      this.sender,
      targets,
      JSON.stringify(traderPushPayload(message, Date.now())),
      { ttlSeconds: message.ttlSeconds, urgency: message.urgency },
      {
        delivered: (id) => db.update({ where: { id }, data: { lastSuccessAt: new Date() } }),
        gone: (id) => db.deleteMany({ where: { id } }),
      },
      this.logger,
      'trader',
      kind,
    );
  }
}
