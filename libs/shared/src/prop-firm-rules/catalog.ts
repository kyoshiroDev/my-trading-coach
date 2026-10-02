/**
 * Fichiers du catalogue des règles prop firm, tels quels (un par firm, cf. README.md).
 *
 * Typés `unknown` à dessein : le JSON est validé par `pnpm prop-firms:validate` (ajv, en CI)
 * et revalidé par Zod côté API avant d'aller en base. Le typer ici en le castant donnerait une
 * fausse garantie, et `@mtc/shared` n'embarque aucune lib de validation.
 *
 * Ajouter une firm = ajouter son fichier ici, puis redéployer l'API (synchro au démarrage).
 */
import apex from './apex.json';
import lucid from './lucid.json';

export const PROP_FIRM_CATALOG_FILES: readonly unknown[] = [lucid, apex];
