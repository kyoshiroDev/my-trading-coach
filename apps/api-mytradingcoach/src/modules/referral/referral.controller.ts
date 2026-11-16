import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AmbassadorGuard } from '../../common/guards/ambassador.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReferralService } from './referral.service';
import { DeprecatedRoute } from '../../common/decorators/deprecated-route.decorator';
import { ApplyAmbassadorDto } from './dto/apply-ambassador.dto';

@Controller('referral')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  constructor(private readonly service: ReferralService) {}

  // Stats parrain (app) : tout user authentifié
  @Get('me')
  getMe(@CurrentUser() user: { id: string }) {
    return this.service.getMyReferral(user.id);
  }

  // Overview admin (parrainage grand public, démo exclus)
  @Get('admin/overview')
  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/referral/overview')
  getAdminOverview() {
    return this.service.getAdminOverview();
  }

  // Demande pour devenir ambassadeur : email à l'équipe, pas de passage auto.
  // Chaque appel envoie un e-mail et un push à l'équipe : 3 par heure (S4 #1063).
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  @Post('ambassador/apply')
  apply(@CurrentUser() user: { id: string }, @Body() dto: ApplyAmbassadorDto) {
    return this.service.applyAmbassador(user.id, dto);
  }

  // Relevé de commissions (PDF, PAS une facture) : réservé aux ambassadeurs
  @Post('ambassador/statement')
  @UseGuards(AmbassadorGuard)
  @Header('Content-Type', 'application/pdf')
  async statement(@CurrentUser() user: { id: string }): Promise<StreamableFile> {
    const { pdf, filename } = await this.service.generateStatement(user.id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
