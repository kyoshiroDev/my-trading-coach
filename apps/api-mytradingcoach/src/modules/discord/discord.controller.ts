import { Controller, Get, Headers, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { DiscordService } from './discord.service';

@Controller('discord')
export class DiscordController {
  constructor(
    private readonly usersService: UsersService,
    private readonly discordService: DiscordService,
  ) {}

  @Public()
  @Get('verify')
  async verify(
    @Query('email') email: string,
    @Query('discordId') discordId: string,
    @Headers('x-discord-secret') secret: string,
  ) {
    if (!secret || secret !== process.env['DISCORD_BOT_SECRET']) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return {
        verified: false,
        message: `Aucun compte trouvé avec cet email. Inscris-toi sur ${process.env['FRONTEND_URL'] ?? 'https://app.mytradingcoach.app'}/register`,
      };
    }

    await this.usersService.updateDiscordId(user.id, discordId);
    await this.discordService.syncDiscordRole(user.id);

    const isPremium =
      user.plan === 'PREMIUM' ||
      user.role === 'ADMIN' ||
      user.role === 'BETA_TESTER' ||
      (user.trialEndsAt !== null && new Date() < new Date(user.trialEndsAt));

    return {
      verified: true,
      plan: isPremium ? 'PREMIUM' : 'FREE',
      role: user.role,
      name: user.name ?? user.email.split('@')[0],
    };
  }
}
