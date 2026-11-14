/**
 * E-mails insensibles à la casse (#999, S7 de l'audit #994).
 *
 * - À l'écriture : une adresse est toujours enregistrée sans espaces autour et en minuscules
 *   ({@link normalizeEmail}, appliquée par {@link emailTransform} dans les DTO). « Alice@x.com » et
 *   « alice@x.com » ne peuvent plus ouvrir deux comptes.
 * - À la lecture : les comptes d'avant ce correctif peuvent garder des majuscules en base (2 en prod
 *   le 14/11, aucun doublon). La recherche compare donc sans la casse ({@link emailEquals}).
 *
 * Prisma traduit `equals` + `mode: 'insensitive'` en `ILIKE` SANS échapper `_` ni `%` : « a_b@x.com »
 * retrouvait le compte « axb@x.com ». {@link emailEquals} échappe ces jokers : égalité exacte, casse à part.
 */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `@Transform` des DTO : adresse normalisée avant `@IsEmail`. Tout autre type passe tel quel. */
export const emailTransform = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? normalizeEmail(value) : value;

/** Échappe les jokers de LIKE / ILIKE (`\`, `_`, `%`) : caractère d'échappement par défaut de Postgres. */
export function escapeLike(value: string): string {
  return value.replace(/[\\_%]/g, (c) => `\\${c}`);
}

/** Filtre Prisma : même adresse que `email`, casse et espaces autour ignorés, sans joker. */
export function emailEquals(email: string): { equals: string; mode: 'insensitive' } {
  return { equals: escapeLike(normalizeEmail(email)), mode: 'insensitive' };
}
