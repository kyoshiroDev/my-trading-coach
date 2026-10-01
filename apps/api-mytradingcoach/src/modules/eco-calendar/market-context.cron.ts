import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketDataService } from '../trades/market-data.service';
import { EcoCalendarGateway } from './eco-calendar.gateway';

/**
 * Contexte marché poussé par le socket /eco toutes les 15 s (SCA-B4-03). Avant, CHAQUE onglet en
 * session l'interrogeait toutes les 15 s : un quart des requêtes de l'API au test de charge B9.
 * Le front ne garde qu'un polling de secours à 5 min.
 *
 * Tourne sur le worker cron seul (ScheduleModule gaté par IS_CRON_WORKER) ; personne de connecté
 * → rien (ni appel Yahoo, ni diffusion). La donnée vient du cache Redis de 15 s de MarketDataService.
 */
@Injectable()
export class MarketContextCron {
  private readonly logger = new Logger(MarketContextCron.name);

  constructor(
    private readonly marketData: MarketDataService,
    private readonly gateway: EcoCalendarGateway,
  ) {}

  @Cron('*/15 * * * * *')
  async broadcast(): Promise<void> {
    try {
      if ((await this.gateway.connectedCount()) === 0) return;
      this.gateway.notifyMarketContext(await this.marketData.getMarketContext());
    } catch (err) {
      this.logger.warn(`Diffusion du contexte marché impossible : ${String(err)}`);
    }
  }
}
