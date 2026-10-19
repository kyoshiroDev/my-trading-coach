import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SessionService } from './session.service';

/**
 * Bascule de la journée de trading CME (17:00 heure de Chicago, + 5 min de marge) : clôture les
 * sessions restées ouvertes de la journée qui vient de finir (#595). Sans lui, une session oubliée
 * restait active des jours (chrono à 265 h). Fuseau Chicago : l'heure d'été américaine est suivie
 * d'elle-même, y compris les semaines où l'Europe a changé d'heure et pas les États-Unis.
 * Armé seulement sur le worker cron (ScheduleModule conditionnel, app.module).
 */
@Injectable()
export class SessionCloseCron {
  private readonly logger = new Logger(SessionCloseCron.name);

  constructor(private readonly sessions: SessionService) {}

  @Cron('5 17 * * *', { timeZone: 'America/Chicago' })
  async closeStaleSessions() {
    const closed = await this.sessions.closeStaleSessions();
    if (closed > 0) this.logger.log(`Sessions restées ouvertes clôturées : ${closed}`);
  }
}
