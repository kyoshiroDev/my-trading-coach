import type { BrokerConnection, BrokerConnectionStatus } from '@prisma/client';
import type { OAuthOrigin } from './oauth-state.util';
import type { ExternalAccountRef } from './tradovate.types';

/** Vue publique d'une connexion : JAMAIS de token, même chiffré. */
export interface TradovateConnectionView {
  accountId: string;
  status: BrokerConnectionStatus;
  externalAccountId: string | null;
  externalAccountName: string | null;
  externalEnv: string | null;
  availableAccounts: ExternalAccountRef[];
  /** true si plusieurs comptes Tradovate et aucun choisi : la synchro attend un choix. */
  needsAccountSelection: boolean;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  tradesImported: number;
  /**
   * Trades de ce compte importés par le broker ET encore présents (BROKER_SYNC / BROKER_HISTORY).
   * Distinct de `tradesImported` (cumul jamais décrémenté) : c'est le nombre exact que
   * supprimerait une déconnexion « avec suppression des trades importés ».
   */
  brokerTradesCount: number;
  connectedAt: Date;
}

/**
 * Issue du callback. Lue par le front dans l'URL de retour (`?tradovate=…&reason=…`), et
 * par le controller qui enchaîne la première synchro quand un compte est déjà choisi.
 * `origin` décide de la page de retour : l'utilisateur revient là d'où il est parti.
 */
export type CallbackOutcome =
  | { status: 'connected' | 'select_account'; accountId: string; userId: string; origin: OAuthOrigin }
  | { status: 'error'; reason: string; accountId?: string; origin: OAuthOrigin };

/** Résumé de la première synchro, ajouté à l'URL de retour (jamais bloquant). */
export interface FirstSyncSummary {
  /** Trades créés ; null = la synchro a échoué (la connexion, elle, est faite). */
  created: number | null;
  /** 'ok' rapprochés · 'partial' incomplets · 'none' indisponibles (P&L brut). */
  fees?: 'ok' | 'partial' | 'none';
}

/** Comptes Tradovate du login, tels que mémorisés sur la connexion. */
export function availableAccountsOf(conn: BrokerConnection): ExternalAccountRef[] {
  return Array.isArray(conn.availableAccounts)
    ? (conn.availableAccounts as unknown as ExternalAccountRef[])
    : [];
}

export function toConnectionView(conn: BrokerConnection, brokerTradesCount = 0): TradovateConnectionView {
  const availableAccounts = availableAccountsOf(conn);
  return {
    accountId: conn.accountId,
    status: conn.status,
    externalAccountId: conn.externalAccountId,
    externalAccountName: conn.externalAccountName,
    externalEnv: conn.externalEnv,
    availableAccounts,
    // ≥ 1 et non > 1 : au consentement, un compte unique est choisi d'office (jamais ici) ; mais
    // un compte disparu détache la connexion, et le suivant doit être choisi explicitement même
    // s'il est seul — on ne verse pas les trades d'un autre compte broker sans le demander.
    needsAccountSelection: !conn.externalAccountId && availableAccounts.length >= 1,
    lastSyncAt: conn.lastSyncAt,
    lastSyncError: conn.lastSyncError,
    tradesImported: conn.tradesImported,
    brokerTradesCount,
    connectedAt: conn.createdAt,
  };
}

/**
 * URL de retour dans l'app. Wizard → `/dashboard` (l'overlay d'onboarding s'y rouvre et
 * reprend à l'écran final, `from=wizard`) ; réglages → `/accounts`. Le front nettoie ces
 * paramètres une fois lus.
 */
export function frontendRedirectUrl(base: string, outcome: CallbackOutcome, sync?: FirstSyncSummary): string {
  const params = new URLSearchParams({ tradovate: outcome.status });
  if (outcome.accountId) params.set('accountId', outcome.accountId);
  if (outcome.status === 'error') params.set('reason', outcome.reason);
  if (sync) {
    if (sync.created === null) params.set('sync', 'error');
    else params.set('trades', String(sync.created));
    if (sync.fees) params.set('fees', sync.fees);
  }
  if (outcome.origin === 'wizard') {
    params.set('from', 'wizard');
    return `${base}/dashboard?${params.toString()}`;
  }
  return `${base}/accounts?${params.toString()}`;
}
