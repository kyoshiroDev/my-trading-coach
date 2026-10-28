import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { overFreeLimitIds } from '../../accounts/kept-account';
import { isPremiumAccess } from '../../discord/discord-access.util';
import { errorKind } from '../../push/push-delivery';
import { tradingDay } from '../../accounts/account-rules';

/** D'où vient la synchro observée (journal seulement). */
export type FreeLimitSyncSource = 'synchro' | 'historique';

/** Comptes observés gardés 8 jours : une semaine de décompte complète, plus une marge. */
const DAY_SET_TTL_S = 8 * 86_400;
const daySetKey = (day: string) => `free-limit-sync:${day}`;

/**
 * Délai maximal de l'évaluation. Le client Redis n'a pas de `commandTimeout` : une commande sans
 * réponse (connexion à moitié ouverte) bloquerait sinon la synchro qui attend `observe`.
 */
export const OBSERVE_TIMEOUT_MS = 1_000;

class FreeLimitTimeoutError extends Error {
  override name = 'TimeoutError';
}

/** `work`, ou un rejet `TimeoutError` après `OBSERVE_TIMEOUT_MS` ; un rejet tardif de `work` est ignoré. */
function bounded<T>(work: Promise<T>): Promise<T> {
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FreeLimitTimeoutError()), OBSERVE_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Synchro des comptes au-delà de la limite gratuite (#769, B0), MODE JOURNAL SEUL : rien n'est
 * bloqué. Chaque synchro d'un compte qu'un compte gratuit ne garde pas (tous ses comptes ACTIVE
 * sauf le compte gardé) est comptée une fois par jour dans un ensemble Redis, et journalisée sans
 * identifiant. Le décompte (`countToday`) dit combien de comptes réels l'arrêt toucherait avant
 * de l'activer. Démo et accès Premium (abonnement, essai, Premium offert, rôle) jamais concernés.
 */
@Injectable()
export class FreeLimitSyncService {
  private readonly logger = new Logger(FreeLimitSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Compte au-delà de la limite gratuite ? Vrai = la synchro serait ignorée une fois l'arrêt activé.
   * Ne lève jamais et rend la main en `OBSERVE_TIMEOUT_MS` au plus : une erreur ou une lenteur
   * (base, Redis indisponible ou muet) ne doit ni empêcher ni retarder la synchro (journal seulement).
   */
  async observe(userId: string, accountId: string, source: FreeLimitSyncSource, now = new Date()): Promise<boolean> {
    try {
      return await bounded(this.evaluate(userId, accountId, source, now));
    } catch (err) {
      this.logger.warn(`Limite gratuite de la synchro non évaluée (${errorKind(err)})`);
      return false;
    }
  }

  private async evaluate(userId: string, accountId: string, source: FreeLimitSyncSource, now: Date): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true, role: true, trialEndsAt: true, isDemo: true, keptAccountId: true,
        tradingAccounts: { select: { id: true, status: true, createdAt: true } },
      },
    });
    if (!user || user.isDemo || isPremiumAccess(user)) return false;
    if (!overFreeLimitIds(user.tradingAccounts, user.keptAccountId, false).has(accountId)) return false;

    const key = daySetKey(tradingDay(now));
    const added = await this.redis.client.sadd(key, accountId);
    if (added) {
      await this.redis.client.expire(key, DAY_SET_TTL_S);
      this.logger.log(`Synchro d'un compte au-delà de la limite gratuite (journal seul, ${source}) : serait ignorée`);
    }
    return true;
  }

  /** Comptes distincts observés aujourd'hui au-delà de la limite gratuite (0 si Redis indisponible ou muet). */
  async countToday(now = new Date()): Promise<number> {
    return bounded(this.redis.client.scard(daySetKey(tradingDay(now)))).catch(() => 0);
  }
}
