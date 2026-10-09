import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Plan, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TradesService } from './trades.service';
import { CsvImportService, type FeesReport } from './csv-import.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { UpdateTradeDto } from './dto/update-trade.dto';
import { TradeFiltersDto } from './dto/trade-filters.dto';
import { ImportTradesBodyDto } from './dto/import-trades.dto';
import { ReassignTradesDto } from './dto/reassign-trades.dto';
import { SaveUserAssetsDto, SetFavoriteAssetDto } from './dto/user-assets.dto';
import { InstrumentsService } from './instruments.service';
import { UserAssetsService } from './user-assets.service';
import { MarketDataService } from './market-data.service';
import { DeprecatedRoute } from '../../common/decorators/deprecated-route.decorator';
import { AccountsService } from '../accounts/accounts.service';
import { SetupsService } from '../setups/setups.service';

export const IMPORT_THROTTLE_LIMIT = 5;

@UseGuards(JwtAuthGuard)
@Controller('trades')
export class TradesController {
  constructor(
    private tradesService: TradesService,
    private csvImportService: CsvImportService,
    private readonly accounts: AccountsService,
    private readonly setups: SetupsService,
    private readonly instruments: InstrumentsService,
    private readonly userAssets: UserAssetsService,
    private readonly marketData: MarketDataService, // anciennes routes /trades/market-* uniquement
  ) {}

  // ── Anciennes routes : déplacées vers /market/* et /instruments/* (API-21) ──
  // Gardées une version (déploiement front/back non simultané), puis à supprimer.

  @Get('market-context')
  @DeprecatedRoute('GET /market/context')
  getMarketContext() { return this.marketData.getMarketContext(); }

  @Get('news')
  @DeprecatedRoute('GET /market/news')
  getMarketNews(@Query('symbols') symbols: string) { return this.marketData.getNews(symbols ?? ''); }

  @Get('news/:id/text')
  @DeprecatedRoute('GET /market/news/:id/text')
  async getNewsText(@Param('id') id: string) { return { text: await this.marketData.ensureNewsTextFr(id) }; }

  @Get('live-price')
  @DeprecatedRoute('GET /market/live-price')
  async getLivePrice(@Query('symbol') symbol: string) {
    if (!symbol?.trim()) return { price: null, symbol: '', cached: false };
    return { ...(await this.marketData.getLivePrice(symbol.trim())), symbol };
  }

  @Get('instruments')
  @DeprecatedRoute('GET /instruments')
  getInstruments() { return this.instruments.list(); }

