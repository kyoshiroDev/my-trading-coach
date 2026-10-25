import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DiscordController } from './discord.controller';
import { DiscordGuildModule } from './discord-guild.module';
import { DiscordLinkService } from './discord-link.service';
import { DiscordService } from './discord.service';

@Module({
  imports: [PrismaModule, DiscordGuildModule],
  controllers: [DiscordController],
  providers: [DiscordService, DiscordLinkService],
  exports: [DiscordService],
})
export class DiscordModule {}
