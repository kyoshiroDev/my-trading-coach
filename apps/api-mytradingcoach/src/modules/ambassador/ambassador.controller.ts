import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AmbassadorGuard } from '../../common/guards/ambassador.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AmbassadorService } from './ambassador.service';
import { DeprecatedRoute } from '../../common/decorators/deprecated-route.decorator';
import {
  PromoteAmbassadorDto,
  RevokeAmbassadorDto,
} from './dto/admin-ambassador.dto';

@Controller('ambassador')
@UseGuards(JwtAuthGuard, AmbassadorGuard)
export class AmbassadorController {
  constructor(private readonly service: AmbassadorService) {}

  @Get('new-count')
  getNewCount(
    @CurrentUser() user: { id: string },
    @Query('since') since: string,
  ) {
    return this.service.getNewCount(user.id, since);
  }

  @Get('stats')
  getStats(
    @CurrentUser() user: { id: string; role: Role },
    @Query('userId') userId?: string,
  ) {
    // IDOR: seul un ADMIN peut consulter les stats d'un autre ambassadeur.
    // Un ambassadeur normal est toujours forcé sur ses propres données.
    // Admin : préférer GET /admin/ambassadors/:id/stats (`userId` gardé une version).
    const targetId =
      user.role === Role.ADMIN && userId ? userId : user.id;
    return this.service.getStats(targetId);
  }

  @Get('list')
  @UseGuards(AdminGuard)
  @DeprecatedRoute('GET /admin/ambassadors')
  getList() {
    return this.service.listAmbassadors();
  }

  @Post('admin/promote')
  @UseGuards(AdminGuard)
  @DeprecatedRoute('POST /admin/ambassadors/promote')
  promote(@Body() dto: PromoteAmbassadorDto) {
    return this.service.promote(dto.email, dto.referralCode);
  }

  @Post('admin/revoke')
  @UseGuards(AdminGuard)
  @DeprecatedRoute('POST /admin/ambassadors/revoke')
  revoke(@Body() dto: RevokeAmbassadorDto) {
    return this.service.revoke(dto.email);
  }

  @Patch('pay-all/:ambassadorId')
  @UseGuards(AdminGuard)
  @DeprecatedRoute('PATCH /admin/ambassadors/:id/pay-all')
  async markAllPaid(@Param('ambassadorId') ambassadorId: string) {
    await this.service.markAllPaid(ambassadorId);
    return { success: true };
  }
}
