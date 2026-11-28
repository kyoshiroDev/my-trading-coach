import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { subscriptionState, type HelpAskResponse, type HelpTicketResponse } from '@mtc/shared';
import { Public } from '../../common/decorators/public.decorator';
import { DemoAllowed } from '../../common/decorators/demo-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HelpAskDto, HelpTicketDto } from './dto/help.dto';
import { HelpChatGuard } from './help.flags';
import { type HelpCaller, HelpService } from './help.service';

type HelpUser = { id: string; email?: string; plan?: string; role?: string; trialEndsAt?: Date | string | null; isDemo?: boolean };

/** Compte démo (partagé) : quota visiteur par IP hachée ; compte normal : quota du compte. */
const callerOf = (user: HelpUser, req: Request): HelpCaller =>
  user.isDemo ? { kind: 'visitor', ip: req.ip ?? '', userId: user.id } : {
        kind: 'user',
        userId: user.id,
        email: user.email,
        plan: user.plan,
        // Même règle que les guards Premium (plan, rôle, `trialEndsAt` futur).
        premium: subscriptionState({ plan: user.plan ?? null, role: user.role ?? null, trialEndsAt: user.trialEndsAt ?? null }).premiumAccess,
      };

/** Chatbot de support (#493, étape 2), derrière HELP_CHAT_ENABLED (404 éteint). */
@Controller()
@UseGuards(HelpChatGuard)
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Post('help/ask')
  @HttpCode(200)
  @DemoAllowed()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  ask(@CurrentUser() user: HelpUser, @Req() req: Request, @Body() dto: HelpAskDto): Promise<HelpAskResponse> {
    return this.help.ask(callerOf(user, req), false, dto.message, dto.history, dto.page);
  }

  @Public()
  @Post('public/help/ask')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 }, ip: { ttl: 60_000, limit: 10 } })
  askPublic(@Req() req: Request, @Body() dto: HelpAskDto): Promise<HelpAskResponse> {
    return this.help.ask({ kind: 'visitor', ip: req.ip ?? '' }, true, dto.message, dto.history, dto.page);
  }

  /** Démo : 403 (DemoReadOnlyGuard, pas de @DemoAllowed). */
  @Post('help/ticket')
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  async ticket(@CurrentUser() user: HelpUser, @Req() req: Request, @Body() dto: HelpTicketDto): Promise<HelpTicketResponse> {
    await this.help.ticket(callerOf(user, req), dto.email, dto.message, dto.history, dto.page);
    return { sent: true };
  }

  @Public()
  @Post('public/help/ticket')
  @HttpCode(200)
  @Throttle({ default: { ttl: 3_600_000, limit: 3 }, ip: { ttl: 3_600_000, limit: 3 } })
  async ticketPublic(@Req() req: Request, @Body() dto: HelpTicketDto): Promise<HelpTicketResponse> {
    await this.help.ticket({ kind: 'visitor', ip: req.ip ?? '' }, dto.email, dto.message, dto.history, dto.page);
    return { sent: true };
  }
}
