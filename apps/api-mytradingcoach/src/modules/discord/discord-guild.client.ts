import { Injectable, Logger } from '@nestjs/common';
import { fetchWithTimeout } from '../../common/utils/fetch-timeout';

/**
 * Rôles Membre / Premium d'un membre du serveur Discord, par l'API REST du bot. Sans dépendance :
 * `UsersModule` l'importe pour retirer le rôle à la suppression du compte (`DiscordModule`
 * importe déjà `UsersModule`, l'inverse ferait un cycle).
 *
 * `setPlanRole` LÈVE sur une réponse en erreur (hors 404) ou une panne réseau (N2 #1046) : avant,
 * tout était avalé, la fin d'essai comptait « rôle Discord en échec : 0 » et le rôle Premium
 * restait. Les appelants qui ne doivent pas être bloqués (liaison, webhooks Stripe) attrapent.
 * `removePlanRoles` ne lève jamais (suppression de compte) mais renvoie `false` en cas d'échec.
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

  /**
   * Retire les deux rôles (Discord détaché d'un compte, compte supprimé). Ne lève jamais ; `false`
   * si un retrait a échoué (l'appelant peut le signaler pour un retrait à la main).
   */
  async removePlanRoles(discordId: string): Promise<boolean> {
    const env = this.env();
    if (!env) return true;
    let ok = true;
    for (const roleId of [env.membre, env.premium]) {
      await this.call(env, discordId, roleId, 'DELETE').catch(() => {
        ok = false;
      });
    }
    return ok;
  }

  /**
   * Retrait des deux rôles quand l'utilisateur délie son Discord : contrairement à
   * `removePlanRoles`, renvoie `false` au moindre échec (réseau, délai, réponse HTTP en erreur,
   * configuration absente) pour que l'appelant garde la liaison. 404 compte comme réussi : le
   * membre a quitté le serveur, il n'a plus aucun rôle. Journal : nom de l'erreur ou statut HTTP
   * seulement, jamais l'identifiant Discord ni l'URL.
   */
  async tryRemovePlanRoles(discordId: string): Promise<boolean> {
    const env = this.env();
    if (!env) return false;
    for (const roleId of [env.membre, env.premium]) {
      const url = `https://discord.com/api/v10/guilds/${env.guildId}/members/${discordId}/roles/${roleId}`;
      try {
        const res = await fetchWithTimeout(url, { method: 'DELETE', headers: { Authorization: `Bot ${env.botToken}` } });
        if (!res.ok && res.status !== 404) {
          this.logger.error(`Discord DELETE rôle refusé : HTTP ${res.status}`);
          return false;
        }
      } catch (err: unknown) {
        this.logger.error(`Discord DELETE rôle échoué : ${err instanceof Error ? err.name : 'inconnue'}`);
        return false;
      }
    }
    return true;
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
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method, headers: { Authorization: `Bot ${env.botToken}` } });
    } catch (err: unknown) {
      // Nom de l'erreur seulement : jamais l'URL (identifiant Discord).
      const name = err instanceof Error ? err.name : 'inconnue';
      this.logger.error(`Discord ${method} rôle échoué : ${name}`);
      throw new Error(`Discord ${method} rôle échoué : ${name}`);
    }
    // 404 : le membre a quitté le serveur, il n'a plus aucun rôle.
    if (!res.ok && res.status !== 404) {
      this.logger.error(`Discord ${method} rôle refusé : HTTP ${res.status}`);
      throw new Error(`Discord ${method} rôle refusé : HTTP ${res.status}`);
    }
  }
}
