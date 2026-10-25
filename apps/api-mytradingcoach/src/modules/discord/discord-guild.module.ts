import { Module } from '@nestjs/common';
import { DiscordGuildClient } from './discord-guild.client';

/** Module feuille (aucun import) : partagé par `DiscordModule` et `UsersModule` sans cycle. */
@Module({
  providers: [DiscordGuildClient],
  exports: [DiscordGuildClient],
})
export class DiscordGuildModule {}
