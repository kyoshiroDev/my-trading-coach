import { commonCurrency } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Devise des montants AGRÉGÉS d'un utilisateur (emails, PDF, prompts IA) : la devise commune de ses
 * comptes non archivés, `null` s'ils ont des devises différentes (montant affiché sans symbole,
 * jamais un symbole deviné), USD s'il n'a aucun compte. Aucune conversion.
 */
export async function userAmountsCurrency(prisma: PrismaService, userId: string): Promise<string | null> {
  const accounts = await prisma.tradingAccount.findMany({
    where: { userId, status: { not: 'ARCHIVED' } },
    select: { currency: true },
  });
  return commonCurrency(accounts.map((a) => a.currency));
}
