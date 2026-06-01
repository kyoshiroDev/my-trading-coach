import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StarterGuard } from '../../common/guards/starter.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';

@Controller('session')
@UseGuards(JwtAuthGuard, StarterGuard)
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
    return this.sessionService.closeSession(
      user.id, id, dto.mood, dto.notes, dto.reflectionNote, dto.reflectionQuestion,
    );
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { planNote?: string; marketContext?: string; notes?: string; reflectionNote?: string; moodEnd?: string },
  ) {
    return this.sessionService.updateSession(user.id, id, body);
  }

  @Get('history')
  getHistory(
    @CurrentUser() user: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.sessionService.getSessionHistory(user.id, limit, offset, {
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
    });
  }

  @Get('history/:id')
  getDetail(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.sessionService.getSessionDetail(user.id, id);
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
