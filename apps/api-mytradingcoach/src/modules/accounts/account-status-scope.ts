import { AccountStatus, Prisma } from '@prisma/client';

/**
 * Comptes « inactifs » : exclus PAR DÉFAUT de toute statistique ou agrégation « tous les comptes »
 * (compte perdu). `PASSED` (Validé) reste compté. Un compte précis choisi par l'utilisateur reste
 * lisible quel que soit son statut, et `includeInactive` réinclut tout.
 *
 * Source UNIQUE de la règle, en deux versions équivalentes (vérifiées par
 * `account-status-scope.int-spec.ts`) : `inactiveAccountsTradeWhere` (Prisma) et
 * `inactiveAccountsTradeSql` (SQL brut, alias de table `t`). Les trades sans compte restent comptés.
 */
export const INACTIVE_ACCOUNT_STATUSES: readonly AccountStatus[] = [AccountStatus.FAILED, AccountStatus.ARCHIVED];

/** Périmètre d'une lecture : compte précis, ou « tous les comptes » avec ou sans les inactifs. */
export interface AccountScope {
  accountId?: string;
  includeInactive?: boolean;
}

/** Vrai quand la lecture porte sur « tous les comptes » sans les inactifs (cas par défaut). */
export function excludesInactiveAccounts(scope: AccountScope): boolean {
  return !scope.accountId && !scope.includeInactive;
}

/**
 * Filtre Prisma des trades : hors comptes inactifs (sauf compte précis ou `includeInactive`).
 * ⚠️ Renvoie une clé `OR` : dans un `where` qui a déjà un `OR` (ex. `excludeAccountsWhere`),
 * combiner par `AND: [a, b]`, jamais par deux spreads (le second écraserait le premier).
 */
export function inactiveAccountsTradeWhere(scope: AccountScope = {}): Prisma.TradeWhereInput {
  if (!excludesInactiveAccounts(scope)) return {};
  return { OR: [{ accountId: null }, { account: { status: { notIn: [...INACTIVE_ACCOUNT_STATUSES] } } }] };
}

/** Même filtre en SQL, sur la table `"Trade"` aliasée `t`. `Prisma.empty` si rien à exclure. */
export function inactiveAccountsTradeSql(scope: AccountScope = {}): Prisma.Sql {
  if (!excludesInactiveAccounts(scope)) return Prisma.empty;
  return Prisma.sql`(t."accountId" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "TradingAccount" ia
    WHERE ia."id" = t."accountId" AND ia."status"::text IN (${Prisma.join(INACTIVE_ACCOUNT_STATUSES)})
  ))`;
}

/** Filtre Prisma des COMPTES (listes de comptes d'un contexte global : débrief, IA). */
export function activeAccountsWhere(scope: AccountScope = {}): Prisma.TradingAccountWhereInput {
  return excludesInactiveAccounts(scope) ? { status: { notIn: [...INACTIVE_ACCOUNT_STATUSES] } } : {};
}

/** Lit `includeInactive` d'une query string (`true` / `1`), absent ou autre → false. */
export function parseIncludeInactive(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}
