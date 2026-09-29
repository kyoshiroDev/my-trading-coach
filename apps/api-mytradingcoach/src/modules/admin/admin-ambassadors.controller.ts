import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AmbassadorService } from '../ambassador/ambassador.service';
import { PromoteAmbassadorDto, RevokeAmbassadorDto } from '../ambassador/dto/admin-ambassador.dto';
import { ReferralService } from '../referral/referral.service';

/**
 * Ambassadeurs et parrainage côté admin : `/admin/ambassadors/*` et `/admin/referral/*`.
 * Guard au niveau de la classe. Les routes de l'ambassadeur lui-même restent sous `/ambassador`.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAmbassadorsController {
  constructor(
    private readonly ambassadors: AmbassadorService,
    private readonly referral: ReferralService,
  ) {}

  @Get('ambassadors')
  list() {
    return this.ambassadors.listAmbassadors();
  }

  @Post('ambassadors/promote')
  promote(@Body() dto: PromoteAmbassadorDto) {
    return this.ambassadors.promote(dto.email, dto.referralCode);
  }

  @Post('ambassadors/revoke')
  revoke(@Body() dto: RevokeAmbassadorDto) {
    return this.ambassadors.revoke(dto.email);
  }

  @Get('ambassadors/:id/stats')
  stats(@Param('id') id: string) {
    return this.ambassadors.getStats(id);
  }

  @Patch('ambassadors/:id/pay-all')
  async payAll(@Param('id') id: string) {
    await this.ambassadors.markAllPaid(id);
    return { success: true };
  }

  /** Parrainage grand public (démo exclus). */
  @Get('referral/overview')
  referralOverview() {
    return this.referral.getAdminOverview();
  }
}
