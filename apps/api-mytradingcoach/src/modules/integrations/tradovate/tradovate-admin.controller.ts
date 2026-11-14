import { ConflictException, Controller, Get, HttpCode, NotFoundException, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { TradovateFeesRepairService } from './tradovate-fees-repair.service';
import { TradovatePositionsRepairService } from './tradovate-positions-repair.service';

/**
 * Réservé ADMIN : réparations des trades Tradovate importés.
 * - frais des trades importés avant le 31/10 (#783) : `…/repair-fees` ;
 * - lignes d'une même position importées avant #956 : `…/repair-positions` (+ `…/backup`).
 * `POST` = essai (rien n'est écrit) ; `?apply=true` = écrit. Réponse immédiate, la réparation tourne
 * en arrière-plan ; `GET` rend le dernier rapport.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/tradovate')
export class TradovateAdminController {
  constructor(
    private readonly repair: TradovateFeesRepairService,
    private readonly positions: TradovatePositionsRepairService,
  ) {}

  @Post('repair-fees')
  @HttpCode(202)
  async repairFees(@Query('apply') apply?: string) {
    const write = apply === 'true';
    if (!(await this.repair.start(write))) {
      throw new ConflictException('Une réparation des frais tourne déjà : attends son rapport.');
    }
    return { started: true, apply: write };
  }

  @Get('repair-fees')
  async repairFeesReport() {
    return (await this.repair.lastReport()) ?? { status: 'none' };
  }

  @Post('repair-positions')
  @HttpCode(202)
  async repairPositions(@Query('apply') apply?: string) {
    const write = apply === 'true';
    if (!(await this.positions.start(write))) {
      throw new ConflictException('Une réparation des positions tourne déjà : attends son rapport.');
    }
    return { started: true, apply: write };
  }

  @Get('repair-positions')
  async repairPositionsReport() {
    return (await this.positions.lastReport()) ?? { status: 'none' };
  }

  /**
   * Lignes avant fusion (JSONL, une ligne par trade) : sauvegarde du dernier rapport appliqué, ou
   * celle de `?at=AAAAMMJJ-HHMM`. 404 si absente ou expirée (30 jours).
   */
  @Get('repair-positions/backup')
  async repairPositionsBackup(@Query('at') at?: string): Promise<StreamableFile> {
    const b = await this.positions.backup(at);
    if (!b) throw new NotFoundException('Aucune sauvegarde pour cette date (absente ou expirée).');
    return new StreamableFile(Buffer.from(b.jsonl, 'utf-8'), {
      type: 'application/x-ndjson; charset=utf-8',
      disposition: `attachment; filename="repair-positions-956-${b.at}.jsonl"`,
    });
  }
}
