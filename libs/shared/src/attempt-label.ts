/**
 * Compte perdu : libellé de la nouvelle tentative (« Apex 50K #2 »). Partagé par l'API, qui crée
 * le compte et reste seule autorité, et par l'app, qui l'affiche avant la création.
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
export function nextAttemptLabel(label: string, existingLabels: readonly string[]): string {
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

/** Numéro de tentative du libellé : « Apex 50K #3 » → 3 ; sans suffixe, 1. */
export function attemptNumber(label: string): number {
  const m = label.match(SUFFIX);
  return m ? Number(m[1]) : 1;
}

/**
 * Tentative plus récente du même compte (même base, numéro plus grand), la plus récente s'il y en a
 * plusieurs ; null sinon. « Nouvelle tentative » n'a alors plus lieu d'être : l'API la refuse (409
 * `RETRY_EXISTS`) et l'app propose « Voir Apex 50K #2 » à la place.
 */
export function newerAttempt<T extends { label: string }>(label: string, accounts: readonly T[]): T | null {
  const key = attemptBase(label).toLowerCase();
  let best: T | null = null;
  let bestN = attemptNumber(label);
  for (const a of accounts) {
    if (attemptBase(a.label).toLowerCase() !== key) continue;
    const n = attemptNumber(a.label);
    if (n > bestN) {
      best = a;
      bestN = n;
    }
  }
  return best;
}
