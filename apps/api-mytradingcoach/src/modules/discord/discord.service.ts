import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPremiumAccess } from './discord-access.util';
import { DiscordGuildClient } from './discord-guild.client';

@Injectable()
export class DiscordService {
  private readonly logger = new Logger(DiscordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: DiscordGuildClient,
  ) {}

  async syncDiscordRole(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true, plan: true, role: true, trialEndsAt: true },
    });

    if (!user?.discordId) return;

    const isPremium = isPremiumAccess(user);
    await this.guild.setPlanRole(user.discordId, isPremium);

    this.logger.log(
      `Discord role sync | user: ${userId}, premium: ${isPremium}`,
    );
  }
}
