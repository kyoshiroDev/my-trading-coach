import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AdminPushTestResult, TraderPushDeviceState, TraderPushSettings } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DemoAllowed } from '../../common/decorators/demo-allowed.decorator';
import { TraderPushService } from './trader-push.service';
import { PushEndpointDto, SubscribePushDto } from './dto/push-subscription.dto';
import { TraderPushPreferencesDto } from './dto/trader-push-preferences.dto';

/**
 * Notifications push des traders (#666) : `/push/*`. L'appareil courant est identifié par son
 * endpoint, envoyé dans le corps (jamais dans l'URL : il contient un jeton). Compte démo : les
 * mutations sont bloquées par `DemoReadOnlyGuard`, la lecture des réglages reste possible.
 */
@Controller('push')
@UseGuards(JwtAuthGuard)
export class TraderPushController {
  constructor(private readonly push: TraderPushService) {}

  @Get('settings')
  settings(@CurrentUser() user: { id: string }): Promise<TraderPushSettings> {
    return this.push.settings(user.id);
  }

  /** Lecture (POST pour garder l'endpoint hors de l'URL) : permise en démo (revue #717, m6). */
  @Post('device')
  @HttpCode(200)
  @DemoAllowed()
  device(@CurrentUser() user: { id: string }, @Body() dto: PushEndpointDto): Promise<TraderPushDeviceState> {
    return this.push.device(user.id, dto.endpoint);
  }

  @Post('subscribe')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  subscribe(
    @CurrentUser() user: { id: string },
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<TraderPushDeviceState> {
    return this.push.subscribe(user.id, dto, userAgent ?? null);
  }

  @Post('unsubscribe')
  @HttpCode(200)
  unsubscribe(@CurrentUser() user: { id: string }, @Body() dto: PushEndpointDto): Promise<{ removed: boolean }> {
    return this.push.unsubscribe(user.id, dto.endpoint);
  }

  @Delete('devices/:id')
  removeDevice(@CurrentUser() user: { id: string }, @Param('id') id: string): Promise<{ removed: true }> {
    return this.push.removeDevice(user.id, id);
  }

  @Patch('preferences')
  preferences(@CurrentUser() user: { id: string }, @Body() dto: TraderPushPreferencesDto): Promise<TraderPushSettings> {
    return this.push.setPreferences(user.id, dto);
  }

  @Post('test')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  test(@CurrentUser() user: { id: string }): Promise<AdminPushTestResult> {
    return this.push.test(user.id);
  }
}
