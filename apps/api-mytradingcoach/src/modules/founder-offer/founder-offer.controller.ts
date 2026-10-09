import { Body, Controller, Get, Header, Patch, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FounderSeatStatus } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { FounderOfferService, type FounderPublicState } from './founder-offer.service';
import { FounderAdminService } from './founder-admin.service';
import { UpdateFounderOfferDto } from './dto/founder-offer-config.dto';

/** Compteur public : 60 s maximum en cache (navigateur, nginx, Traefik). */
export const FOUNDER_PUBLIC_CACHE_CONTROL = 'public, max-age=60';

@Controller('pricing')
export class PricingController {
  constructor(private readonly founders: FounderOfferService) {}

  /**
   * État public de l'offre fondateur (landing, côté navigateur). Lecture seule, aucune donnée
   * personnelle, `open: false` dès que l'offre ne vend plus (fermée, terminée ou complète).
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', FOUNDER_PUBLIC_CACHE_CONTROL)
  @Get('founder')
  founder(): Promise<FounderPublicState> {
    return this.founders.publicState();
  }
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class FounderAdminController {
  constructor(
    private readonly founders: FounderOfferService,
    private readonly admin: FounderAdminService,
  ) {}

  /** Fondateurs : liste paginée + totaux (pris, actifs, perdus, remboursés, restants, par clic). */
  @Get('founders')
  list(@Query('status') status?: string, @Query('page') page?: string) {
    const s = (Object.values(FounderSeatStatus) as string[]).includes(status ?? '')
      ? (status as FounderSeatStatus)
      : undefined;
    return this.admin.list({ status: s, page: Math.max(1, Number(page) || 1) });
  }

  /** Interrupteur « Ouvrir l'offre » et date de fin. */
  @Patch('founder-offer')
  update(@Body() dto: UpdateFounderOfferDto) {
    return this.founders.setConfig({
      open: dto.open,
      endsAt: dto.endsAt === undefined ? undefined : dto.endsAt === null ? null : new Date(dto.endsAt),
    });
  }
}
