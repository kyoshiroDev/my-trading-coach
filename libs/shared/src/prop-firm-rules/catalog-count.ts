/**
 * Nombre de prop firms du catalogue, pour les écrans qui l'affichent sans pouvoir embarquer le
 * catalogue lui-même (1,8 Mo de JSON : la page d'inscription de l'app est dans le bundle initial).
 * Tenu égal à `PROP_FIRM_CATALOG_FILES.length` par `catalog-count.spec.ts` : ajouter une firm au
 * catalogue sans mettre ce nombre à jour fait échouer la CI.
 */
export const PROP_FIRM_COUNT = 16;
