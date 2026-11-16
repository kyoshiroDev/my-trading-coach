import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { DebriefService } from './debrief.service';

@Injectable()
export class DebriefCron {
  private readonly logger = new Logger(DebriefCron.name);

  constructor(
    private prisma: PrismaService,
    private debriefService: DebriefService,
    @InjectQueue('debrief') private debriefQueue: Queue,
  ) {}

  // Options de job communes (3 tentatives, échecs persistés pour diagnostic).
  private readonly jobOpts = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 5000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 3600, count: 1000 }, // échecs gardés 7 j pour diagnostic, pas indéfiniment
  };

  // Dimanche 23h : débrief de la semaine qui se termine (refDate = maintenant, explicite).
  @Cron('0 23 * * 0', { timeZone: 'Europe/Paris' })
  async scheduledDebriefs() {
    this.logger.log('Starting weekly debrief generation...');
    const now = new Date();
    const eligibleUsers = await this.debriefService.getEligibleUsers(now);

    await Promise.all(
      eligibleUsers.map((user) =>
        this.debriefQueue.add(
          'generate',
          { userId: user.id, refDate: now.toISOString(), force: false },
          this.jobOpts,
        ),
      ),
    );

    // Le nombre seulement : la liste des e-mails de tous les éligibles n'a rien à faire dans les logs.
    this.logger.log(`Queued ${eligibleUsers.length} debrief jobs`);
  }

  // Lundi 08h : filet de rattrapage. Génère le débrief de la semaine PASSÉE pour les éligibles
  // qui ne l'ont pas reçu dimanche (cron manqué / déploiement / job échoué) ou dont le débrief
  // date d'avant dimanche 23:00 (C1 #1048). Idempotent côté generate → pas de 2e e-mail.
  @Cron('0 8 * * 1', { timeZone: 'Europe/Paris' })
  async catchUpMissedDebriefs() {
    const now = new Date();
    const refDate = this.debriefService.lastCompletedWeekRef(now);
    const { weekNumber, year } = this.debriefService.getWeekInfo(refDate);

    const eligibleUsers = await this.debriefService.getEligibleUsers(refDate);
    if (eligibleUsers.length === 0) return;

    // C1 (#1048) : un débrief généré avant le dimanche 23:00 (bouton de milieu de semaine) compte
    // comme manquant : generate le refait sur la semaine complète. Un débrief du cron reste servi.
    const cutoff = this.debriefService.weeklyCutoff(refDate);
    const existing = await this.prisma.weeklyDebrief.findMany({
      where: { year, weekNumber, userId: { in: eligibleUsers.map((u) => u.id) } },
      select: { userId: true, generatedAt: true },
    });
    const hasDebrief = new Set(existing.filter((e) => e.generatedAt >= cutoff).map((e) => e.userId));
    const missing = eligibleUsers.filter((u) => !hasDebrief.has(u.id));

    await Promise.all(
      missing.map((user) =>
        this.debriefQueue.add(
          'generate',
          { userId: user.id, refDate: refDate.toISOString(), force: false },
          this.jobOpts,
        ),
      ),
    );

    this.logger.log(`Catch-up (S${weekNumber}/${year}): ${missing.length}/${eligibleUsers.length} missed debriefs queued`);
  }
}
