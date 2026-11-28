/**
 * Briefing avant les annonces fortes du jour (fonctions pures, aucun appel IA).
 *
 * Une ligne factuelle par annonce : heure, libellé, prévision, précédent, et les actifs du trader
 * libellés dans la devise de l'annonce. Aucune direction, aucun conseil : on dit quand et quoi,
 * jamais dans quel sens. Calculé en code, identique pour une même signature d'actifs.
 */
import { assetCurrencies, type EcoBriefingLine, type EcoEvent } from '@mtc/shared';

/** Déplacée dans `@mtc/shared` (#667) : réexportée pour les appels existants. */
export { assetCurrencies } from '@mtc/shared';

function fmt(v: number | null, unit: string | null | undefined): string | null {
  return v === null ? null : `${v.toLocaleString('fr-FR')}${unit ?? ''}`;
}

/** Ligne de briefing d'une annonce forte, pour les actifs donnés. */
export function briefingLine(event: EcoEvent, userAssets: string[]): EcoBriefingLine {
  const assets = userAssets.filter((a) => assetCurrencies(a).includes(event.currency));
  const parts = [`${event.time} · ${event.name} (${event.currency})`];
  if (event.hasResult === false) {
    parts.push('intervention, pas de chiffre attendu');
  } else {
    const est = fmt(event.estimate, event.unit);
    const prev = fmt(event.previous, event.unit);
    parts.push(est ? `prévision ${est}` : 'pas de consensus publié');
    if (prev) parts.push(`précédent ${prev}`);
  }
  parts.push(assets.length ? `concerne ${assets.join(', ')}` : 'aucun de tes actifs récents dans cette devise');
  return {
    time: event.time,
    name: event.name,
    currency: event.currency,
    estimate: event.estimate,
    previous: event.previous,
    unit: event.unit ?? null,
    assets,
    status: event.status ?? (event.isReleased ? 'released' : 'upcoming'),
    text: `${parts.join(' · ')}.`,
  };
}

/** Briefing du jour : les annonces fortes, par heure. */
export function buildBriefing(events: EcoEvent[], userAssets: string[]): EcoBriefingLine[] {
  return events
    .filter((e) => e.impact === 'high')
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((e) => briefingLine(e, userAssets));
}
