import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import Redis from 'ioredis';
import { Plan, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';
import { CsvImportService } from './csv-import.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { INSTRUMENTS } from './instruments.const';

interface MarketContextItem { value: number | null; source: 'fmp' | 'yahoo' | 'binance'; }
interface TreasuryRates    { t2y: number | null; t5y: number | null; t10y: number | null; t30y: number | null; }
interface MarketContextDto { nq: MarketContextItem; spx: MarketContextItem; dxy: MarketContextItem; treasury: TreasuryRates; updatedAt: string; }
interface NewsItem         { title: string; symbol: string; publishedDate: string; sentiment?: 'bull' | 'bear' | 'neutral'; url?: string; }

@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);
  private readonly redis = new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379'),
    password: process.env['REDIS_PASSWORD'],
    lazyConnect: true,
  });

  constructor(
    private tradesService: TradesService,
    private coinGeckoService: CoinGeckoService,
    private csvImportService: CsvImportService,
  ) {}

  @Get('market-context')
  async getMarketContext(): Promise<MarketContextDto> {
    const cacheKey = 'market:context';
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as MarketContextDto;
    } catch { /* Redis indisponible */ }

    const [nq, spx, dxy, treasury] = await Promise.allSettled([
      this.fetchYahooPrice('NQ=F'),
      this.fetchFmpPrice('SPY'),
      this.fetchFmpPrice('DXY'),
      this.fetchTreasuryRates(),
    ]);

    const result: MarketContextDto = {
      nq:       { value: nq.status      === 'fulfilled' ? nq.value      : null, source: 'yahoo' },
      spx:      { value: spx.status     === 'fulfilled' ? spx.value     : null, source: 'fmp'   },
      dxy:      { value: dxy.status     === 'fulfilled' ? dxy.value     : null, source: 'fmp'   },
      treasury: treasury.status === 'fulfilled' ? treasury.value : { t2y: null, t5y: null, t10y: null, t30y: null },
      updatedAt: new Date().toISOString(),
    };

    try { await this.redis.setex(cacheKey, 15, JSON.stringify(result)); } catch { /* ignore */ }
    return result;
  }

  @Get('news')
  async getMarketNews(@Query('symbols') symbols: string): Promise<NewsItem[]> {
    const cacheKey = `market:news:${symbols}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as NewsItem[];
    } catch { /* ignore */ }

    const apiKey = process.env['FMP_API_KEY'];
    if (!apiKey) return [];

    try {
      const fmpSymbols = (symbols || '')
        .split(',')
        .map(s => this.mapSymbolToFmp(s.trim()))
        .filter(Boolean)
        .join(',');

      const url = `https://financialmodelingprep.com/stable/news/stock?symbols=${fmpSymbols}&limit=20&apikey=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as NewsItem[];
      try { await this.redis.setex(cacheKey, 60, JSON.stringify(data)); } catch { /* ignore */ }
      return data;
    } catch { return []; }
  }

  private async fetchTreasuryRates(): Promise<TreasuryRates> {
    const apiKey = process.env['FMP_API_KEY'];
    if (!apiKey) return { t2y: null, t5y: null, t10y: null, t30y: null };
    try {
      const url = `https://financialmodelingprep.com/stable/treasury-rates?apikey=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) return { t2y: null, t5y: null, t10y: null, t30y: null };
      const data = await res.json() as Array<{ year2: number; year5: number; year10: number; year30: number }>;
      const latest = data?.[0];
      return {
        t2y:  latest?.year2  ?? null,
        t5y:  latest?.year5  ?? null,
        t10y: latest?.year10 ?? null,
        t30y: latest?.year30 ?? null,
      };
    } catch { return { t2y: null, t5y: null, t10y: null, t30y: null }; }
  }

  @Get('monthly-count')
  async getMonthlyCount(
    @CurrentUser() user: { id: string; plan: Plan; role: Role },
  ) {
    return this.tradesService.countThisMonth(user.id, user.plan, user.role);
  }

  @Get('instruments')
  async getInstruments() {
    const cryptoInstruments = await this.coinGeckoService.getCryptoInstruments();
    // Retourner uniquement les futures CME (ceux avec tickValue utile)
    const futuresOnly = INSTRUMENTS.filter((i) => i.category === 'FUTURES_US');
    return [...futuresOnly, ...cryptoInstruments];
  }

  @Get('live-price')
  async getLivePrice(
    @Query('symbol') symbol: string,
  ): Promise<{ price: number | null; symbol: string; cached: boolean }> {
    if (!symbol?.trim()) return { price: null, symbol: '', cached: false };

    const sym = symbol.trim().toUpperCase();
    const cacheKey = `price:${sym}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return { price: parseFloat(cached), symbol, cached: true };
    } catch { /* Redis indisponible */ }

    let price: number | null = null;

    // Futures CME → Yahoo Finance (FMP Starter ne couvre pas les futures)
    if (INSTRUMENTS.some(i => i.symbol.toUpperCase() === sym && i.category === 'FUTURES_US')) {
      price = await this.fetchYahooPrice(`${sym}=F`);
    }
    // Crypto /USDT → Binance (gratuit, sans clé)
    else if (sym.includes('USDT')) {
      const binanceSymbol = sym.replace('/', '');
      price = await this.fetchBinancePrice(binanceSymbol);
    }
    // Forex / Actions → FMP
    else {
      price = await this.fetchFmpPrice(this.mapSymbolToFmp(sym));
    }

    if (price !== null) {
      try { await this.redis.setex(cacheKey, 15, String(price)); } catch { /* ignore */ }
    }

    return { price, symbol, cached: false };
  }

  private async fetchYahooPrice(yahooSymbol: string): Promise<number | null> {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!response.ok) return null;
      const data = await response.json() as {
        chart: { result?: Array<{ meta: { regularMarketPrice: number } }> };
      };
      return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    } catch { return null; }
  }

  private async fetchBinancePrice(symbol: string): Promise<number | null> {
    try {
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json() as { price: string };
      return data?.price ? parseFloat(data.price) : null;
    } catch { return null; }
  }

  private async fetchFmpPrice(symbol: string): Promise<number | null> {
    const apiKey = process.env['FMP_API_KEY'];
    if (!apiKey) return null;
    try {
      const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json() as Array<{ price: number }>;
      return data?.[0]?.price ?? null;
    } catch { return null; }
  }

  private mapSymbolToFmp(symbol: string): string {
    const map: Record<string, string> = {
      'EUR/USD': 'EURUSD', 'GBP/USD': 'GBPUSD', 'USD/JPY': 'USDJPY',
      'AUD/USD': 'AUDUSD', 'USD/CHF': 'USDCHF', 'NZD/USD': 'NZDUSD',
      'USD/CAD': 'USDCAD', 'EUR/GBP': 'EURGBP', 'EUR/JPY': 'EURJPY',
      'GBP/JPY': 'GBPJPY',
    };
    return map[symbol] ?? symbol;
  }

  @Post('import')
  @UseGuards(PremiumGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(csv|txt)$/i)) {
          return cb(
            new BadRequestException('Seuls les fichiers CSV sont acceptés'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async importCSV(
    @CurrentUser() user: { id: string; plan: Plan; role: Role },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Fichier manquant');

    const parsed = await this.csvImportService.parseCSV(
      file.buffer,
      file.originalname,
      user.id,
    );

    const results = await Promise.allSettled(
      parsed.map((dto) =>
        this.tradesService.create(
          user.id,
          dto as CreateTradeDto,
          user.plan,
          user.role,
        ),
      ),
    );

    const created = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    return { created, failed, total: parsed.length };
  }

  @Post()
  create(
    @CurrentUser() user: { id: string; plan: Plan; role: Role },
    @Body() dto: CreateTradeDto,
  ) {
    return this.tradesService.create(user.id, dto, user.plan, user.role);
  }

  @Get()
  findAll(
    @CurrentUser() user: { id: string },
    @Query() filters: TradeFiltersDto,
  ) {
    return this.tradesService.findAll(user.id, filters);
  }

  @Get('user-assets')
  getUserAssets(@CurrentUser() user: { id: string }) {
    return this.tradesService.getUserAssets(user.id);
  }

  @Patch('user-assets')
  async saveUserAssets(
    @CurrentUser() user: { id: string },
    @Body() body: { assets: string[]; favoriteAsset?: string | null },
  ) {
    await this.tradesService.saveUserAssets(user.id, body.assets ?? [], body.favoriteAsset);
    return { saved: true };
  }

  @Patch('favorite-asset')
  setFavoriteAsset(
    @CurrentUser() user: { id: string },
    @Body('asset') asset: string | null,
  ) {
    return this.tradesService.setFavoriteAsset(user.id, asset ?? null);
  }

  @Get('instruments/search')
  async searchInstruments(
    @Query('q') q: string,
  ) {
    const query = (q ?? '').trim();
    if (!query) return [];

    const apiKey = process.env['FMP_API_KEY'];

    if (apiKey) {
      try {
        const url =
          `https://financialmodelingprep.com/stable/search` +
          `?query=${encodeURIComponent(query)}&limit=12&apikey=${apiKey}`;

        const response = await fetch(url);

        if (response.ok) {
          const data = (await response.json()) as Array<{
            symbol: string;
            name: string;
            currency: string;
            stockExchange: string;
            exchangeShortName: string;
          }>;

          const getCategory = (exchange: string): string => {
            const ex = exchange.toUpperCase();
            if (['CME', 'CBOT', 'NYMEX', 'COMEX'].includes(ex)) return 'FUTURES';
            if (['CRYPTO', 'COINBASE', 'BINANCE'].includes(ex)) return 'CRYPTO';
            if (ex === 'FOREX' || ex === 'FX') return 'FOREX';
            if (['NYSE', 'NASDAQ', 'AMEX'].includes(ex)) return 'ACTIONS';
            return 'AUTRES';
          };

          return data
            .filter((r) => r.symbol && r.name)
            .map((r) => ({
              symbol: r.symbol,
              label: `${r.name} (${r.symbol})`,
              category: getCategory(r.exchangeShortName ?? ''),
            }))
            .slice(0, 10);
        }
      } catch {
        this.logger.warn('FMP search failed — fallback liste statique');
      }
    }

    // Fallback — liste statique + CoinGecko
    const lq = query.toLowerCase();
    const staticMatches = INSTRUMENTS.filter(
      (i) =>
        i.symbol.toLowerCase().includes(lq) ||
        i.label.toLowerCase().includes(lq),
    ).slice(0, 10);

    let cryptoMatches: Array<{ symbol: string; label: string; category: string }> = [];
    if (staticMatches.length < 5) {
      try {
        cryptoMatches = (await this.coinGeckoService.getCryptoInstruments())
          .filter(
            (i) =>
              i.symbol.toLowerCase().includes(lq) ||
              i.label.toLowerCase().includes(lq),
          )
          .slice(0, 5)
          .map((i) => ({ symbol: i.symbol, label: i.label, category: i.category }));
      } catch {
        // CoinGecko indisponible
      }
    }

    const seen = new Set(staticMatches.map((i) => i.symbol));
    return [
      ...staticMatches.map((i) => ({ symbol: i.symbol, label: i.label, category: i.category })),
      ...cryptoMatches.filter((i) => !seen.has(i.symbol)),
    ].slice(0, 10);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tradesService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateTradeDto,
  ) {
    return this.tradesService.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.tradesService.remove(user.id, id);
  }
}
