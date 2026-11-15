import { Prisma } from '@prisma/client';
import { TEST_ACQUISITION_PATTERNS, testPatternToLike } from '@mtc/shared';
import { realUsersSql } from './real-users';

/** Motifs de test (`@mtc/shared`) traduits en `LIKE`, jokers échappés : un seul endroit. */
const TEST_LIKES = TEST_ACQUISITION_PATTERNS.map(testPatternToLike);

/** Colonnes source / medium / campagne d'une table (noms fixes du code, jamais une saisie). */
interface UtmColumns {
  source: string;
  medium: string;
  campaign: string;
}

/**
 * Vrai si la ligne n'est PAS une campagne / source de test (#1029) : aucun des 3 champs ne
 * correspond à `TEST_ACQUISITION_PATTERNS` (exact ou préfixe, sans casse, jamais « contient »).
 * Le `\` d'échappement de `testPatternToLike` est celui de `LIKE` par défaut en Postgres.
 */
export function notTestAcquisitionSql(cols: UtmColumns): Prisma.Sql {
  const likes = Prisma.sql`ARRAY[${Prisma.join(TEST_LIKES)}]::text[]`;
  const one = (col: string) => Prisma.sql`LOWER(COALESCE(${Prisma.raw(col)}, '')) LIKE ANY (${likes})`;
  return Prisma.sql`NOT (${one(cols.source)} OR ${one(cols.medium)} OR ${one(cols.campaign)})`;
}

/**
 * Comptes de la page Acquisition. Par défaut : comptes réels (`realUsersSql` : hors démo, interne,
 * ADMIN) ET hors campagne de test. `includeTests` (« Inclure les tests ») : chiffres bruts, internes
 * et ADMIN compris ; la démo reste TOUJOURS exclue (pas une inscription, et le re-seed peut lui
 * redonner un `createdAt` récent). Propre à Acquisition : les autres pages gardent `realUsersSql`.
 */
export function acquisitionUsersSql(includeTests: boolean, alias?: 'u'): Prisma.Sql {
  const p = alias ? `${alias}.` : '';
  if (includeTests) return Prisma.raw(`${p}"isDemo" = false`);
  return Prisma.sql`${realUsersSql(alias)} AND ${notTestAcquisitionSql({
    source: `${p}"acquisitionSource"`,
    medium: `${p}"acquisitionMedium"`,
    campaign: `${p}"acquisitionCampaign"`,
  })}`;
}

/**
 * Compteurs anonymes (`LandingVisitDaily`, `FunnelEventDaily`) : hors campagnes de test par défaut,
 * tout avec `includeTests`. `alias` = alias de la table dans la requête (valeur fixe du code).
 */
export function anonymousAcquisitionSql(includeTests: boolean, alias?: 'v'): Prisma.Sql {
  if (includeTests) return Prisma.sql`TRUE`;
  const p = alias ? `${alias}.` : '';
  return notTestAcquisitionSql({ source: `${p}"source"`, medium: `${p}"medium"`, campaign: `${p}"campaign"` });
}
