import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MarketDataService } from './market-data.service';

/**
 * Données de marché mutualisées : `/market/*`. Toutes FREE (IA mutualisée, coût O(1),
 * plan FREE compris) : elles alimentent le compagnon de session, accessible à tous.
 */
@UseGuards(JwtAuthGuard)
@Controller('market')
export class MarketController {
  constructor(private readonly marketData: MarketDataService) {}

  /** DXY, taux US, indices. */
  @Get('context')
  context() {
    return this.marketData.getMarketContext();
  }

  /** News filtrées sur les actifs de l'utilisateur. */
  @Get('news')
  news(@Query('symbols') symbols: string) {
    return this.marketData.getNews(symbols ?? '');
  }

  /** Traduction paresseuse du corps d'une news (1× par article, cachée). */
  @Get('news/:id/text')
  async newsText(@Param('id') id: string): Promise<{ text: string | null }> {
    return { text: await this.marketData.ensureNewsTextFr(id) };
  }

  /** Prix temps réel pour la saisie « trade rapide ». */
  @Get('live-price')
  async livePrice(@Query('symbol') symbol: string): Promise<{ price: number | null; symbol: string; cached: boolean }> {
    if (!symbol?.trim()) return { price: null, symbol: '', cached: false };
    return { ...(await this.marketData.getLivePrice(symbol.trim())), symbol };
  }
}
