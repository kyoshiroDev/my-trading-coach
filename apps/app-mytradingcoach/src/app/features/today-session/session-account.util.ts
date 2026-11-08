/** Séance du jour vue par le choix du compte : seuls le statut et le compte comptent. */
export interface SessionAccountSession {
  status: 'ACTIVE' | 'CLOSED' | string;
  accountId?: string | null;
}

export interface SessionAccountState {
  /** Nombre de comptes actifs proposés dans la liste « Compte de la session ». */
  activeAccountCount: number;
  /** Compte choisi dans l'en-tête ; `undefined` = « Tous les comptes ». */
  selectedAccountParam: string | undefined;
  session: SessionAccountSession | null | undefined;
}

/** Une séance tourne déjà : son compte est fixé, il n'y a plus rien à choisir. */
export const sessionRunning = (session: SessionAccountSession | null | undefined): boolean =>
  session?.status === 'ACTIVE';

/**
 * « Choisis un compte pour lancer la session » : seulement si aucune séance ne tourne, que
 * l'utilisateur a des comptes et qu'aucun n'est choisi (« Tous les comptes »). Une séance active
 * garde son propre compte, quel que soit le choix de l'en-tête (#880).
 */
export function sessionAccountChoiceRequired(s: SessionAccountState): boolean {
  return !sessionRunning(s.session) && s.activeAccountCount > 0 && s.selectedAccountParam === undefined;
}

/** Valeur affichée par la liste : le compte de la séance active, sinon le choix de l'en-tête. */
export function sessionAccountValue(
  selectedAccountId: string,
  session: SessionAccountSession | null | undefined,
): string {
  return sessionRunning(session) && session?.accountId ? session.accountId : selectedAccountId;
}
