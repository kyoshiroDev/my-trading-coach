import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AmbassadorGuard } from '../../common/guards/ambassador.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AmbassadorService } from './ambassador.service';
import { PrismaService } from '../../prisma/prisma.service';

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
    @CurrentUser() user: { id: string },
    @Query('userId') userId?: string,
  ) {
    return this.service.getStats(userId ?? user.id);
  }

  @Get('list')
  @UseGuards(AdminGuard)
  getList() {
    return this.service.listAmbassadors();
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
