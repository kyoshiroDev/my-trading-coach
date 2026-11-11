/**
 * Briefing avant les annonces fortes du jour (fonctions pures, aucun appel IA).
 *
 * Une ligne factuelle par annonce : heure, libellé, prévision, précédent, et les actifs du trader
 * libellés dans la devise de l'annonce. Aucune direction, aucun conseil : on dit quand et quoi,
 * jamais dans quel sens. Calculé en code, identique pour une même signature d'actifs.
 */
import type { EcoBriefingLine, EcoEvent } from '@mtc/shared';

const MAJORS = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY'];

/** Racines de contrats et d'indices → devises dont les annonces les concernent. */
const ROOTS: Record<string, string[]> = {
  // Indices US, énergie, métaux, taux US, crypto CME : cotés en dollars
  NQ: ['USD'], MNQ: ['USD'], ES: ['USD'], MES: ['USD'], YM: ['USD'], MYM: ['USD'],
  RTY: ['USD'], M2K: ['USD'], CL: ['USD'], MCL: ['USD'], GC: ['USD'], MGC: ['USD'],
  SI: ['USD'], SIL: ['USD'], ZB: ['USD'], ZN: ['USD'], ZF: ['USD'], MBT: ['USD'], MET: ['USD'],
  US30: ['USD'], US100: ['USD'], NAS100: ['USD'], US500: ['USD'], SPX500: ['USD'], SPX: ['USD'],
  BTC: ['USD'], ETH: ['USD'], SOL: ['USD'], XRP: ['USD'],
  // Futures de devises CME : la devise contre le dollar
  '6E': ['EUR', 'USD'], M6E: ['EUR', 'USD'], '6B': ['GBP', 'USD'], '6J': ['JPY', 'USD'],
  '6A': ['AUD', 'USD'], '6C': ['CAD', 'USD'], '6S': ['CHF', 'USD'], '6N': ['NZD', 'USD'],
  // Indices hors US
  FDAX: ['EUR'], DAX: ['EUR'], GER40: ['EUR'], DE40: ['EUR'], FESX: ['EUR'], EU50: ['EUR'], CAC40: ['EUR'], FRA40: ['EUR'],
  UK100: ['GBP'], FTSE: ['GBP'], JP225: ['JPY'], NKD: ['JPY', 'USD'], NIKKEI: ['JPY'],
};

/**
 * Devises dont les annonces concernent un actif : paire de devises (EUR/USD, XAUUSD), racine de
 * contrat avec ou sans échéance (NQZ6, MNQ 12-26), indice, crypto. Inconnu → aucune.
 */
export function assetCurrencies(asset: string): string[] {
  const raw = asset.trim().toUpperCase();
  const compact = raw.replace(/[\s/_.:-]/g, '').replace(/USDT$|USDC$/, 'USD');

  // Racine connue, échéance retirée (« NQZ6 », « MNQZ2026 », « MNQ 12-26 »)
  const root = raw.split(/[\s:]/)[0].replace(/([FGHJKMNQUVXZ]\d{1,4}|\d{2}-\d{2})$/, '');
  if (ROOTS[root]) return ROOTS[root];
  if (ROOTS[compact]) return ROOTS[compact];

  // Paire de 6 lettres (EURUSD, XAUUSD) : les majeures qu'elle contient
  if (/^[A-Z]{6}$/.test(compact)) {
    const found = [compact.slice(0, 3), compact.slice(3)].filter((c) => MAJORS.includes(c));
    if (found.length) return found;
  }
  return [];
}

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
