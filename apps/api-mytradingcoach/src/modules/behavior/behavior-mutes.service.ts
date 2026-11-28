import { Injectable } from '@nestjs/common';
import type { BehaviorMutableDetector, BehaviorMute } from '@mtc/shared';
import { PrismaService } from '@api/prisma/prisma.service';

/**
 * Détecteurs coupés par le trader (« Pas pour mon style », #671). Un détecteur coupé reste ENREGISTRÉ
 * (statistiques, Débrief hebdo) ; seuls le socket et le push sont coupés (`BehaviorAlertsService`).
 */
@Injectable()
export class BehaviorMutesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<BehaviorMute[]> {
    const rows = await this.prisma.behaviorDetectorMute.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { detector: true, createdAt: true },
    });
    return rows.map((r) => ({ detector: r.detector as BehaviorMutableDetector, createdAt: r.createdAt.toISOString() }));
  }

  /** Idempotent : couper un détecteur déjà coupé garde la date d'origine. */
  async mute(userId: string, detector: BehaviorMutableDetector): Promise<BehaviorMute> {
    const row = await this.prisma.behaviorDetectorMute.upsert({
      where: { userId_detector: { userId, detector } },
      create: { userId, detector },
      update: {},
      select: { detector: true, createdAt: true },
    });
    return { detector: row.detector as BehaviorMutableDetector, createdAt: row.createdAt.toISOString() };
  }

  /** Idempotent : réactiver un détecteur déjà actif ne fait rien. */
  async unmute(userId: string, detector: BehaviorMutableDetector): Promise<void> {
    await this.prisma.behaviorDetectorMute.deleteMany({ where: { userId, detector } });
  }

  /** Détecteurs coupés d'un trader, pour l'envoi des alertes. */
  async mutedSet(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.behaviorDetectorMute.findMany({ where: { userId }, select: { detector: true } });
    return new Set(rows.map((r) => r.detector));
  }
}
