import {
  ConflictException, Controller, Get, HttpCode, InternalServerErrorException, NotFoundException, Post, Query,
  StreamableFile, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SessionDaysRepairService } from './session-days-repair.service';

/**
 * Réservé ADMIN : réparation des séances qui portent des trades d'autres journées (#1000).
 * `POST …/repair-days` = essai (rien n'est écrit) ; `?apply=true` = écrit, après sauvegarde.
 * Synchrone : la réponse est le rapport. `GET …/repair-days/backup?at=AAAAMMJJ-HHMM` = état d'avant.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/sessions')
export class AdminSessionsController {
  constructor(private readonly repair: SessionDaysRepairService) {}

  @Post('repair-days')
  @HttpCode(200)
  async repairDays(@Query('apply') apply?: string) {
    const r = await this.repair.run(apply === 'true');
    if ('busy' in r) throw new ConflictException('Une réparation des séances tourne déjà.');
    if ('error' in r) throw new InternalServerErrorException(r.error);
    return r;
  }

  @Get('repair-days/backup')
  async repairDaysBackup(@Query('at') at = ''): Promise<StreamableFile> {
    const jsonl = await this.repair.backup(at);
    if (!jsonl) throw new NotFoundException('Aucune sauvegarde pour cette date (absente ou expirée).');
    return new StreamableFile(Buffer.from(jsonl, 'utf-8'), {
      type: 'application/x-ndjson; charset=utf-8',
      disposition: `attachment; filename="repair-session-days-1000-${at}.jsonl"`,
    });
  }
}
