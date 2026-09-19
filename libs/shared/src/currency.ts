/**
 * Devise d'un compte de trading : SOURCE UNIQUE front + back (PROMPT-214).
 *
 * La devise est une propriété DU COMPTE (`TradingAccount.currency`) : imposée par le broker pour un
 * compte synchronisé, choisie par l'utilisateur pour un compte manuel. Il n'existe AUCUNE préférence
 * de devise globale et AUCUNE conversion : un montant s'affiche dans la devise de son compte, tel que
 * reçu (un compte prop firm en USD s'affiche en USD pour tout le monde). L'ancien `User.currencyRate`
 * multipliait des USD par un taux figé pour les afficher en « € » : supprimé du code.
 *
 * Code PUR, sans dépendance : importable par Angular (esbuild) et NestJS (webpack).
 */

/** Devises qu'un compte peut porter. Ajouter une devise = ce tableau (validation API + sélecteurs front). */
export const ACCOUNT_CURRENCIES = ['USD', 'USDT', 'EUR'] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

/** Devise d'un compte créé sans choix explicite (et de tout compte Tradovate aujourd'hui). */
export const DEFAULT_ACCOUNT_CURRENCY: AccountCurrency = 'USD';

/** `' usd '` → `'USD'` ; vide / non-texte → `null`. */
export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return code || null;
}

export function isAccountCurrency(value: unknown): value is AccountCurrency {
  return typeof value === 'string' && (ACCOUNT_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Devise commune d'un ensemble de comptes : la devise unique s'ils la partagent, `null` s'ils en ont
 * plusieurs (on n'additionne pas des USD et des EUR sous un symbole), la devise par défaut s'il n'y a
 * aucun compte. Une devise vide compte comme la devise par défaut.
 */
export function commonCurrency(codes: Iterable<string | null | undefined>): string | null {
  const set = new Set<string>();
  for (const c of codes) set.add(normalizeCurrencyCode(c) ?? DEFAULT_ACCOUNT_CURRENCY);
  if (set.size === 0) return DEFAULT_ACCOUNT_CURRENCY;
  return set.size === 1 ? [...set][0] : null;
}

export interface MoneyOptions {
  /** Décimales (défaut 2). */
  decimals?: number;
  /** `+` devant les montants positifs (défaut true). Le `-` est toujours affiché. */
  sign?: boolean;
  /** ≥ 1000 → « 1.2k » (défaut false). */
  compact?: boolean;
  /** Devise affichée (défaut true) : les cellules très étroites l'omettent. */
  symbol?: boolean;
}

/** Devises affichées par un symbole AVANT le montant ; les autres par leur code APRÈS (`10.00 USDT`). */
const PREFIX_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€' };

/**
 * `+$1,234.56`, `-€92.00`, `+10.00 USDT`, `-$1.2k`. Le montant est affiché TEL QUEL, jamais converti.
 * Devise `null` (inconnue, ou comptes de devises différentes) → aucun symbole, jamais un symbole deviné.
 */
export function formatMoney(
  value: number,
  currency: string | null | undefined,
  opts: MoneyOptions = {},
): string {
  const { decimals = 2, sign = true, compact = false, symbol = true } = opts;
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : sign ? '+' : '';
  const body =
    compact && abs >= 1000
      ? `${(abs / 1000).toFixed(1)}k`
      : abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const code = normalizeCurrencyCode(currency);
  if (!symbol || !code) return `${prefix}${body}`;
  const sym = PREFIX_SYMBOLS[code];
  return sym ? `${prefix}${sym}${body}` : `${prefix}${body} ${code}`;
}
