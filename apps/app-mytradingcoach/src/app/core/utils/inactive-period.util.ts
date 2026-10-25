import { isInactiveStatus } from './account-status.util';

/**
 * Période par défaut d'un compte échoué ou archivé : ses trades sont souvent plus vieux que la
 * fenêtre « 1 mois », et la courbe s'ouvrait vide. Quand l'utilisateur choisit un tel compte, la
 * période passe sur « Tout » ; quand il revient sur un compte actif (ou « Tous les comptes »), la
 * période d'avant revient. S'il change lui-même la période, son choix est respecté (plus rien
 * d'automatique jusqu'au prochain compte échoué ou archivé). Les comptes actifs ne changent pas.
 */
export interface AutoPeriodState<P> {
  /** Période posée automatiquement pour ce compte, et celle qu'elle a remplacée. */
  auto: { accountId: string; previous: P } | null;
}

export const NO_AUTO_PERIOD = { auto: null } as const;

/**
 * Nouvelle période après un changement de compte sélectionné (`selected` null = « Tous les
 * comptes »). Renvoie `period: null` quand il n'y a rien à changer.
 */
export function periodOnSelection<P>(
  state: AutoPeriodState<P>,
  selected: { id: string; status: string } | null,
  current: P,
  all: P,
): { period: P | null; state: AutoPeriodState<P> } {
  if (selected && isInactiveStatus(selected.status)) {
    if (state.auto?.accountId === selected.id) return { period: null, state };
    const previous = state.auto ? state.auto.previous : current;
    return { period: current === all ? null : all, state: { auto: { accountId: selected.id, previous } } };
  }
  if (state.auto) return { period: state.auto.previous, state: { auto: null } };
  return { period: null, state };
}

/** Choix explicite de l'utilisateur : il prime, plus de retour automatique à l'ancienne période. */
export function periodChosenByUser<P>(): AutoPeriodState<P> {
  return { auto: null };
}
