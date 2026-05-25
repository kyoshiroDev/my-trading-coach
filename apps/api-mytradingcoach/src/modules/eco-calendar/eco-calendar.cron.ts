import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EcoCalendarService } from './eco-calendar.service';
import { EcoCalendarGateway } from './eco-calendar.gateway';

@Injectable()
export class EcoCalendarCron {
  private readonly logger = new Logger(EcoCalendarCron.name);

  constructor(
    private readonly ecoCalendarService: EcoCalendarService,
    private readonly gateway: EcoCalendarGateway,
  ) {}

  // 6h00 Paris — charger today + tomorrow (2 appels FMP)
  @Cron('0 6 * * 1-5', { timeZone: 'Europe/Paris' })
  async prefetchDay() {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = this.ecoCalendarService.getNextTradingDay().toISOString().slice(0, 10);
    this.logger.log(`📅 Pre-fetching events for ${today} and ${tomorrow}...`);
    await Promise.all([
      this.ecoCalendarService.fetchAndStoreEvents(today),
      this.ecoCalendarService.fetchAndStoreEvents(tomorrow),
    ]);
  }

  // Toutes les 60s, 8h-18h Paris, lun-ven — polling temps réel actual values
  @Cron('*/1 8-17 * * 1-5', { timeZone: 'Europe/Paris' })
  async pollLiveReleases() {
    const today = new Date().toISOString().slice(0, 10);
    const { hasNew, newEvents } = await this.ecoCalendarService.checkNewReleases(today);

    if (hasNew) {
      this.logger.log(`🔔 ${newEvents.length} nouveaux résultats détectés — broadcast WebSocket`);
      this.gateway.notifyNewReleases(newEvents);
    }
  }

  // 18h30 Paris — refresh final + vider cache Redis
  @Cron('30 18 * * 1-5', { timeZone: 'Europe/Paris' })
  async finalRefresh() {
    const today = new Date().toISOString().slice(0, 10);
    this.logger.log(`🔄 Final refresh actual values for ${today}...`);
    await this.ecoCalendarService.fetchAndStoreEvents(today);

    const keys = await this.ecoCalendarService.redis.keys(`eco:calendar:${today}:*`);
    if (keys.length > 0) {
      await this.ecoCalendarService.redis.del(...keys);
      this.logger.log(`🗑️ Cache Redis vidé — ${keys.length} clés supprimées`);
    }
  }
}
