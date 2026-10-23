import { AdminPushEvent, BrokerConnectionStatus } from '@prisma/client';
import type { AdminNotifier } from '../../admin-push/admin-notifier.service';
import { ADMIN_PUSH_MESSAGES } from '../../admin-push/push-messages';
import type { TraderNotifier } from '../../push/trader-notifier.service';
import { TRADER_PUSH_MESSAGES } from '../../push/trader-push-messages';

/**
 * Connexion Tradovate passée « à reconnecter » : push à l'admin et au trader (#666, gratuit), au
 * PASSAGE seulement (pas à chaque essai d'une connexion déjà condamnée), jamais pour la démo.
 * Sorti de `TradovateConnectionService` (revue #717, m8).
 */

/** État d'avant à lire, AVANT d'écrire le nouveau statut. */
export const RECONNECT_NOTICE_SELECT = {
  status: true,
  userId: true,
  accountId: true,
  account: { select: { label: true } },
  user: { select: { isDemo: true } },
} as const;

export interface ReconnectNoticeBefore {
  status: BrokerConnectionStatus;
  userId: string;
  accountId: string;
  account: { label: string };
  user: { isDemo: boolean } | null;
}

export function noticeReconnectRequired(
  before: ReconnectNoticeBefore | null,
  notifiers: { admin?: AdminNotifier; trader?: TraderNotifier },
): void {
  if (!before?.user || before.user.isDemo || before.status === BrokerConnectionStatus.NEEDS_RECONNECT) return;
  notifiers.admin?.notify(AdminPushEvent.TRADOVATE_RECONNECT, ADMIN_PUSH_MESSAGES.tradovateReconnect());
  notifiers.trader?.notify(
    before.userId,
    'CONNECTION',
    TRADER_PUSH_MESSAGES.tradovateReconnect(before.accountId, before.account.label),
    { accountId: before.accountId, dedupKey: 'connection:tradovate' },
  );
}
