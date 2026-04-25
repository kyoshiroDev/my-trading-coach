import { Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DebriefService } from './debrief.service';

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('debrief')
export class DebriefController {
  constructor(private debriefService: DebriefService) {}

  @Get('current')
  getCurrent(@CurrentUser() user: { id: string }) {
    return this.debriefService.getCurrent(user.id);
  }

  @Get('history')
  getHistory(@CurrentUser() user: { id: string }) {
    return this.debriefService.getHistory(user.id);
  }

  @Get(':year/:week')
  getByWeek(
    @CurrentUser() user: { id: string },
    @Param('year', ParseIntPipe) year: number,
    @Param('week', ParseIntPipe) weekNumber: number,
  ) {
    return this.debriefService.getByWeek(user.id, year, weekNumber);
  }

  @Post('generate')
  generate(@CurrentUser() user: { id: string; role: Role }) {
    return this.debriefService.generate(user.id, user.role);
  }
}
