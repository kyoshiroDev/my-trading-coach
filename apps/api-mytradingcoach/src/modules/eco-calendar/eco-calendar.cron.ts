import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EcoCalendarService } from './eco-calendar.service';
import { EcoCalendarGateway } from './eco-calendar.gateway';
import { toParisDateStr, todayParis } from '@mtc/shared';

@Injectable()
export class EcoCalendarCron {
  private readonly logger = new Logger(EcoCalendarCron.name);
  /** Un relevé à la fois : un appel FMP lent (5 s max) ne doit pas empiler les ticks de 20 s. */
  private polling = false;

  constructor(
    private readonly ecoCalendarService: EcoCalendarService,
    private readonly gateway: EcoCalendarGateway,
  ) {}

  // 6h00 Paris : charger today + tomorrow (2 appels FMP), puis rattraper les jours récents restés
  // sans résultat (la veille ; le vendredi soir au fetch du lundi).
  @Cron('0 6 * * 1-5', { timeZone: 'Europe/Paris' })
  async prefetchDay() {
    const today = todayParis();
    const tomorrow = toParisDateStr(this.ecoCalendarService.getNextTradingDay());
    this.logger.log(`📅 Pre-fetching events for ${today} and ${tomorrow}...`);
    await Promise.all([
      this.ecoCalendarService.fetchAndStoreEvents(today),
      this.ecoCalendarService.fetchAndStoreEvents(tomorrow),
    ]);
    const caught = await this.ecoCalendarService.catchUpMissingResults([today, tomorrow]);
    if (caught.length) this.logger.log(`🔁 Rattrapage des résultats manquants : ${caught.join(', ')}`);
    // Les calendriers déjà mis en cache (TTL 1 h) ne voient ni les heures révisées ni les résultats
    // rattrapés : on vide les jours resynchronisés (#982).
    for (const day of [today, tomorrow, ...caught]) await this.clearDayCacheSafely(day);
  }

  // Dimanche 17h00 Paris : les annonces du dimanche soir (Pacifique, Asie) et du lundi, à jour
  // avant l'ouverture. Le fetch du vendredi les avait chargées, FMP a pu réviser les heures.
  @Cron('0 17 * * 0', { timeZone: 'Europe/Paris' })
  async prefetchSundayEvening() {
    const today = todayParis();
    const monday = toParisDateStr(this.ecoCalendarService.getNextTradingDay());
    await Promise.all([
      this.ecoCalendarService.fetchAndStoreEvents(today),
      this.ecoCalendarService.fetchAndStoreEvents(monday),
    ]);
  }

  /**
   * Toutes les 20 s, mais FMP n'est interrogé que pendant la fenêtre d'une annonce attendue (de son
   * heure prévue à +15 min, tant que son résultat manque), du dimanche 18 h au vendredi soir.
   * Hors fenêtre : une lecture en base, aucune requête FMP.
   */
  @Cron('*/20 * * * * *')
  async pollScheduledReleases() {
    if (this.polling) return;
    this.polling = true;
    try {
      const days = await this.ecoCalendarService.datesToPollNow();
      for (const day of days) {
        const { hasNew, newEvents } = await this.ecoCalendarService.checkNewReleases(day);
        if (hasNew) {
          this.logger.log(`🔔 ${newEvents.length} nouveaux résultats détectés (${day}) : broadcast WebSocket`);
          // Vidé AVANT la diffusion : le tableau de bord qui relit GET /eco-calendar/today après
          // l'événement WebSocket doit voir le résultat, même sans refresh-today (refusé en démo, #982).
          await this.clearDayCacheSafely(day);
          this.gateway.notifyNewReleases(newEvents);
          // Analyse des annonces fortes chiffrées, côté serveur, sans attendre un clic. Pas
          // attendue ici : les appels modèle ne doivent pas retarder le relevé suivant.
          void this.ecoCalendarService
            .autoAnalyzeReleased(day, newEvents)
            .then((n) => n && this.logger.log(`✨ ${n} analyse(s) de résultat prête(s) (${day})`))
            .catch((err: Error) => this.logger.warn(`Analyse automatique en échec : ${err.message}`));
        }
      }
    } catch (err) {
      this.logger.warn(`Relevé des résultats éco en échec : ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  /** Vide le cache du jour ; une panne Redis ne doit bloquer ni la diffusion ni le relevé suivant. */
  private async clearDayCacheSafely(day: string): Promise<void> {
    try {
      await this.ecoCalendarService.clearDayCache(day);
    } catch (err) {
      this.logger.warn(`Cache du calendrier ${day} non vidé : ${(err as Error).message}`);
    }
  }

  // 18h30 Paris : refresh de filet + vider le cache Redis des calendriers par user (reconstruits
  // à la demande). Ne touche pas aux analyses (`eco:analysis:*`) ni aux verrous de traduction.
  @Cron('30 18 * * 1-5', { timeZone: 'Europe/Paris' })
  async finalRefresh() {
    const today = todayParis();
    this.logger.log(`🔄 Final refresh actual values for ${today}...`);
    await this.ecoCalendarService.fetchAndStoreEvents(today);

    const cleared = await this.ecoCalendarService.clearDayCache(today);
    if (cleared > 0) this.logger.log(`🗑️ Cache Redis vidé : ${cleared} clés supprimées`);
  }
}
