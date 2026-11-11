/**
 * Drawdown max en vue « Tous les comptes » (PROMPT-drawdown-max-par-compte) : l'API renvoie le pire
 * drawdown PARMI les comptes et l'id du compte concerné, jamais une série qui mélange les comptes.
 * Ces helpers purs donnent le libellé du compte et disent quand masquer les courbes de drawdown
 * (une courbe « tous comptes » serait un cumul mélangé présenté comme un drawdown).
 */

/** Compte tel que lu pour le libellé (id + nom affiché). */
export interface DrawdownScopeAccount {
  id: string;
  label: string;
}

/** Texte affiché à la place d'une courbe de drawdown en vue « Tous les comptes ». */
export const DRAWDOWN_PICK_ACCOUNT = 'Choisis un compte pour voir la courbe';

/**
 * « sur le compte X » / « sur les trades sans compte » pour le pire drawdown d'une vue
 * multi-comptes. null quand il n'y a rien à dire : aucune baisse, réponse en cache sans le champ
 * (`undefined`), ou compte introuvable dans la liste chargée.
 */
export function drawdownScopeLabel(
  accountId: string | null | undefined,
  maxDrawdown: number,
  accounts: readonly DrawdownScopeAccount[],
): string | null {
  if (accountId === undefined || maxDrawdown === 0) return null;
  if (accountId === null) return 'sur les trades sans compte';
  const account = accounts.find((a) => a.id === accountId);
  return account ? `sur le compte ${account.label}` : null;
}

/**
 * Vue « Tous les comptes » avec plusieurs séries dans les chiffres : drawdown du pire compte,
 * courbes de drawdown masquées. Plusieurs séries = plusieurs comptes, OU (#940) un compte plus des
 * trades sans compte, que seule l'API voit (`maxDrawdownAccountCount` de la courbe par trade).
 * Sans ce chiffre (ancien cache), on s'en tient aux comptes. Avec une seule série, la vue « tous »
 * est ce compte : rien ne change.
 */
export function isMultiAccountView(
  selectedAccountId: string,
  aggregateAccountCount: number,
  drawdownGroupCount?: number,
): boolean {
  return selectedAccountId === 'all' && (aggregateAccountCount > 1 || (drawdownGroupCount ?? 0) > 1);
}
