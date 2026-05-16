import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, catchError, retry, timer, of } from 'rxjs';
import type { Instrument } from './instruments.const';

interface CoinGeckoMarket {
  id: string;
  symbol: string;
  name: string;
}

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private cache: Instrument[] | null = null;
  private cacheExpiry = 0;
  private readonly TTL_MS = 60 * 60 * 1000;

  constructor(private readonly http: HttpService) {}

  async getCryptoInstruments(): Promise<Instrument[]> {
    if (this.cache && Date.now() < this.cacheExpiry) {
      return this.cache;
    }

    try {
      const response = await firstValueFrom(
        this.http
          .get<CoinGeckoMarket[]>(
            'https://api.coingecko.com/api/v3/coins/markets',
            {
              params: {
                vs_currency: 'usd',
                order: 'market_cap_desc',
                per_page: 100,
                page: 1,
                sparkline: false,
              },
            },
          )
          .pipe(
            retry({
              count: 2,
              delay: (_, retryCount) => timer(retryCount * 1000),
            }),
            catchError(() => of({ data: [] as CoinGeckoMarket[] })),
          ),
      );

      if (!response.data.length) {
        return this.getStaticCryptoFallback();
      }

      const instruments: Instrument[] = response.data.map((coin) => ({
        symbol: `${coin.symbol.toUpperCase()}/USDT`,
        label: `${coin.name} (${coin.symbol.toUpperCase()}/USDT)`,
        category: 'CRYPTO' as const,
        tickValue: null,
      }));

      this.cache = instruments;
      this.cacheExpiry = Date.now() + this.TTL_MS;
      this.logger.log(`CoinGecko: ${instruments.length} instruments chargés`);
      return instruments;
    } catch {
      this.logger.warn(
        'CoinGecko API indisponible — fallback sur liste statique',
      );
      return this.getStaticCryptoFallback();
    }
  }

  private getStaticCryptoFallback(): Instrument[] {
    return [
      {
        symbol: 'BTC/USDT',
        label: 'Bitcoin (BTC/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'ETH/USDT',
        label: 'Ethereum (ETH/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'SOL/USDT',
        label: 'Solana (SOL/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'BNB/USDT',
        label: 'BNB (BNB/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'XRP/USDT',
        label: 'XRP (XRP/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'DOGE/USDT',
        label: 'Dogecoin (DOGE/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'ADA/USDT',
        label: 'Cardano (ADA/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'AVAX/USDT',
        label: 'Avalanche (AVAX/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'LINK/USDT',
        label: 'Chainlink (LINK/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
      {
        symbol: 'DOT/USDT',
        label: 'Polkadot (DOT/USDT)',
        category: 'CRYPTO',
        tickValue: null,
      },
    ];
  }
}
