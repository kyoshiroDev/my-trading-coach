import { AccountStatus, type Prisma, type TradingAccount } from '@prisma/client';

/**
 * Compte perdu : nouvelle tentative et détection du plancher atteint. Fonctions PURES (sans Nest ni
 * base), utilisées par `AccountsService` et testées seules.
 */

// Libellé de la nouvelle tentative : partagé avec l'app, qui l'affiche avant la création.
export { attemptBase, nextAttemptLabel } from '@mtc/shared';

/**
 * Données du compte de la nouvelle tentative : même firme, même plan, même taille et mêmes règles.
 * Jamais copiés : trades, connexion broker (autre identifiant chez la firm), date du dernier payout
 * (nouveau cycle), statut (ACTIVE par défaut).
 */
export function retryAccountData(
  account: TradingAccount,
  label: string,
): Prisma.TradingAccountUncheckedCreateInput {
  return {
    userId: account.userId,
    label,
    broker: account.broker,
    type: account.type,
    accountSize: account.accountSize,
    currency: account.currency,
    startingBalance: account.startingBalance,
    profitTarget: account.profitTarget,
    maxDrawdown: account.maxDrawdown,
    drawdownType: account.drawdownType,
    platform: account.platform,
    propFirmPlanId: account.propFirmPlanId,
    planLinkChoice: account.planLinkChoice,
    unlistedFirm: account.unlistedFirm,
  };
}

/**
 * Plancher estimé atteint : compte ACTIF qui a des règles de perte maximale (plan du catalogue
 * prop firm OU drawdown saisi à la main : `computeRuleMetrics` calcule la même marge dans les deux
 * cas) et dont la marge avant le plancher est ≤ 0. Signal pour le front (bandeau « Plancher
 * atteint ») ; aucun statut n'est changé : l'utilisateur confirme.
 */
export function isFloorReached(
  account: Pick<TradingAccount, 'status'>,
  drawdown: { margin: number } | null,
): boolean {
  return account.status === AccountStatus.ACTIVE && !!drawdown && drawdown.margin <= 0;
}
