import { AccountType, type Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/** Compte de démo Tradovate (simulateur perso, hors prop firm) : `DEMO` suivi de chiffres. */
export const TRADOVATE_DEMO_ACCOUNT_NAME = /^DEMO\d+$/i;

/**
 * Comptes d'entraînement de l'utilisateur, exclus du récap quotidien : type `DEMO`, ou relié à un
 * compte de démo Tradovate quel que soit le type saisi (Val avait créé son compte « DEMO » en
 * évaluation : ses trades de démo comptaient dans le P&L et le coaching du jour, 2026-10-09).
 */
export async function demoAccountIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const rows = await prisma.tradingAccount.findMany({
    where: {
      userId,
      OR: [
        { type: AccountType.DEMO },
        { brokerConnections: { some: { externalAccountName: { startsWith: 'DEMO', mode: 'insensitive' } } } },
      ],
    },
    select: { id: true, type: true, brokerConnections: { select: { externalAccountName: true } } },
  });
  return (rows ?? [])
    .filter((r) => r.type === AccountType.DEMO
      || (r.brokerConnections ?? []).some((c) => TRADOVATE_DEMO_ACCOUNT_NAME.test(c.externalAccountName ?? '')))
    .map((r) => r.id);
}

/** Filtre Prisma des trades hors comptes `ids` ; les trades sans compte restent. */
export function excludeAccountsWhere(ids: string[]): Prisma.TradeWhereInput {
  return ids.length ? { OR: [{ accountId: null }, { accountId: { notIn: ids } }] } : {};
}
