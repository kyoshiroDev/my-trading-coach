import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { todayParis } from '@mtc/shared';

/**
 * Enregistre 1 jour d'activité par utilisateur et par jour (heatmap admin).
 * Dédup via Redis SET NX (1 écriture DB max / user / jour, y compris en cluster) ;
 * la contrainte @@unique([userId,date]) reste le filet de sécurité.
 * Le tracking ne doit JAMAIS faire échouer la requête métier → tout est try/catché.
 */
@Injectable()
export class ActivityTrackingService {
  private readonly logger = new Logger(ActivityTrackingService.name);
  /**
   * Filtre LOCAL au worker (SCA-B3-02) : utilisateurs déjà comptés aujourd'hui par ce worker.
   * Évite un aller-retour Redis à CHAQUE requête authentifiée ; vidé au changement de jour.
   */
  private seenToday = { date: '', ids: new Set<string>() };

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async markActive(userId: string): Promise<void> {
    try {
      const dateStr = todayParis(); // YYYY-MM-DD (Europe/Paris)
      if (this.seenToday.date !== dateStr) this.seenToday = { date: dateStr, ids: new Set() };
      if (this.seenToday.ids.has(userId)) return; // déjà vu aujourd'hui par ce worker
      const key = `activity:${userId}:${dateStr}`;

      // SET NX : ne pose la clé que si absente → 'OK'. Si déjà posée aujourd'hui → null.
      const set = await this.redis.client.set(
        key,
        '1',
        'EX',
        this.secondsUntilParisMidnight(),
        'NX',
      );
      if (set !== 'OK') {
        this.seenToday.ids.add(userId); // déjà compté aujourd'hui (par un autre worker)
        return;
      }

      // Date à minuit (jour calendaire Paris), stockée en colonne @db.Date.
      const date = new Date(`${dateStr}T00:00:00.000Z`);
      try {
        await this.prisma.userDailyActivity.upsert({
          where: { userId_date: { userId, date } },
          create: { userId, date },
          update: {}, // no-op : la ligne du jour existe déjà
        });
      } catch (dbErr) {
        // Clé posée mais ligne non écrite : on la retire pour que la journée soit retentée.
        await this.redis.client.del(key).catch(() => undefined);
        throw dbErr;
      }
      // Marqué seulement après succès : un échec (Redis, base) sera retenté à la requête suivante.
      this.seenToday.ids.add(userId);
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
