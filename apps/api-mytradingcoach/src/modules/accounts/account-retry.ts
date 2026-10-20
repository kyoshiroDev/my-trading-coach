import { AccountStatus, type Prisma, type TradingAccount } from '@prisma/client';

/**
 * Compte perdu : nouvelle tentative et détection du plancher atteint. Fonctions PURES (sans Nest ni
 * base), utilisées par `AccountsService` et testées seules.
 */

const SUFFIX = /\s*#(\d+)\s*$/;

/** « Apex 50K #3 » → « Apex 50K » ; sans suffixe, le libellé tel quel (espaces retirés). */
export function attemptBase(label: string): string {
  return label.replace(SUFFIX, '').trim();
}

/**
 * Libellé de la nouvelle tentative : base du libellé sans « #n », plus 1 par rapport au plus grand
 * numéro déjà pris par les comptes de l'utilisateur sur cette base. Un libellé sans numéro compte
 * comme #1 : « Apex 50K » → « Apex 50K #2 ». Comparaison sans casse ni espaces de bord.
 */
export function nextAttemptLabel(label: string, existingLabels: string[]): string {
  const base = attemptBase(label);
  const key = base.toLowerCase();
  let max = 1;
  for (const l of existingLabels) {
    if (attemptBase(l).toLowerCase() !== key) continue;
    const m = l.match(SUFFIX);
    max = Math.max(max, m ? Number(m[1]) : 1);
  }
  return `${base} #${max + 1}`;
}

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
 * Plancher estimé atteint : compte ACTIF relié à un plan du catalogue prop firm dont la marge
 * avant le plancher de drawdown est ≤ 0 (calcul existant de `computeRuleMetrics`). Signal pour le
 * front (bandeau « Plancher atteint ») ; aucun statut n'est changé : l'utilisateur confirme.
 */
export function isFloorReached(
  account: Pick<TradingAccount, 'status' | 'propFirmPlanId'>,
  drawdown: { margin: number } | null,
): boolean {
  return account.status === AccountStatus.ACTIVE && !!account.propFirmPlanId && !!drawdown && drawdown.margin <= 0;
}
