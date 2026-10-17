import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SessionService } from './session.service';

/**
 * Fin de la journée de trading CME (16:00 heure de Chicago = 23:00 Paris) : clôture les sessions
 * restées ouvertes (#595). Sans lui, une session oubliée restait active des jours (chrono à 265 h).
 * Armé seulement sur le worker cron (ScheduleModule conditionnel, app.module).
 */
@Injectable()
export class SessionCloseCron {
  private readonly logger = new Logger(SessionCloseCron.name);

  constructor(private readonly sessions: SessionService) {}

  @Cron('0 23 * * *', { timeZone: 'Europe/Paris' })
  async closeStaleSessions() {
    const closed = await this.sessions.closeStaleSessions();
    if (closed > 0) this.logger.log(`Sessions restées ouvertes clôturées : ${closed}`);
  }
}
