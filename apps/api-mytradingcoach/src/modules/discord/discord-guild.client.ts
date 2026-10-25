import { Injectable, Logger } from '@nestjs/common';
import { fetchWithTimeout } from '../../common/utils/fetch-timeout';

/**
 * Rôles Membre / Premium d'un membre du serveur Discord, par l'API REST du bot. Sans dépendance :
 * `UsersModule` l'importe pour retirer le rôle à la suppression du compte (`DiscordModule`
 * importe déjà `UsersModule`, l'inverse ferait un cycle). Ne lève jamais : un échec Discord ne
 * doit bloquer ni une liaison, ni une suppression de compte.
 */
@Injectable()
export class DiscordGuildClient {
  private readonly logger = new Logger(DiscordGuildClient.name);

  /** Donne le rôle du plan et retire l'autre. */
  async setPlanRole(discordId: string, premium: boolean): Promise<void> {
    const env = this.env();
    if (!env) return;
    const [add, remove] = premium ? [env.premium, env.membre] : [env.membre, env.premium];
    await this.call(env, discordId, remove, 'DELETE');
    await this.call(env, discordId, add, 'PUT');
  }

  /** Retire les deux rôles (Discord détaché d'un compte, compte supprimé). */
  async removePlanRoles(discordId: string): Promise<void> {
    const env = this.env();
    if (!env) return;
    await this.call(env, discordId, env.membre, 'DELETE');
    await this.call(env, discordId, env.premium, 'DELETE');
  }

  private env() {
    const guildId = process.env['DISCORD_GUILD_ID'];
    const botToken = process.env['DISCORD_BOT_TOKEN'];
    const premium = process.env['DISCORD_ROLE_PREMIUM_ID'];
    const membre = process.env['DISCORD_ROLE_MEMBRE_ID'];
    if (!guildId || !botToken || !premium || !membre) {
      this.logger.warn('Discord env vars manquantes : rôles non modifiés');
      return null;
    }
    return { guildId, botToken, premium, membre };
  }

  private async call(
    env: { guildId: string; botToken: string },
    discordId: string,
    roleId: string,
    method: 'PUT' | 'DELETE',
  ): Promise<void> {
    const url = `https://discord.com/api/v10/guilds/${env.guildId}/members/${discordId}/roles/${roleId}`;
    await fetchWithTimeout(url, { method, headers: { Authorization: `Bot ${env.botToken}` } }).catch(
      (err: unknown) => {
        this.logger.error(`Discord ${method} rôle échoué : ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  }
}
