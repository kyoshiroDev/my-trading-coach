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
