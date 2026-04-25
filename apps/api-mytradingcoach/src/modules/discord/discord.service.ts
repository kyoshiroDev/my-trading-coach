import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncDiscordRole(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true, plan: true, role: true, trialEndsAt: true },
    });

    if (!user?.discordId) return;

    const isPremium =
      user.plan === 'PREMIUM' ||
      user.role === 'BETA_TESTER' ||
      user.role === 'ADMIN' ||
      (user.trialEndsAt !== null && new Date() < new Date(user.trialEndsAt));

    const guildId = process.env['DISCORD_GUILD_ID'];
    const botToken = process.env['DISCORD_BOT_TOKEN'];
    const roleToAdd = isPremium
      ? process.env['DISCORD_ROLE_PREMIUM_ID']
      : process.env['DISCORD_ROLE_MEMBRE_ID'];
    const roleToRemove = isPremium
      ? process.env['DISCORD_ROLE_MEMBRE_ID']
      : process.env['DISCORD_ROLE_PREMIUM_ID'];

    if (!guildId || !botToken || !roleToAdd || !roleToRemove) {
      this.logger.warn('Discord env vars manquantes — sync ignoré');
      return;
    }

    const headers = { Authorization: `Bot ${botToken}` };
    const base = `https://discord.com/api/v10/guilds/${guildId}/members/${user.discordId}/roles`;

    await fetch(`${base}/${roleToRemove}`, { method: 'DELETE', headers }).catch(() => undefined);
    await fetch(`${base}/${roleToAdd}`, { method: 'PUT', headers }).catch((err) => {
      this.logger.error(`Discord role sync échoué — user: ${userId}`, err);
    });

    this.logger.log(`Discord role sync — user: ${userId}, premium: ${isPremium}`);
  }
}
