import { Body, Controller, Get, Header, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { FOUNDER_PUBLIC_CACHE_CONTROL } from '../founder-offer/founder-offer.controller';
import { PartnerCodeService, type PartnerPublicConditions } from './partner-code.service';
import { CreatePartnerCodeDto, UpdatePartnerCodeDto } from './dto/partner-code.dto';

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

@Controller('pricing')
export class PartnerPricingController {
  constructor(private readonly codes: PartnerCodeService) {}

  /**
   * Conditions d'un code pour l'affichage (landing, modale). Ni le nom du partenaire, ni le
   * nombre d'utilisations. Débit serré (20/min/IP) contre l'énumération des codes.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Header('Cache-Control', FOUNDER_PUBLIC_CACHE_CONTROL)
  @Get('partner/:code')
  partner(@Param('code') code: string): Promise<PartnerPublicConditions> {
    return this.codes.validate(code.slice(0, 40));
  }
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/partner-codes')
export class PartnerCodeAdminController {
  constructor(private readonly codes: PartnerCodeService) {}

  @Get()
  list() {
    return this.codes.list();
  }

  /** Création : les 2 coupons Stripe (mensuel, annuel) sont créés par l'API. */
  @Post()
  create(@Body() dto: CreatePartnerCodeDto) {
    return this.codes.create({ ...dto, expiresAt: toDate(dto.expiresAt) ?? null });
  }

  /** Modification ou activation : sans effet sur ceux qui ont déjà le code. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePartnerCodeDto) {
    return this.codes.update(id, { ...dto, expiresAt: toDate(dto.expiresAt) });
  }

  @Get(':id/users')
  users(@Param('id') id: string) {
    return this.codes.users(id);
  }
}
