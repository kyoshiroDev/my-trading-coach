import { Injectable } from '@nestjs/common';
import { CoinGeckoService } from './coingecko.service';
import { MarketDataService } from './market-data.service';
import { INSTRUMENTS } from './instruments.const';
import type { InstrumentSearchResult } from '@mtc/shared';


/** Catalogue et recherche d'instruments (futures CME, forex coté en dollars, crypto), indépendants des trades. */
@Injectable()
export class InstrumentsService {
  constructor(
    private readonly coinGecko: CoinGeckoService,
    private readonly marketData: MarketDataService,
  ) {}

  /** Futures CME et forex coté en dollars (ceux qui ont une tickValue utile, #951) + crypto. */
  async list() {
    const crypto = await this.coinGecko.getCryptoInstruments();
    const withTickValue = INSTRUMENTS.filter((i) => i.category === 'FUTURES_US' || i.category === 'FOREX');
    return [...withTickValue, ...crypto];
  }

  /**
   * Recherche d'un symbole : d'abord le fournisseur de marché (FMP), puis la liste statique,
   * complétée par la crypto si elle donne moins de 5 résultats. 10 résultats au plus.
   */
  async search(q: string): Promise<InstrumentSearchResult[]> {
    const query = (q ?? '').trim();
    if (!query) return [];
    const fmpResults = await this.marketData.searchSymbols(query);
    if (fmpResults.length > 0) return fmpResults;

    const lq = query.toLowerCase();
    const matches = (i: { symbol: string; label: string }) =>
      i.symbol.toLowerCase().includes(lq) || i.label.toLowerCase().includes(lq);
    const toResult = (i: InstrumentSearchResult) => ({ symbol: i.symbol, label: i.label, category: i.category });

    const staticMatches = INSTRUMENTS.filter(matches).slice(0, 10).map(toResult);
    if (staticMatches.length >= 5) return staticMatches;
    try {
      const crypto = (await this.coinGecko.getCryptoInstruments()).filter(matches).slice(0, 5).map(toResult);
      const seen = new Set(staticMatches.map((i) => i.symbol));
      return [...staticMatches, ...crypto.filter((i) => !seen.has(i.symbol))].slice(0, 10);
    } catch {
      return staticMatches;
    }
  }
}
