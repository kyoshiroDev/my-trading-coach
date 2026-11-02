import { AccountStatus, Prisma } from '@prisma/client';

/**
 * Pause de la synchro des comptes perdus (#684). Règle unique, partagée par le cron de fond, le
 * temps réel, la veille et la vue « Mes comptes ».
 *
 * Un compte marqué Échoué ou Archivé n'est plus synchronisé en arrière-plan, à trois conditions :
 * - le statut date de plus de 48 h : le trade qui a fait échouer le compte (autopsie) a le temps
 *   d'arriver, et une erreur de marquage peut être corrigée sans rien perdre ;
 * - l'historique complet a déjà été importé (`historyImportedAt`) : sans lui, le cron doit garder
 *   le droit de le remonter avant que Tradovate n'archive le compte ;
 * - PASSED n'est jamais en pause (compte validé, parfois réutilisé par la firme).
 *
 * Ce que la pause NE change PAS : le statut de la connexion, le renouvellement des jetons, le bouton
 * « Synchroniser » et les trades déjà importés. Repasser le compte en Actif la lève aussitôt.
 */

export const SYNC_PAUSE_GRACE_MS = 48 * 60 * 60 * 1000;
export const SYNC_PAUSE_STATUSES: readonly AccountStatus[] = [AccountStatus.FAILED, AccountStatus.ARCHIVED];

export type SyncPauseReason = 'FAILED' | 'ARCHIVED';

export interface SyncPauseAccount {
  status: AccountStatus;
  /** `null` : statut antérieur à la colonne, considéré comme ancien (délai écoulé). */
  statusChangedAt: Date | null;
}

/** Raison de la pause, ou `null` si la synchro de fond doit tourner. */
export function syncPauseReason(
  account: SyncPauseAccount | null | undefined,
  historyImportedAt: Date | null,
  now: Date = new Date(),
): SyncPauseReason | null {
  if (!account || !SYNC_PAUSE_STATUSES.includes(account.status) || !historyImportedAt) return null;
  if (account.statusChangedAt && now.getTime() - account.statusChangedAt.getTime() < SYNC_PAUSE_GRACE_MS) return null;
  return account.status as SyncPauseReason;
}

/** Même règle en filtre Prisma : à combiner (AND) au `where` des connexions à synchroniser. */
export function notSyncPausedWhere(now: Date = new Date()): Prisma.BrokerConnectionWhereInput {
  return {
    NOT: {
      historyImportedAt: { not: null },
      account: {
        status: { in: [...SYNC_PAUSE_STATUSES] },
        OR: [{ statusChangedAt: null }, { statusChangedAt: { lte: new Date(now.getTime() - SYNC_PAUSE_GRACE_MS) } }],
      },
    },
  };
}
