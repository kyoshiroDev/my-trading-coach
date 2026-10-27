import { AccountStatus } from '@prisma/client';

interface AccountRow {
  id: string;
  status: AccountStatus;
  createdAt: Date;
}

/**
 * Compte qui reste actif en gratuit : celui choisi par l'utilisateur s'il est encore ACTIVE, sinon le
 * plus ancien compte ACTIVE. Null s'il n'y a aucun compte ACTIVE.
 */
export function resolveKeptAccountId(rows: AccountRow[], chosen: string | null): string | null {
  const active = rows.filter((r) => r.status === AccountStatus.ACTIVE);
  if (chosen && active.some((r) => r.id === chosen)) return chosen;
  const oldest = [...active].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return oldest?.id ?? null;
}

/**
 * Comptes ACTIVE au-delà du quota gratuit (un seul compte) : tous sauf le compte gardé. Vide pour un
 * accès Premium. Rien n'est supprimé ni masqué : le front les affiche avec le choix du compte gardé.
 */
export function overFreeLimitIds(rows: AccountRow[], chosen: string | null, premium: boolean): Set<string> {
  if (premium) return new Set();
  const kept = resolveKeptAccountId(rows, chosen);
  return new Set(rows.filter((r) => r.status === AccountStatus.ACTIVE && r.id !== kept).map((r) => r.id));
}
