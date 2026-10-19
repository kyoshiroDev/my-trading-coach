import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PlanLinkStatsService } from './plan-link-stats.service';

/** Prop firms côté admin : `/admin/prop-firms/*`. Guard au niveau de la classe. */
@Controller('admin/prop-firms')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPropFirmsController {
  constructor(private readonly planLinks: PlanLinkStatsService) {}

  /** Comptes connectés reliés à un plan / comptes connectés, et firms absentes du catalogue (#612). */
  @Get('plan-links')
  planLinkStats() {
    return this.planLinks.stats();
  }
}
