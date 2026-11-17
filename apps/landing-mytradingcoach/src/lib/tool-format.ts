/**
 * Saisie et affichage des calculateurs (/outils) : pur, partagé par les scripts des pages.
 * Accepte la virgule ou le point décimal et les espaces de milliers (« 50 000,50 »).
 */

/** '' → null (champ vide) ; texte non numérique → NaN (refusé par les calculs, jamais deviné). */
export function parseAmount(raw: string | null | undefined): number | null {
  const s = (raw ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (s === '') return null;
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : Number.NaN;
}

const NNBSP = ' ';

/** 1234.5 → « 1 234,5 $ » (deux décimales au plus, espace fine insécable). */
export function formatAmount(n: number, currency = '$'): string {
  const v = n.toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[\s  ]/g, NNBSP);
  return `${v}${NNBSP}${currency}`;
}

/** 33.3 → « 33,3 % ». */
export function formatPercent(n: number): string {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NNBSP}%`;
}

/** 1.5 → « 1,5 » (ratio). */
export function formatRatio(n: number): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}
