import type { AccountStatus } from '@mtc/shared';

/**
 * Compte perdu : règle d'affichage des statuts, miroir front de `account-status-scope.ts` (API).
 * Les comptes ÉCHOUÉS et ARCHIVÉS sortent des chiffres « tous les comptes » ; « Validé » reste
 * compté. `includeInactive` (interrupteur des statistiques) les réintègre. Un compte choisi dans le
 * sélecteur s'affiche toujours, quel que soit son statut : cette règle ne vaut que pour l'agrégé.
 */
export function countsInAggregate(status: AccountStatus | string, includeInactive = false): boolean {
  return includeInactive || (status !== 'FAILED' && status !== 'ARCHIVED');
}

/** Compte hors statistiques par défaut (échoué ou archivé). */
export function isInactiveStatus(status: AccountStatus | string): boolean {
  return status === 'FAILED' || status === 'ARCHIVED';
}

export function statusLabel(status: AccountStatus | string): string {
  switch (status) {
    case 'PASSED': return 'Validé';
    case 'FAILED': return 'Échoué';
    case 'ARCHIVED': return 'Archivé';
    default: return 'Actif';
  }
}

/** Classe du badge d'état (`status-badge is-…`), le texte du badge porte toujours le statut. */
export function statusBadgeClass(status: AccountStatus | string): string {
  switch (status) {
    case 'PASSED': return 'is-passed';
    case 'FAILED': return 'is-failed';
    case 'ARCHIVED': return 'is-archived';
    default: return 'is-active';
  }
}

export interface ExcludedAccounts {
  failed: number;
  archived: number;
}

/**
 * Ligne des statistiques : « 2 comptes exclus des chiffres : 1 échoué, 1 archivé. ». `null` quand
 * aucun compte n'est exclu (la ligne disparaît).
 */
export function excludedAccountsLine({ failed, archived }: ExcludedAccounts): string | null {
  const total = failed + archived;
  if (total === 0) return null;
  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} échoué${failed > 1 ? 's' : ''}`);
  if (archived > 0) parts.push(`${archived} archivé${archived > 1 ? 's' : ''}`);
  const head = total > 1 ? `${total} comptes exclus des chiffres` : '1 compte exclu des chiffres';
  return `${head} : ${parts.join(', ')}.`;
}
