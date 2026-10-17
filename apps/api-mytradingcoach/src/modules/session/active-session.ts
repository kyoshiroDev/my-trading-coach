import { Prisma, SessionStatus } from '@prisma/client';
import { tradingDay } from '../accounts/account-rules';

/**
 * Session « active » = statut ACTIVE ET ouverte pendant la journée de trading CME en cours
 * (17:00 heure de Chicago → 17:00 le lendemain, cf. `tradingDay`) — fonctions PURES.
 *
 * Sans borne de date, une session jamais clôturée restait active des jours durant : chrono à
 * `265:58:47`, P&L du jour rapporté à une session de 11 jours (#595). Une session d'une journée
 * précédente n'est plus jamais renvoyée comme active ; `SessionCloseCron` la clôture le soir même.
 */

/** Début (instant UTC) de la journée de trading CME qui contient `at`. */
export function tradingDayStart(at: Date): Date {
  const day = tradingDay(at);
  const [y, m, d] = day.split('-').map(Number);
  // 17:00 à Chicago la veille : UTC-5 (heure d'été) ou UTC-6 (hiver). Le bon est celui où la
  // journée bascule : `day` à cet instant, la précédente une milliseconde avant.
  for (const offset of [5, 6]) {
    const start = new Date(Date.UTC(y, m - 1, d - 1, 17 + offset));
    if (tradingDay(start) === day && tradingDay(new Date(start.getTime() - 1)) !== day) return start;
  }
  throw new Error(`Début de la journée de trading introuvable pour ${day}`);
}

/** Début de la journée de trading qui précède celle de `at`. */
export function previousTradingDayStart(at: Date): Date {
  return tradingDayStart(new Date(tradingDayStart(at).getTime() - 1));
}

/** Filtre Prisma de LA session active d'un utilisateur, à utiliser partout à la place de `status: ACTIVE`. */
export function activeSessionWhere(userId: string, now = new Date()): Prisma.TradeSessionWhereInput {
  return { userId, status: SessionStatus.ACTIVE, startedAt: { gte: tradingDayStart(now) } };
}
