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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionService } from './session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { CloseSessionDto } from './dto/close-session.dto';
import { AccountsService } from '../accounts/accounts.service';
import { parseIncludeInactive } from '../accounts/account-status-scope';
import type { SessionContractConfig, SessionWithContract } from '@mtc/shared';
import { SessionContractService } from './contract/session-contract.service';
import { SessionContractGuard, sessionContractEnabled } from './contract/session-contract.flag';
import { SessionContractDto } from './dto/session-contract.dto';

// Le compagnon de session (pré-session, live, débrief de base) est le hook du plan FREE.
// Accessible à tous les comptes connectés ; les limites FREE sont portées par les trades
// (30/mois) et les sous-features premium (analyse IA éco, contexte marché) restent gardées
// au niveau de leurs propres endpoints.
@Controller('session')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly accounts: AccountsService,
    private readonly contracts: SessionContractService,
  ) {}

  @Post('start')
  async start(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateSessionDto,
  ) {
    const session = await this.sessionService.startSession(user.id, dto.mood, dto.accountId);
    // Contrat de session (#667) : ignoré tant que SESSION_CONTRACT_ENABLED est éteint.
    await this.contracts.createForSession(user.id, session.id, dto.contract);
    return session;
  }

  // ── Contrat de session (#667), gratuit (décision provisoire du 2026-11-28) ──

  /** L'app sait si le contrat est allumé (réponse authentifiée, jamais un endpoint public). */
  @Get('contract/config')
  contractConfig(): SessionContractConfig {
    return { enabled: sessionContractEnabled() };
  }

  /** Préremplissage de la pré-session : dernière séance du compte, sinon profil. */
  @Get('contract/defaults')
  @UseGuards(SessionContractGuard)
  contractDefaults(@CurrentUser() user: { id: string }, @Query('accountId') accountId?: string) {
    return this.contracts.defaults(user.id, accountId);
  }

  /** Modification pendant la séance (ACTIVE), tracée. Démo : bloquée par DemoReadOnlyGuard. */
  @Patch(':id/contract')
  @UseGuards(SessionContractGuard)
  updateContract(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: SessionContractDto) {
    return this.contracts.update(user.id, id, dto);
  }

  @Get('active')
  getActive(@CurrentUser() user: { id: string }) {
    return this.sessionService.getActiveSession(user.id);
  }

  @Get('today')
  async getToday(@CurrentUser() user: { id: string; isDemo?: boolean }) {
    const session = await this.sessionService.getTodaySession(user.id, user.isDemo === true);
    const contract: SessionWithContract | null = session ? await this.contracts.forSession(user.id, session) : null;
    return session ? { ...session, ...contract } : session;
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
    @Body() body: UpdateSessionDto,
  ) {
    return this.sessionService.updateSession(user.id, id, body);
  }

  @Get('history')
  async getHistory(
    @CurrentUser() user: { id: string },
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('accountId') accountId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    // 'all'/absent = agrégé (sans les comptes échoués et archivés, sauf includeInactive) ;
    // sinon valide l'appartenance du compte (404 sinon).
    const acc = await this.accounts.accountWhere(user.id, accountId);
    return this.sessionService.getSessionHistory(user.id, limit, offset, {
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
      accountId: acc.accountId,
      includeInactive: parseIncludeInactive(includeInactive),
    });
  }

  @Get('history/:id')
  async getDetail(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const session = await this.sessionService.getSessionDetail(user.id, id);
    const contract: SessionWithContract | null = await this.contracts.forSession(user.id, session);
    return { ...session, ...contract };
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
