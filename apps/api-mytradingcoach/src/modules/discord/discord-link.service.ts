import { createHash, randomInt } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { isPremiumAccess } from './discord-access.util';
import { DiscordGuildClient } from './discord-guild.client';

/**
 * Liaison d'un compte Discord par code à usage unique (#741). Le code est généré dans l'app par un
 * utilisateur connecté, puis tapé dans Discord (`/verify code:`) : seule la personne connectée au
 * compte peut le relier. Avant, le bot reliait le compte dont on tapait l'e-mail, sans preuve.
 *
 * Alphabet de Crockford (32 signes, ni I, L, O ni U) : 8 signes = 2^40 codes. Avec au plus
 * `REDEEM_LIMIT_PER_HOUR` essais par identifiant Discord, la force brute est irréaliste.
 */
export const DISCORD_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const DISCORD_CODE_LENGTH = 8;
export const DISCORD_CODE_TTL_S = 10 * 60;
export const REDEEM_LIMIT_PER_MINUTE = 5;
export const REDEEM_LIMIT_PER_HOUR = 20;

export const DISCORD_UNLINK_FAILED_MESSAGE =
  "Ton Discord n'a pas pu être délié\u00a0: le retrait de ton rôle a échoué côté Discord. Ton compte reste relié, réessaie dans quelques minutes.";

export type DiscordRedeemResult =
  | { status: 'linked'; premium: boolean }
  | { status: 'invalid' }
  | { status: 'rate_limited' };

const codeKey = (hash: string) => `discord:link:code:${hash}`;
const userKey = (userId: string) => `discord:link:user:${userId}`;
const triesKey = (window: 'm' | 'h', discordId: string) => `discord:link:tries:${window}:${discordId}`;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

/** « abcd-efgh », « ABCD EFGH », O pour 0, I ou L pour 1 → forme canonique, ou null. */
export function normalizeDiscordCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (code.length !== DISCORD_CODE_LENGTH) return null;
  return [...code].every((c) => DISCORD_CODE_ALPHABET.includes(c)) ? code : null;
}

/** Affichage : « ABCD-EFGH ». */
export const formatDiscordCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

@Injectable()
export class DiscordLinkService {
  private readonly logger = new Logger(DiscordLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly guild: DiscordGuildClient,
  ) {}

  /** Un Discord est-il relié à ce compte ? L'identifiant lui-même ne quitte pas l'API. */
  async status(userId: string): Promise<{ linked: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { discordId: true } });
    return { linked: !!user?.discordId };
  }

  /**
   * Délie le Discord de ce compte : rôles Membre et Premium retirés sur le serveur, puis liaison
   * effacée. Si Discord refuse ou ne répond pas, la liaison reste en base (503) : effacée seule,
   * elle laisserait un rôle que plus rien ne retire (abonnement, suppression du compte).
   */
  async unlink(userId: string): Promise<{ linked: false }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { discordId: true } });
    if (!user?.discordId) return { linked: false };
    if (!(await this.guild.tryRemovePlanRoles(user.discordId))) {
      throw new ServiceUnavailableException(DISCORD_UNLINK_FAILED_MESSAGE);
    }
    // Conditionnée à l'identifiant lu : un autre Discord relié entre-temps n'est pas effacé.
    await this.prisma.user.updateMany({ where: { id: userId, discordId: user.discordId }, data: { discordId: null } });
    this.logger.log(`Discord délié | user: ${userId}`);
    return { linked: false };
  }

  /** Nouveau code pour ce compte ; le précédent, s'il existe, ne vaut plus rien. */
  async createCode(userId: string, now = Date.now()): Promise<{ code: string; expiresAt: string }> {
    const code = Array.from({ length: DISCORD_CODE_LENGTH }, () => DISCORD_CODE_ALPHABET[randomInt(32)]).join('');
    const hash = hashCode(code);
    const r = this.redis.client;
    const previous = await r.get(userKey(userId));
    if (previous) await r.del(codeKey(previous));
    await r.set(codeKey(hash), userId, 'EX', DISCORD_CODE_TTL_S);
    await r.set(userKey(userId), hash, 'EX', DISCORD_CODE_TTL_S);
    return { code: formatDiscordCode(code), expiresAt: new Date(now + DISCORD_CODE_TTL_S * 1000).toISOString() };
  }

  /**
   * Code tapé dans Discord par `discordId`. Code inconnu, expiré ou déjà utilisé : même réponse
   * `invalid`, rien ne permet de les distinguer. Chaque essai compte, réussi ou non.
   */
  async redeem(rawCode: string, discordId: string): Promise<DiscordRedeemResult> {
    if (await this.overLimit(discordId)) return { status: 'rate_limited' };
    const code = normalizeDiscordCode(rawCode);
    if (!code) return { status: 'invalid' };
    const hash = hashCode(code);
    // GETDEL : lu et consommé en une seule commande, deux essais simultanés ne peuvent pas tous
    // deux réussir.
    const userId = await this.redis.client.getdel(codeKey(hash));
    if (!userId) return { status: 'invalid' };
    await this.redis.client.del(userKey(userId));

    const linked = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { discordId: true, plan: true, role: true, trialEndsAt: true },
      });
      if (!user) return null;
      // Ce Discord était relié à un autre compte : il en est détaché (un Discord = un compte).
      await tx.user.updateMany({ where: { discordId, NOT: { id: userId } }, data: { discordId: null } });
      await tx.user.update({ where: { id: userId }, data: { discordId } });
      return user;
    });
    if (!linked) return { status: 'invalid' };

    // L'ancien Discord de ce compte perd ses rôles : il ne suit plus l'abonnement.
    if (linked.discordId && linked.discordId !== discordId) {
      await this.guild.removePlanRoles(linked.discordId);
    }
    const premium = isPremiumAccess(linked);
    await this.guild.setPlanRole(discordId, premium);
    this.logger.log(`Discord relié par code | user: ${userId}, premium: ${premium}`);
    return { status: 'linked', premium };
  }

  /**
   * Compte l'essai dans les deux fenêtres ; vrai si l'une dépasse sa limite. `SET NX EX` puis
   * `INCR` dans un même MULTI : le compteur naît toujours avec son expiration (un INCR suivi d'un
   * EXPIRE séparé pouvait laisser un compteur éternel si l'appel était coupé entre les deux).
   */
  private async overLimit(discordId: string): Promise<boolean> {
    const m = triesKey('m', discordId);
    const h = triesKey('h', discordId);
    const res = await this.redis.client
      .multi()
      .set(m, '0', 'EX', 60, 'NX')
      .incr(m)
      .set(h, '0', 'EX', 3600, 'NX')
      .incr(h)
      .exec();
    const perMinute = Number(res?.[1]?.[1] ?? 0);
    const perHour = Number(res?.[3]?.[1] ?? 0);
    return perMinute > REDEEM_LIMIT_PER_MINUTE || perHour > REDEEM_LIMIT_PER_HOUR;
  }
}
