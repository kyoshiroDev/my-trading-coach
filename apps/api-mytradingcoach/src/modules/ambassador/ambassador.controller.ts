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
import { PrismaService } from '../../prisma/prisma.service';
import {
  PromoteAmbassadorDto,
  RevokeAmbassadorDto,
} from './dto/admin-ambassador.dto';

@Controller('ambassador')
@UseGuards(JwtAuthGuard, AmbassadorGuard)
export class AmbassadorController {
  constructor(
    private readonly service: AmbassadorService,
    private readonly prisma: PrismaService,
  ) {}

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
    const targetId =
      user.role === Role.ADMIN && userId ? userId : user.id;
    return this.service.getStats(targetId);
  }

  @Get('list')
  @UseGuards(AdminGuard)
  getList() {
    return this.service.listAmbassadors();
  }

  @Post('admin/promote')
  @UseGuards(AdminGuard)
  promote(@Body() dto: PromoteAmbassadorDto) {
    return this.service.promote(dto.email, dto.referralCode);
  }

  @Post('admin/revoke')
  @UseGuards(AdminGuard)
  revoke(@Body() dto: RevokeAmbassadorDto) {
    return this.service.revoke(dto.email);
  }

  @Patch('pay-all/:ambassadorId')
  @UseGuards(AdminGuard)
  async markAllPaid(@Param('ambassadorId') ambassadorId: string) {
    await this.prisma.referralCommission.updateMany({
      where: { ambassadorId, status: 'pending' },
      data: { status: 'paid' },
    });
    return { success: true };
  }
}
