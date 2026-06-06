/**
 * Parse une saisie décimale en nombre, en acceptant la virgule comme séparateur
 * (habitude FR). Retourne `undefined` si vide ou non numérique.
 * À utiliser avant tout envoi API pour normaliser virgule → point.
 */
export function parseDecimal(v: string | null | undefined): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().replace(',', '.');
  if (!s) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}