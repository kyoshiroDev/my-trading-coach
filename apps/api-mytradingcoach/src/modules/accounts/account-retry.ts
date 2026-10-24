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
  dismissal: FloorDismissal | null = null,
): boolean {
  if (account.status !== AccountStatus.ACTIVE || !drawdown || drawdown.margin > 0) return false;
  // Déjà écarté par « Ce n'est pas un échec » : ne revient que sur une perte plus profonde.
  return !dismissal || drawdown.margin < dismissal.margin - FLOOR_DISMISS_TOLERANCE;
}

/**
 * « Ce n'est pas un échec » sur un plancher atteint (B1) : marge estimée au moment du retrait et
 * séance (journée CME), gardées dans le JSON `data` de l'incident retiré. Pas de nouvelle table.
 */
export interface FloorDismissal {
  margin: number;
  day: string;
}

/** Écart de marge (devise du compte) en deçà duquel ce n'est pas une nouvelle perte : arrondis. */
export const FLOOR_DISMISS_TOLERANCE = 1;

/** Retrait mémorisé dans `data`, ou null (incident sans retrait mémorisé, JSON inattendu). */
export function readFloorDismissal(data: unknown): FloorDismissal | null {
  if (!data || typeof data !== 'object') return null;
  const { dismissedMargin, dismissedDay } = data as Record<string, unknown>;
  return typeof dismissedMargin === 'number' && typeof dismissedDay === 'string'
    ? { margin: dismissedMargin, day: dismissedDay }
    : null;
}

/** Le retrait ne vaut plus : marge repassée au-dessus de zéro, ou séance suivante. */
export function floorDismissalExpired(dismissal: FloorDismissal, margin: number | null, today: string): boolean {
  return dismissal.day !== today || margin == null || margin > 0;
}

/** `data` de l'incident sans le retrait mémorisé (le reste du relevé est gardé). */
export function withoutFloorDismissal(data: unknown): Prisma.InputJsonObject {
  const { dismissedMargin: _m, dismissedDay: _d, ...rest } = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return rest as Prisma.InputJsonObject;
}
