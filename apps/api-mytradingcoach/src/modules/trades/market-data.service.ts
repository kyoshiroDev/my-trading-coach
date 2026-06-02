import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../shared/redis.service';
import { CACHE_TTL } from '../../common/constants/cache-ttl.const';
import { INSTRUMENTS } from './instruments.const';

export interface MarketContextItem { value: number | null; source: 'fmp' | 'yahoo' | 'binance'; }
export interface TreasuryRates { t2y: number | null; t5y: number | null; t10y: number | null; t30y: number | null; }
export interface MarketContextDto {
  nq: MarketContextItem; spx: MarketContextItem; dxy: MarketContextItem;
  treasury: TreasuryRates; updatedAt: string;
}
export interface NewsItem {
  title: string; symbol: string; publishedDate: string;
  sentiment?: 'bull' | 'bear' | 'neutral'; url?: string; text?: string; image?: string; site?: string;
}

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  // Garde-fou environnement : pas de traduction hors prod (économie Dev)
  private get translationEnabled(): boolean {
    return process.env['NODE_ENV'] === 'production'
      && process.env['NEWS_TRANSLATION'] !== 'off';
  }

  async getMarketContext(): Promise<MarketContextDto> {
    const cacheKey = 'market:context';
    try {
      const cached = await this.redisService.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as MarketContextDto;
    } catch { /* Redis indisponible */ }

    const [nq, spx, dxy, treasury] = await Promise.allSettled([
      this.fetchYahooPrice('NQ=F'),
      this.fetchFmpPrice('SPY'),
      this.fetchDxy(),
      this.fetchTreasuryRates(),
    ]);

    const result: MarketContextDto = {
      nq:       { value: nq.status      === 'fulfilled' ? nq.value      : null, source: 'yahoo' },
      spx:      { value: spx.status     === 'fulfilled' ? spx.value     : null, source: 'fmp'   },
      dxy:      { value: dxy.status     === 'fulfilled' ? dxy.value     : null, source: 'yahoo' },
      treasury: treasury.status === 'fulfilled' ? treasury.value : { t2y: null, t5y: null, t10y: null, t30y: null },
      updatedAt: new Date().toISOString(),
    };
    try { await this.redisService.client.setex(cacheKey, CACHE_TTL.MARKET_CTX, JSON.stringify(result)); } catch { /* ignore */ }
    return result;
  }

  async getNews(symbols: string): Promise<NewsItem[]> {
    const cacheKey = `market:news:${symbols || 'default'}`;
    try {
      const cached = await this.redisService.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as NewsItem[];
    } catch { /* ignore */ }

    const list = (symbols || '').split(',').map(s => s.trim()).filter(Boolean);
    const where = list.length ? { symbol: { in: list } } : {};
    const rows = await this.prisma.marketNews.findMany({
      where, orderBy: { publishedDate: 'desc' }, take: 20,
    });
    const items: NewsItem[] = rows.map(r => ({
      title: r.titleFr ?? r.title,
      symbol: r.symbol,
      publishedDate: r.publishedDate.toISOString(),
      sentiment: (r.sentiment as NewsItem['sentiment']) ?? 'neutral',
      url: r.url,
      text: r.textFr ?? r.text ?? undefined,
      image: r.image ?? undefined,
      site: r.site ?? undefined,
    }));
    try { await this.redisService.client.setex(cacheKey, CACHE_TTL.NEWS, JSON.stringify(items)); } catch { /* ignore */ }
    return items;
  }

  async refreshNewsBatch(): Promise<number> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey) return 0;
    const symbols = 'QQQ,SPY,BTCUSD,EURUSD,AAPL,MSFT,NVDA,TSLA';
    const url = `https://financialmodelingprep.com/stable/news/stock?symbols=${symbols}&limit=30&apikey=${apiKey}`;
    let raw: NewsItem[] = [];
    try {
      const res = await fetch(url);
      if (!res.ok) return 0;
      raw = await res.json() as NewsItem[];
    } catch (err) {
      this.logger.warn(`News fetch failed: ${(err as Error).message}`);
      return 0;
    }

    // 1) Upsert sans traduction (dédup par url)
    for (const it of raw) {
      if (!it.url) continue;
      await this.prisma.marketNews.upsert({
        where: { url: it.url },
        update: { sentiment: it.sentiment ?? null }, // refresh sentiment éventuel
        create: {
          url: it.url, symbol: it.symbol, title: it.title, text: it.text ?? null,
          sentiment: it.sentiment ?? null, image: it.image ?? null, site: it.site ?? null,
          publishedDate: new Date(it.publishedDate),
        },
      });
    }

    // 2) Traduire uniquement les non-traduits (batch borné)
    if (!this.translationEnabled) return 0;
    const pending = await this.prisma.marketNews.findMany({
      where: { translated: false },
      orderBy: { publishedDate: 'desc' },
      take: 30,
    });
    if (!pending.length) return 0;

    const payload = pending.map(p => ({ title: p.title, text: p.text ?? '' }));
    try {
      const anthropic = new Anthropic({ apiKey: this.config.get<string>('ANTHROPIC_API_KEY') });
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        messages: [{ role: 'user', content:
          `Traduis ces news financières en français. Réponds UNIQUEMENT avec un tableau JSON d'objets {title, text} dans le même ordre, sans texte autour.\n\n${JSON.stringify(payload)}` }],
      });
      const txt = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      const s = txt.indexOf('['), e = txt.lastIndexOf(']');
      if (s === -1 || e === -1) return 0;
      const tr = JSON.parse(txt.slice(s, e + 1)) as { title: string; text: string }[];
      await Promise.all(pending.map((p, i) =>
        this.prisma.marketNews.update({
          where: { id: p.id },
          data: { titleFr: tr[i]?.title ?? p.title, textFr: tr[i]?.text ?? p.text, translated: true },
        }),
      ));
      return pending.length;
    } catch (err) {
      this.logger.warn(`News translation failed: ${(err as Error).message}`);
      return 0;
    }
  }

  async getLivePrice(symbol: string): Promise<{ price: number | null; cached: boolean }> {
    const sym = symbol.trim().toUpperCase();
    const cacheKey = `price:${sym}`;
    try {
      const cached = await this.redisService.client.get(cacheKey);
      if (cached) return { price: parseFloat(cached), cached: true };
    } catch { /* Redis indisponible */ }

    let price: number | null = null;
    if (INSTRUMENTS.some(i => i.symbol.toUpperCase() === sym && i.category === 'FUTURES_US')) {
      price = await this.fetchYahooPrice(`${sym}=F`);
    } else if (sym.includes('USDT')) {
      price = await this.fetchBinancePrice(sym.replace('/', ''));
    } else {
      price = await this.fetchFmpPrice(this.mapSymbolToFmp(sym));
    }

    if (price !== null) {
      try { await this.redisService.client.setex(cacheKey, CACHE_TTL.PRICE, String(price)); } catch { /* ignore */ }
    }
    return { price, cached: false };
  }

  async searchSymbols(query: string): Promise<Array<{ symbol: string; label: string; category: string }>> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey || !query.trim()) return [];
    try {
      const url = `https://financialmodelingprep.com/stable/search?query=${encodeURIComponent(query)}&limit=12&apikey=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as Array<{ symbol: string; name: string; exchangeShortName: string }>;
      return data.filter(r => r.symbol && r.name)
        .map(r => ({ symbol: r.symbol, label: `${r.name} (${r.symbol})`, category: this.getCategory(r.exchangeShortName ?? '') }))
        .slice(0, 10);
    } catch (err) {
      this.logger.warn(`FMP search failed: ${(err as Error).message}`);
      return [];
    }
  }

  async fetchYahooPrice(yahooSymbol: string): Promise<number | null> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return null;
      const data = await res.json() as { chart: { result?: Array<{ meta: { regularMarketPrice: number } }> } };
      return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    } catch { return null; }
  }

  async fetchBinancePrice(symbol: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      const data = await res.json() as { price: string };
      return data?.price ? parseFloat(data.price) : null;
    } catch { return null; }
  }

  async fetchFmpPrice(symbol: string): Promise<number | null> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    if (!apiKey) return null;
    try {
      const res = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
      if (!res.ok) return null;
      const data = await res.json() as Array<{ price: number }>;
      return data?.[0]?.price ?? null;
    } catch { return null; }
  }

  mapSymbolToFmp(symbol: string): string {
    const map: Record<string, string> = {
      'EUR/USD': 'EURUSD', 'GBP/USD': 'GBPUSD', 'USD/JPY': 'USDJPY',
      'AUD/USD': 'AUDUSD', 'USD/CHF': 'USDCHF', 'NZD/USD': 'NZDUSD',
      'USD/CAD': 'USDCAD', 'EUR/GBP': 'EURGBP', 'EUR/JPY': 'EURJPY',
      'GBP/JPY': 'GBPJPY',
      'MNQ': 'QQQ', 'NQ': 'QQQ', 'MES': 'SPY', 'ES': 'SPY',
      'MYM': 'DIA', 'YM': 'DIA', 'GC': 'GLD', 'MGC': 'GLD',
      'CL': 'USO', 'MCL': 'USO', 'M2K': 'IWM', 'RTY': 'IWM',
      'BTC/USDT': 'BTCUSD', 'ETH/USDT': 'ETHUSD',
      'BTC/USD': 'BTCUSD', 'ETH/USD': 'ETHUSD',
      'SOL/USDT': 'SOLUSD', 'XRP/USDT': 'XRPUSD',
      'BNB/USDT': 'BNBUSD', 'ADA/USDT': 'ADAUSD',
    };
    return map[symbol] ?? symbol;
  }

  private async fetchDxy(): Promise<number | null> {
    return this.fetchYahooPrice('DX-Y.NYB');
  }

  private async fetchTreasuryRates(): Promise<TreasuryRates> {
    const apiKey = this.config.get<string>('FMP_API_KEY');
    const empty: TreasuryRates = { t2y: null, t5y: null, t10y: null, t30y: null };
    if (!apiKey) return empty;
    try {
      const res = await fetch(`https://financialmodelingprep.com/stable/treasury-rates?apikey=${apiKey}`);
      if (!res.ok) return empty;
      const data = await res.json() as Array<Record<string, number>>;
      const latest = data?.[0];
      if (!latest) return empty;
      return {
        t2y:  latest['year2']   ?? latest['twoYear']    ?? latest['2Year']   ?? null,
        t5y:  latest['year5']   ?? latest['fiveYear']   ?? latest['5Year']   ?? null,
        t10y: latest['year10']  ?? latest['tenYear']    ?? latest['10Year']  ?? null,
        t30y: latest['year30']  ?? latest['thirtyYear'] ?? latest['30Year']  ?? null,
      };
    } catch (err) {
      this.logger.warn(`Treasury rates failed: ${(err as Error).message}`);
      return empty;
    }
  }

  private getCategory(exchange: string): string {
    const ex = exchange.toUpperCase();
    if (['CME', 'CBOT', 'NYMEX', 'COMEX'].includes(ex)) return 'FUTURES';
    if (['CRYPTO', 'COINBASE', 'BINANCE'].includes(ex)) return 'CRYPTO';
    if (ex === 'FOREX' || ex === 'FX') return 'FOREX';
    if (['NYSE', 'NASDAQ', 'AMEX'].includes(ex)) return 'ACTIONS';
    return 'AUTRES';
  }
}
