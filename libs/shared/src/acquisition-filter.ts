/**
 * Filtre « inscrits d'une campagne » de l'admin (#625) : `GET /admin/users?source=&medium=&campaign=`.
 *
 * Chaque paramètre filtre à l'égalité exacte (les UTM sont stockés normalisés à l'inscription :
 * minuscules, sans espaces autour). Paramètre absent = pas de filtre sur ce champ ;
 * `UTM_NONE` = champ non renseigné (null en base). Une ligne de la page Acquisition mène ainsi
 * exactement à ses inscrits, y compris « instagram · bio · - » sans happer « instagram · bio · gratuit ».
 */

/** Valeur de requête pour « non renseigné » (aucun UTM normalisé ne vaut « - »). */
export const UTM_NONE = '-';

export interface AcquisitionUtm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}

/** Paramètres de requête d'un triplet complet : null → `UTM_NONE`. */
export function acquisitionQueryParams(utm: AcquisitionUtm): Record<keyof AcquisitionUtm, string> {
  return {
    source: utm.source ?? UTM_NONE,
    medium: utm.medium ?? UTM_NONE,
    campaign: utm.campaign ?? UTM_NONE,
  };
}

/** Libellé court « instagram · dm · louis » (champ vide → « - »). */
export function acquisitionLabel(utm: Partial<AcquisitionUtm>): string {
  return [utm.source, utm.medium, utm.campaign].map((v) => v ?? UTM_NONE).join(' · ');
}
