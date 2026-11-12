/**
 * SEUL format d'affichage d'un pourcentage de réussite (win rate) et des pourcentages de l'app
 * (#947) : entier arrondi, « % » collé (« 63% »). Valeur inconnue (null, NaN, ±∞) → « — », jamais
 * « - » ni « NaN% » ; 0 → « 0% » (une séance à 0 gagnant n'est pas une valeur inconnue) ; jamais
 * « -0% ». Avant, le même 62,5 % s'affichait « 62.5% », « 63% » ou « 63 % » selon l'écran.
 * `decimals` : pour une variation (ex. « +0,4% » d'un capital), sinon 0.
 * `sign` : préfixe « + » devant une valeur positive (variations).
 */
export function formatPercent(
  value: number | null | undefined,
  opts: { decimals?: number; sign?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const decimals = opts.decimals ?? 0;
  const rounded = Number(value.toFixed(decimals));
  const shown = rounded === 0 ? 0 : rounded; // -0 → 0
  const prefix = opts.sign && shown > 0 ? '+' : '';
  return `${prefix}${shown.toFixed(decimals)}%`;
}
