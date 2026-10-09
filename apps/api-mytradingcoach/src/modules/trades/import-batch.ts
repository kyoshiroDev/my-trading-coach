import type { Prisma } from '@prisma/client';
import type { SetupsService } from '../setups/setups.service';
import type { AccountsService } from '../accounts/accounts.service';

export const ACTIVE_SESSION_SELECT = { id: true, accountId: true, moodStart: true } as const;
type ActiveSession = Prisma.TradeSessionGetPayload<{ select: typeof ACTIVE_SESSION_SELECT }>;

/** Résolutions d'un import en lot, faites une fois et partagées par ses lignes (SCA-B1-02). */
export interface ImportBatch {
  activeSession: ActiveSession | null;
  ownedSetup(setupId: string): Promise<void>;
  account(accountId: string): Promise<string | undefined>;
  defaultAccount(): Promise<string>;
}

/**
 * Mémoïsé par promesse : un setup ou un compte invalide fait échouer chacune de ses lignes, comme
 * une vérification par ligne, sans refaire la requête.
 */
export async function createImportBatch(
  userId: string,
  deps: {
    activeSession: () => Promise<ActiveSession | null>;
    setups: Pick<SetupsService, 'assertOwnedActive'>;
    accounts: Pick<AccountsService, 'accountWhere' | 'ensureDefaultAccountId'>;
  },
): Promise<ImportBatch> {
  const setups = new Map<string, Promise<void>>();
  const accounts = new Map<string, Promise<string | undefined>>();
  let defaultAccount: Promise<string> | undefined;
  return {
    activeSession: await deps.activeSession(),
    ownedSetup: (setupId) => {
      let p = setups.get(setupId);
      if (!p) setups.set(setupId, (p = deps.setups.assertOwnedActive(userId, setupId)));
      return p;
    },
    account: (accountId) => {
      let p = accounts.get(accountId);
      if (!p) accounts.set(accountId, (p = deps.accounts.accountWhere(userId, accountId).then((r) => r.accountId)));
      return p;
    },
    defaultAccount: () => (defaultAccount ??= deps.accounts.ensureDefaultAccountId(userId)),
  };
}