  @Post('import')
  // 5 imports / min par utilisateur (SCA-B1-04) : un import peut porter des milliers de lignes.
  @Throttle({ default: { ttl: 60_000, limit: IMPORT_THROTTLE_LIMIT } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 }, // trades : obligatoire (rétro-compat front)
        { name: 'fees', maxCount: 1 }, // Cash history Tradovate : optionnel (frais exacts)
      ],
      {
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
      },
    ),
  )
  async importCSV(
    @CurrentUser() user: { id: string; plan: Plan; role: Role; trialEndsAt?: Date | null },
    @UploadedFiles()
    files: { file?: Express.Multer.File[]; fees?: Express.Multer.File[] },
    @Body() body: ImportTradesBodyDto,
  ) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException('Fichier manquant');
    const feesUpload = files?.fees?.[0];

    // Total des frais (multipart → string) réparti au prorata des contrats. Optionnel.
    const rawFees = body?.totalFees != null ? Math.abs(parseFloat(body.totalFees)) : NaN;
    const totalFees = Number.isFinite(rawFees) ? rawFees : undefined;

    // Compte cible : valide l'ownership (gère 'all'/absent → pas de compte forcé,
    // fallback backend). C'est le correctif du rattachement multi-compte.
    const { accountId } = await this.accounts.accountWhere(user.id, body.accountId);
    // Setup en lot : JAMAIS bloquant. Un id périmé (setup supprimé/archivé après
    // que le front l'a présélectionné) faisait rejeter tout l'import en 400 — des
    // dizaines de trades perdus pour un champ accessoire (bug Val). On retombe
    // sur le setup par défaut, ou sur aucun setup. La validation stricte reste
    // en place pour la création manuelle d'un trade (POST /trades).
    const setupId = await this.setups.resolveBatchSetupId(user.id, body.setupId);

    // Rapport de rapprochement des frais (fusion Tradovate) : rempli si un Cash history valide.
    const report: { fees?: FeesReport } = {};
    const parsed = await this.csvImportService.parseCSV(
      file.buffer,
      file.originalname,
      user.id,
      { plan: user.plan, role: user.role, trialEndsAt: user.trialEndsAt },
      totalFees,
      { accountId, emotion: body.emotion, setupId: setupId ?? undefined },
      feesUpload ? { buffer: feesUpload.buffer, filename: feesUpload.originalname } : undefined,
      report,
    );

    // Déduplication à l'import : ne recrée pas un trade déjà présent (ré-essais, ré-imports).
    const result = await this.tradesService.importTrades(user.id, parsed);

    // Résumé frais exacts (fusion fichier) exposé au front, non bloquant.
    return report.fees ? { ...result, feesImported: report.fees } : result;
  }

  @Post()
  create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateTradeDto,
  ) {
    return this.tradesService.create(user.id, dto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: { id: string },
    @Query() filters: TradeFiltersDto,
  ) {
    // Valide l'appartenance du compte filtré (404 si pas au user) ; 'all'/absent = agrégé.
    await this.accounts.accountWhere(user.id, filters.accountId);
    return this.tradesService.findAll(user.id, filters);
  }

  // KPIs agrégés sur l'ensemble filtré complet (hors pagination) : déclaré avant ':id'.
  @Get('stats')
  async stats(
    @CurrentUser() user: { id: string },
    @Query() filters: TradeFiltersDto,
  ) {
    await this.accounts.accountWhere(user.id, filters.accountId);
    return this.tradesService.computeJournalStats(user.id, filters);
  }

  @Get('user-assets')
  @DeprecatedRoute('GET /instruments/user-assets')
  getUserAssets(@CurrentUser() user: { id: string }) { return this.userAssets.getUserAssets(user.id); }

  @Patch('user-assets')
  @DeprecatedRoute('PATCH /instruments/user-assets')
  async saveUserAssets(@CurrentUser() user: { id: string }, @Body() body: SaveUserAssetsDto) {
    await this.userAssets.saveUserAssets(user.id, body.assets ?? [], body.favoriteAsset);
    return { saved: true };
  }

  @Patch('favorite-asset')
  @DeprecatedRoute('PATCH /instruments/favorite-asset')
  setFavoriteAsset(@CurrentUser() user: { id: string }, @Body() body: SetFavoriteAssetDto) {
    return this.userAssets.setFavoriteAsset(user.id, body.asset ?? null);
  }

  @Get('instruments/search')
  @DeprecatedRoute('GET /instruments/search')
  searchInstruments(@Query('q') q: string) { return this.instruments.search(q); }

  // ⚠️ Déclarés avant les routes ':id' pour ne pas être capturés par @Get/@Delete(':id').
  @Get('duplicates')
  getDuplicates(@CurrentUser() user: { id: string }) {
    return this.tradesService.countDuplicates(user.id);
  }

  @Delete('duplicates')
  removeDuplicates(@CurrentUser() user: { id: string }) {
    return this.tradesService.removeDuplicates(user.id);
  }

  // Réaffecter un lot de trades (ex. une journée) à un autre compte.
  @Patch('reassign')
  async reassign(
    @CurrentUser() user: { id: string },
    @Body() body: ReassignTradesDto,
  ) {
    if (!Array.isArray(body?.tradeIds) || body.tradeIds.length === 0) {
      throw new BadRequestException('Aucun trade à déplacer.');
    }
    if (!body.accountId || body.accountId === 'all') {
      throw new BadRequestException('Compte cible requis.');
    }
    // accountWhere rejette un compte non possédé (anti-IDOR) ; 'all'/vide déjà exclu.
    const { accountId } = await this.accounts.accountWhere(user.id, body.accountId);
    if (!accountId) throw new BadRequestException('Compte cible requis.');
    return this.tradesService.reassignAccount(user.id, body.tradeIds, accountId);
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
