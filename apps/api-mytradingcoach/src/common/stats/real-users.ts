import { Prisma, Role } from '@prisma/client';

/**
 * Comptes réels des statistiques admin (#828, #823) : hors démo, hors comptes internes (tests de
 * l'équipe) et hors ADMIN. Une seule définition pour tous les agrégats, Prisma (`REAL_USERS_WHERE`)
 * et SQL brut (`realUsersSql`). Jamais pour cibler des envois : les comptes de test doivent recevoir
 * les e-mails (`email-campaign.service.ts` garde son propre filtre).
 */
export const REAL_USERS_WHERE = {
  isDemo: false,
  isInternal: false,
  role: { not: Role.ADMIN },
} as const satisfies Prisma.UserWhereInput;

/**
 * Même filtre en SQL brut, à interpoler dans un `$queryRaw`. `alias` = alias de la table `User`
 * dans la requête (valeur fixe du code, jamais une saisie).
 */
export function realUsersSql(alias?: 'u'): Prisma.Sql {
  const p = alias ? `${alias}.` : '';
  return Prisma.raw(`${p}"isDemo" = false AND ${p}"isInternal" = false AND ${p}"role" <> 'ADMIN'`);
}
