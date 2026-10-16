import { Body, Controller, Get, Headers, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import type { AdminPushDevice, AdminPushPublicKey, AdminPushTestResult } from '@mtc/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminPushService } from './admin-push.service';
import { PushEndpointDto, PushPreferencesDto, SubscribePushDto } from './dto/admin-push.dto';

/**
 * Notifications push de l'admin : `/admin/push/*`, guard ADMIN au niveau de la classe.
 * L'appareil est identifié par son endpoint (envoyé dans le corps, jamais dans l'URL).
 */
@Controller('admin/push')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPushController {
  constructor(private readonly push: AdminPushService) {}

  @Get('public-key')
  publicKey(): AdminPushPublicKey {
    return this.push.publicKey();
  }

  @Post('subscribe')
  @HttpCode(200)
  subscribe(
    @CurrentUser() user: { id: string },
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AdminPushDevice> {
    return this.push.subscribe(user.id, dto, userAgent ?? null);
  }

  @Post('unsubscribe')
  @HttpCode(200)
  unsubscribe(@CurrentUser() user: { id: string }, @Body() dto: PushEndpointDto): Promise<{ removed: boolean }> {
    return this.push.unsubscribe(user.id, dto.endpoint);
  }

  @Post('device')
  @HttpCode(200)
  device(@CurrentUser() user: { id: string }, @Body() dto: PushEndpointDto): Promise<AdminPushDevice> {
    return this.push.device(user.id, dto.endpoint);
  }

  @Patch('preferences')
  preferences(@CurrentUser() user: { id: string }, @Body() dto: PushPreferencesDto): Promise<AdminPushDevice> {
    return this.push.setPreferences(user.id, dto.endpoint, dto.mutedEvents);
  }

  @Post('test')
  @HttpCode(200)
  test(): Promise<AdminPushTestResult> {
    return this.push.test();
  }
}
