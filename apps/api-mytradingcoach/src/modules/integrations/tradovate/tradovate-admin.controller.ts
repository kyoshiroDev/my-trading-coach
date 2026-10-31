import { ConflictException, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { TradovateFeesRepairService } from './tradovate-fees-repair.service';

/**
 * Réservé ADMIN : réparation des frais des trades Tradovate importés avant le 31/10 (#783).
 * `POST …/repair-fees` = essai (rien n'est écrit) ; `?apply=true` = écrit. Réponse immédiate, la
 * réparation tourne en arrière-plan ; `GET …/repair-fees` rend le dernier rapport.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/tradovate')
export class TradovateAdminController {
  constructor(private readonly repair: TradovateFeesRepairService) {}

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
}
