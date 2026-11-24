import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '@api/prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { tradingDay } from '../accounts/account-rules';
import { parisDate, parisWallTimeToUtc } from '../eco-calendar/eco-calendar.schedule';
import { openPositionsKey, parseOpenPositions } from '../integrations/tradovate/tradovate-open-positions';
import { TraderNotifier } from '../push/trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from '../push/trader-push-messages';
import type { BehaviorAlertDraft } from './behavior-detectors';
import {
  NEWS_SHIELD_MAX_MINUTES, type NewsEvent, newsLabel, newsShieldDraft, newsShieldEnabled, newsShieldMinutes,
} from './behavior-news';

/** Événement `news:alert` poussé à l'app (canal `/tradovate-live`), affiché en toast en séance. */
export interface NewsAlertEvent extends BehaviorAlertDraft {
  id: string;
  accountId: string;
}
export type NewsAlertEmit = (event: 'news:alert', payload: NewsAlertEvent) => void;

/** Annonces relues au plus une fois par minute et par worker. */
const EVENTS_CACHE_MS = 60_000;
/** Une alerte par compte et par annonce, entrée et tick confondus, tous workers (lease repris). */
const NEWS_SPAM_TTL_S = 6 * 3600;
export const newsSpamKey = (accountId: string, slotKey: string) => `behavior:news:${accountId}:${slotKey}`;

/**
 * Bouclier annonces (#670, décision du 2026-11-23) : alerte factuelle quand une position est ouverte,
 * ou s'ouvre, moins de X minutes avant une annonce à fort impact des devises de l'actif. Affichée tout
 * de suite (toast en séance, push app fermée), sans attendre #671 ; enregistrée dans `BehaviorAlert`.
 * Coupée par `NEWS_SHIELD_ENABLED` (éteint par défaut). Best-effort : un échec ne remonte jamais.
 */
@Injectable()
export class NewsShieldService {
  private readonly logger = new Logger(NewsShieldService.name);
  private cache: { at: number; events: NewsEvent[] } | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() private readonly notifier?: TraderNotifier,
  ) {}

  get enabled(): boolean {
    return newsShieldEnabled();
  }

  /** Annonces fortes dans les 30 prochaines minutes (plafond de X), lues au plus une fois par minute. */
  async upcoming(now: Date): Promise<NewsEvent[]> {
    if (!this.cache || now.getTime() - this.cache.at >= EVENTS_CACHE_MS) {
      const days = [parisDate(now), parisDate(new Date(now.getTime() + 86_400_000))];
      const rows = await this.prisma.ecoEvent.findMany({
        where: { date: { in: days }, impact: 'high' },
        select: { date: true, time: true, name: true, nameFr: true, currency: true },
      });
      const events = rows
        .map((r) => ({ at: parisWallTimeToUtc(r.date, r.time), label: newsLabel(r), currency: r.currency }))
        .filter((e): e is NewsEvent => e.at !== null);
      this.cache = { at: now.getTime(), events };
    }
    const horizon = now.getTime() + NEWS_SHIELD_MAX_MINUTES * 60_000;
    return this.cache.events.filter((e) => e.at.getTime() > now.getTime() && e.at.getTime() <= horizon);
  }

  /**
   * Alerte retenue : anti-spam atomique (une par compte et par annonce), enregistrée, émise, poussée.
   * Renvoie vrai si l'alerte est partie.
   */
  async record(
    userId: string,
    accountId: string,
    draft: BehaviorAlertDraft,
    entry: { asset: string; side: string; quantity: number },
    sessionId: string | null,
    emit: NewsAlertEmit,
    now: Date,
  ): Promise<boolean> {
    const slotKey = String(draft.context['slotKey']);
    const ok = await this.redis.client.set(newsSpamKey(accountId, slotKey), '1', 'EX', NEWS_SPAM_TTL_S, 'NX');
    if (ok !== 'OK') return false;
    const day = tradingDay(now);
    const row = await this.prisma.behaviorAlert.create({
      data: {
        userId, accountId, tradeDay: new Date(`${day}T00:00:00.000Z`), sessionId,
        type: draft.type, severity: draft.severity, message: draft.message,
        context: { ...draft.context, entry } as Prisma.InputJsonValue,
      },
      select: { id: true },
    }).catch(async (err: unknown) => {
      await this.redis.client.del(newsSpamKey(accountId, slotKey)).catch(() => undefined);
      throw err;
    });
    emit('news:alert', { ...draft, id: row.id, accountId });
    this.notifier?.notify(userId, 'BEHAVIOR', TRADER_PUSH_MESSAGES.news(accountId, draft), {
      accountId, dedupKey: `news:${slotKey}`,
    });
    return true;
  }

  /**
   * Passage « avant l'annonce » (minuteur du gateway, worker titulaire du WebSocket) : positions déjà
   * ouvertes sur les connexions tenues par ce worker. Un tick en cours fait sauter le suivant.
   */
  async tick(
    now: Date,
    owned: { userId: string; connectionId: string; accountId: string }[],
    emitFor: (userId: string) => NewsAlertEmit,
  ): Promise<number> {
    if (!this.enabled || this.ticking || owned.length === 0) return 0;
    this.ticking = true;
    try {
      const events = await this.upcoming(now);
      if (events.length === 0) return 0;
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...new Set(owned.map((o) => o.userId))] }, isDemo: false },
        select: { id: true, newsShieldMinutes: true },
      });
      const minutesOf = new Map(users.map((u) => [u.id, newsShieldMinutes(u.newsShieldMinutes)]));
      let sent = 0;
      for (const o of owned) {
        const minutes = minutesOf.get(o.userId);
        if (!minutes) continue; // compte démo, utilisateur inconnu ou bouclier coupé (0)
        const state = parseOpenPositions(await this.redis.client.get(openPositionsKey(o.connectionId)));
        for (const p of state?.positions ?? []) {
          const draft = newsShieldDraft(now, p.asset, events, minutes);
          if (!draft) continue;
          const entry = { asset: p.asset, side: p.side, quantity: p.quantity };
          if (await this.record(o.userId, o.accountId, draft, entry, null, emitFor(o.userId), now)) sent++;
        }
      }
      return sent;
    } catch (err: unknown) {
      this.logger.warn(`Bouclier annonces non évalué : ${err instanceof Error ? err.name : 'Error'}`);
      return 0;
    } finally {
      this.ticking = false;
    }
  }
}
