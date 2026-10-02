import { Body, Controller, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PublicService } from './public.service';
import { PublicAmbassadorApplyDto } from './dto/ambassador-apply.dto';
import { LandingVisitDto } from './dto/landing-visit.dto';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  /** Stats publiques (lecture seule, sans auth) : n'expose que le nombre de traders. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('stats')
  async getStats(): Promise<{ traders: number }> {
    return { traders: await this.publicService.getTradersCount() };
  }

  /** Candidature ambassadeur depuis la landing (publique). Anti-spam : 5 / minute. */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('ambassador-apply')
  async applyAmbassador(@Body() dto: PublicAmbassadorApplyDto): Promise<{ success: boolean }> {
    return this.publicService.applyAmbassador(dto);
  }

  /**
   * Page vue sur la landing : compteur agrégé sans cookie ni donnée personnelle.
   * 204 dans tous les cas (un robot filtré ne doit pas savoir qu'il l'est).
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('visit')
  @HttpCode(204)
  async recordVisit(
    @Body() dto: LandingVisitDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    await this.publicService.recordLandingVisit(dto, userAgent);
  }
}
