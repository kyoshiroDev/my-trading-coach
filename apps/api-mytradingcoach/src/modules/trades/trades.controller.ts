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
import { Plan, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TradesService } from './trades.service';
import { CoinGeckoService } from './coingecko.service';
import { CsvImportService } from './csv-import.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { INSTRUMENTS } from './instruments.const';
import { MarketDataService } from './market-data.service';

@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradesController {
  private readonly logger = new Logger(TradesController.name);

  constructor(
    private tradesService: TradesService,
    private coinGeckoService: CoinGeckoService,
    private csvImportService: CsvImportService,
    private readonly marketData: MarketDataService,
  ) {}

  @Get('market-context')
  getMarketContext() { return this.marketData.getMarketContext(); }

  @Get('news')
  getMarketNews(@Query('symbols') symbols: string) {
    return this.marketData.getNews(symbols ?? '');
  }

  @Get('live-price')
  async getLivePrice(@Query('symbol') symbol: string): Promise<{ price: number | null; symbol: string; cached: boolean }> {
    if (!symbol?.trim()) return { price: null, symbol: '', cached: false };
    return { ...(await this.marketData.getLivePrice(symbol.trim())), symbol };
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

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname.match(/\.(csv|txt|xlsx|xls)$/i)) {
          return cb(
            new BadRequestException('Formats acceptés : CSV, TXT, Excel (.xlsx)'),
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

  @Get('instruments/search')
  async searchInstruments(@Query('q') q: string) {
    const query = (q ?? '').trim();
    if (!query) return [];
    const fmpResults = await this.marketData.searchSymbols(query);
    if (fmpResults.length > 0) return fmpResults;
    const lq = query.toLowerCase();
    const staticMatches = INSTRUMENTS
      .filter(i => i.symbol.toLowerCase().includes(lq) || i.label.toLowerCase().includes(lq))
      .slice(0, 10)
      .map(i => ({ symbol: i.symbol, label: i.label, category: i.category }));
    if (staticMatches.length >= 5) return staticMatches;
    try {
      const crypto = (await this.coinGeckoService.getCryptoInstruments())
        .filter(i => i.symbol.toLowerCase().includes(lq) || i.label.toLowerCase().includes(lq))
        .slice(0, 5).map(i => ({ symbol: i.symbol, label: i.label, category: i.category }));
      const seen = new Set(staticMatches.map(i => i.symbol));
      return [...staticMatches, ...crypto.filter(i => !seen.has(i.symbol))].slice(0, 10);
    } catch { return staticMatches; }
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
