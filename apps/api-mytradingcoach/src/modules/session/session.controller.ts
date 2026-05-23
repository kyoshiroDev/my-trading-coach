import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BetaGuard } from '../../common/guards/beta.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';

@Controller('session')
@UseGuards(JwtAuthGuard, BetaGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  start(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessionService.startSession(user.id, dto.mood);
  }

  @Get('active')
  getActive(@CurrentUser() user: { id: string }) {
    return this.sessionService.getActiveSession(user.id);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    return this.sessionService.closeSession(user.id, id, dto.mood, dto.notes);
  }

  @Get('today/trades')
  getTodayTrades(@CurrentUser() user: { id: string }) {
    return this.sessionService.getTodayTrades(user.id);
  }

  @Get('today/stats')
  getLiveStats(@CurrentUser() user: { id: string }) {
    return this.sessionService.getLiveStats(user.id);
  }

  @Post('trades/:id/close')
  closeTrade(
    @CurrentUser() user: { id: string },
    @Param('id') tradeId: string,
    @Body('exitPrice') exitPrice: number,
  ) {
    return this.sessionService.closeTrade(user.id, tradeId, exitPrice);
  }
}
