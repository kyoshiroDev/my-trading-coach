/**
 * Paires forex en saisie manuelle (#951). Code PUR : importable par Angular et NestJS.
 *
 * Seules les paires COTÉES EN DOLLARS (xxx/USD) ont un P&L calculé depuis les prix : 1 lot standard
 * = 100 000 unités, 1 pip (0,0001) = 10 $ par lot, P&L directement en $. Les autres paires (USD/JPY,
 * EUR/GBP…) donneraient un P&L dans la devise de cotation : aucun taux de change n'existe dans
 * l'app (PROMPT-214), donc jamais de calcul « points × quantité » pour elles.
 */

/** Devises des grandes paires forex. Ajouter une devise = ce tableau. */
const FOREX_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD',
  'SEK', 'NOK', 'DKK', 'PLN', 'HUF', 'CZK', 'TRY', 'ZAR', 'MXN', 'SGD', 'HKD', 'CNH',
]);

/** Unités d'un lot standard. */
export const FOREX_LOT_UNITS = 100_000;
/** Taille d'un pip des paires cotées en dollars. */
export const FOREX_USD_PIP_SIZE = 0.0001;
/** Valeur d'un pip pour 1 lot standard d'une paire cotée en dollars (0,0001 × 100 000). */
export const FOREX_USD_PIP_VALUE = 10;

/** `'eur/usd'`, `'EURUSD'`, `' EUR-USD '` → `{ base: 'EUR', quote: 'USD' }` ; sinon `null`. */
export function forexPair(symbol: string | null | undefined): { base: string; quote: string } | null {
  const m = /^([A-Z]{3})[/\-_ ]?([A-Z]{3})$/.exec((symbol ?? '').trim().toUpperCase());
  if (!m || m[1] === m[2] || !FOREX_CURRENCIES.has(m[1]) || !FOREX_CURRENCIES.has(m[2])) return null;
  return { base: m[1], quote: m[2] };
}

/** Paire forex dont le P&L ne se calcule pas en $ depuis les prix (cotation hors dollar). */
export function isNonUsdQuotedForex(symbol: string | null | undefined): boolean {
  const p = forexPair(symbol);
  return p !== null && p.quote !== 'USD';
}
