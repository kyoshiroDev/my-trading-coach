/**
 * Écart entre un résultat publié et sa prévision, calculé en code (pur). C'est un fait comparatif,
 * pas une direction de marché : « au-dessus de la prévision » ne dit rien du sens d'un actif.
 */
import type { EcoReleaseGap } from '@mtc/shared';

function decimals(v: number): number {
  const s = String(v);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/**
 * above / inline / below à la précision de la prévision (2,9 contre 2,94 = en ligne) ;
 * no_consensus sans prévision publiée ; null sans résultat.
 */
export function releaseGap(actual: number | null, estimate: number | null): EcoReleaseGap | null {
  if (actual === null || actual === undefined) return null;
  if (estimate === null || estimate === undefined) return 'no_consensus';
  const d = decimals(estimate);
  const rounded = Number(actual.toFixed(d));
  if (rounded === estimate) return 'inline';
  return rounded > estimate ? 'above' : 'below';
}

/** Libellé neutre de l'écart, pour le modèle et l'affichage. */
export const GAP_LABEL: Record<EcoReleaseGap, string> = {
  above: 'au-dessus de la prévision',
  inline: 'en ligne avec la prévision',
  below: 'en dessous de la prévision',
  no_consensus: 'pas de consensus publié',
};

/**
 * Point d'attention factuel du matin, calculé en code : la prochaine annonce forte (heure, libellé,
 * devise). Remplace la « recommandation » rédigée par le modèle.
 */
export function morningFocus(
  events: { time: string; name: string; currency: string; impact: string; status?: string; isReleased: boolean }[],
): string {
  const next = events
    .filter((e) => e.impact === 'high' && (e.status ? e.status === 'upcoming' : !e.isReleased))
    .sort((a, b) => a.time.localeCompare(b.time));
  if (!next.length) return '';
  const slot = next.filter((e) => e.time === next[0].time);
  const names = slot.map((e) => `${e.name} (${e.currency})`).join(', ');
  return `Prochaine annonce à fort impact : ${slot[0].time}, ${names}. Volatilité possible autour de cet horaire.`;
}
