import { EcoResultAnalysis } from '../../../../../../core/api/eco-calendar.api';
import type { EcoEvent } from '@mtc/shared';

// Calendrier éco d'exemple pour la session live démo (affiché si rien de réel
// dans la fenêtre de session). Released → bloc d'analyse IA figé (DEMO_ECO_ANALYSIS).
export const DEMO_LIVE_ECO_EVENTS: EcoEvent[] = [
  { time: '09:00', name: 'PMI manufacturier',  currency: 'EUR', country: 'EU', impact: 'medium', actual: 49.2, estimate: 49.0, previous: 48.8, isReleased: true,  unit: null },
  { time: '14:30', name: 'Inflation CPI (US)', currency: 'USD', country: 'US', impact: 'high',   actual: 3.1,  estimate: 3.2,  previous: 3.4,  isReleased: true,  unit: '%' },
  { time: '16:00', name: 'Discours BCE',        currency: 'EUR', country: 'EU', impact: 'high',   actual: null, estimate: null, previous: null, isReleased: false, unit: null },
];

// Analyse IA figée par événement (keyée sur le name brut). Zéro appel modèle.
export const DEMO_ECO_ANALYSIS: Record<string, EcoResultAnalysis> = {
  'PMI manufacturier': {
    interpretation: "PMI au-dessus des attentes (49.2 vs 49.0) : léger soutien pour l'EUR, sentiment risk-on modéré.",
    assetSentiments: [{ asset: 'EUR/USD', sentiment: 'bull', shortReason: 'PMI meilleur que prévu' }],
  },
  'Inflation CPI (US)': {
    interpretation: "CPI US sous les attentes (3.1% vs 3.2%), désinflation confirmée : pression baissière sur le dollar, soutien des indices US.",
    assetSentiments: [
      { asset: 'MNQ', sentiment: 'bull', shortReason: 'CPI plus bas → indices en hausse' },
      { asset: 'EUR/USD', sentiment: 'bull', shortReason: 'Dollar plus faible' },
    ],
  },
  'Balance courante': {
    interpretation: "Balance courante japonaise au-dessus des attentes : léger soutien du yen, impact indirect sur tes actifs (indices US, EUR/USD).",
    assetSentiments: [{ asset: 'EUR/USD', sentiment: 'neutral', shortReason: 'Impact indirect via le yen' }],
  },
};

// Devise d'un événement éco → instruments les plus impactés (fidélité maquette).
// USD (marché domestique de nos traders) → indices US ; devises étrangères → paire vs USD.
const BASE_CCY = new Set(['EUR', 'GBP', 'AUD', 'NZD']); // cotées XXX/USD
export function currencyToInstruments(currency: string | null | undefined): string {
  const c = (currency ?? '').toUpperCase();
  if (!c) return '';
  if (c === 'USD') return 'NQ/ES';
  if (BASE_CCY.has(c)) return `${c}/USD`;
  return `USD/${c}`;
}

/** Drapeau par pays, puis par devise (repli 🌐). */
export const ECO_FLAGS: Record<string, string> = {
  US: '🇺🇸', EU: '🇪🇺', GB: '🇬🇧', JP: '🇯🇵',
  CA: '🇨🇦', AU: '🇦🇺', NZ: '🇳🇿', CH: '🇨🇭',
  CN: '🇨🇳', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭',
  CNY: '🇨🇳', CNH: '🇨🇳', SEK: '🇸🇪', NOK: '🇳🇴',
  DKK: '🇩🇰', HKD: '🇭🇰', SGD: '🇸🇬', MXN: '🇲🇽',
};
