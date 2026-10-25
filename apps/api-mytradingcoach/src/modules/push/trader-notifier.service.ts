import { Injectable, Logger } from '@nestjs/common';
import type { PushAlertType } from '@prisma/client';
import { DEFAULT_MUTED_PUSH_TYPES, PUSH_PREMIUM_TYPES } from '@mtc/shared';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { isPremiumAccess } from '../discord/discord-access.util';
import { TraderPushService } from './trader-push.service';
import { inQuietHours } from './quiet-hours';
import { ACCOUNT_TOKEN, UNNAMED_ACCOUNT, accountPushName, withAccountName } from './push-account-name';
import type { TraderPushMessage } from './trader-push-messages';

/** La même alerte au plus une fois toutes les 15 min par compte (critère du ticket #666). */
export const PUSH_ANTI_SPAM_MS = 15 * 60 * 1000;

export interface TraderNotifyOptions {
  /** Compte concerné (anti-spam par compte) ; absent pour une alerte sans compte (récap). */
  accountId?: string;
  /** Identifie « la même alerte » pour l'anti-spam : `prop:drawdown:critical`, `tilt:revenge`… */
  dedupKey: string;
  /**
   * Part même si la même alerte est partie il y a moins de 15 min : franchissement d'une limite.
   * Ne contourne NI les types coupés NI les heures silencieuses.
   */
  force?: boolean;
}

export type TraderNotifyOutcome =
  | 'sent'
  | 'disabled'
  | 'unknown_user'
  | 'demo'
  | 'no_device'
  | 'plan'
  | 'muted'
  | 'quiet_hours'
  | 'anti_spam'
  /** Envoi tenté, aucun appareil ne l'a reçu (5xx, délai, abonnement mort, adresse refusée). */
  | 'undelivered';

/**
 * Point d'entrée unique des services métier pour prévenir un trader par push (#666).
 *
 * `notify` ne lève JAMAIS et n'attend pas l'envoi : un push raté ne doit jamais faire échouer une
 * synchro, une alerte dans l'app ou un récap. Tous les filtres sont appliqués ICI, côté API, dans
 * cet ordre : push actif, compte démo, appareil abonné, plan (types Premium), type coupé, heures
 * silencieuses (heure de Paris), anti-spam Redis partagé entre workers.
 */
@Injectable()
export class TraderNotifier {
  private readonly logger = new Logger(TraderNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly push: TraderPushService,
  ) {}

  notify(userId: string, type: PushAlertType, message: TraderPushMessage, options: TraderNotifyOptions): void {
    try {
      if (!this.push.enabled) return;
      void this.send(userId, type, message, options).catch((err: unknown) =>
        this.logger.warn(`Push ${type} non envoyé : ${err instanceof Error ? err.message : String(err)}`),
      );
    } catch (err) {
      this.logger.warn(`Push ${type} non envoyé : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Filtres puis envoi ; renvoie la raison de l'arrêt (tests, journaux de débogage). */
  async send(
    userId: string,
    type: PushAlertType,
    message: TraderPushMessage,
    options: TraderNotifyOptions,
    now = new Date(),
  ): Promise<TraderNotifyOutcome> {
    if (!this.push.enabled) return 'disabled';
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isDemo: true,
        plan: true,
        role: true,
        trialEndsAt: true,
        pushPreference: { select: { mutedTypes: true, quietStart: true, quietEnd: true } },
        _count: { select: { pushDevices: true } },
      },
    });
    if (!user) return 'unknown_user';
    if (user.isDemo) return 'demo';
    if (user._count.pushDevices === 0) return 'no_device';
    if (PUSH_PREMIUM_TYPES.includes(type) && !isPremiumAccess(user)) return 'plan';
    const pref = user.pushPreference;
    if ((pref?.mutedTypes ?? DEFAULT_MUTED_PUSH_TYPES).includes(type)) return 'muted';
    if (inQuietHours(now, pref?.quietStart, pref?.quietEnd)) return 'quiet_hours';
    // La clé est posée même quand on force : une alerte moins grave juste après reste filtrée.
    const fresh = await this.claim(userId, options);
    if (!fresh && !options.force) return 'anti_spam';

    const r = await this.push.deliverToUser(userId, await this.named(userId, message, options.accountId), type);
    this.logger.debug(`Push ${type} (${options.dedupKey}) : ${r.delivered}/${r.subscriptions} livré(s)`);
    // `sent` seulement si un appareil au moins l'a reçu : sinon l'appelant rend sa réservation et
    // retente. La clé anti-spam reste posée, les retentes non forcées attendent donc 15 min.
    return r.delivered > 0 ? 'sent' : 'undelivered';
  }

  /**
   * Nom du compte depuis le catalogue (firme et taille), jamais le libellé saisi par le trader :
   * l'écran verrouillé est visible par d'autres.
   */
  private async named(userId: string, message: TraderPushMessage, accountId: string | undefined): Promise<TraderPushMessage> {
    if (!`${message.title} ${message.body}`.includes(ACCOUNT_TOKEN)) return message;
    if (!accountId) return withAccountName(message, UNNAMED_ACCOUNT);
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, propFirmPlan: { select: { accountSize: true, firm: { select: { name: true } } } } },
    });
    return withAccountName(message, accountPushName(accounts, accountId));
  }

  /** `true` si cette alerte n'est pas partie depuis 15 min. Redis indisponible : on envoie. */
  private async claim(userId: string, options: TraderNotifyOptions): Promise<boolean> {
    const key = `push:spam:${userId}:${options.accountId ?? '-'}:${options.dedupKey}`;
    try {
      return (await this.redis.client.set(key, '1', 'PX', PUSH_ANTI_SPAM_MS, 'NX')) === 'OK';
    } catch {
      return true;
    }
  }
}
