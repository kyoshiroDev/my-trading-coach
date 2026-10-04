import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { PropFirmCatalogFirm, PropFirmPlanDetail } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PropFirmCatalogService } from './prop-firm-catalog.service';

@Controller('prop-firms')
@UseGuards(JwtAuthGuard)
export class PropFirmsController {
  constructor(private readonly catalog: PropFirmCatalogService) {}

  /** Catalogue pour le choix du plan d'un compte (tous plans, FREE compris). */
  @Get()
  list(): Promise<PropFirmCatalogFirm[]> {
    return this.catalog.list();
  }

  /** Règles complètes d'un plan (détail d'un compte relié au catalogue). */
  @Get('plans/:id')
  getPlan(@Param('id') id: string): Promise<PropFirmPlanDetail> {
    return this.catalog.getPlan(id);
  }
}
