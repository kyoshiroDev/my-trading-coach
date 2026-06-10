import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { todayParis } from '../../common/utils/paris-date';

/**
 * Enregistre 1 jour d'activité par utilisateur et par jour (heatmap admin).
 * Dédup via Redis SET NX (1 écriture DB max / user / jour, y compris en cluster) ;
 * la contrainte @@unique([userId,date]) reste le filet de sécurité.
 * Le tracking ne doit JAMAIS faire échouer la requête métier → tout est try/catché.
 */
@Injectable()
export class ActivityTrackingService {
  private readonly logger = new Logger(ActivityTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async markActive(userId: string): Promise<void> {
    try {
      const dateStr = todayParis(); // YYYY-MM-DD (Europe/Paris)
      const key = `activity:${userId}:${dateStr}`;

      // SET NX : ne pose la clé que si absente → 'OK'. Si déjà posée aujourd'hui → null.
      const set = await this.redis.client.set(
        key,
        '1',
        'EX',
        this.secondsUntilParisMidnight(),
        'NX',
      );
      if (set !== 'OK') return; // déjà compté aujourd'hui

      // Date à minuit (jour calendaire Paris), stockée en colonne @db.Date.
      const date = new Date(`${dateStr}T00:00:00.000Z`);
      await this.prisma.userDailyActivity.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {}, // no-op : la ligne du jour existe déjà
      });
    } catch (err) {
      this.logger.warn(
        `markActive(${userId}) a échoué (ignoré) : ${(err as Error).message}`,
      );
    }
  }

  /** Secondes restantes jusqu'à minuit Europe/Paris (TTL de la clé du jour). */
  private secondsUntilParisMidnight(): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const elapsed = get('hour') * 3600 + get('minute') * 60 + get('second');
    return Math.max(60, 86_400 - elapsed);
  }
}
