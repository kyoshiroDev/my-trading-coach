/**
 * Formatage monétaire UNIQUE de l'app (PROMPT-213). Un montant s'affiche dans la devise NATIVE
 * de son compte de trading (`TradingAccount.currency`), **sans aucune conversion** : un compte
 * prop firm en USD s'affiche en USD pour tout le monde. Plus de `$` en dur (le calendrier, les
 * courbes et les KPIs avaient chacun leur format) et plus de taux (`User.currencyRate`, figé au
 * choix de la préférence, multipliait des montants USD pour les afficher en « € »).
 */

/** Code ISO 4217 du compte (`USD`, `EUR`…) ; `null` = devise inconnue ou comptes de devises mêlées. */
export type CurrencyCode = string | null;

export interface MoneyOptions {
  /** Décimales (défaut 2). */
  decimals?: number;
  /** `+` devant les montants positifs (défaut true). Le `-` est toujours affiché. */
  sign?: boolean;
  /** ≥ 1000 → « 1.2k » (défaut false). */
  compact?: boolean;
  /** Symbole de devise (défaut true) : les cellules très étroites l'omettent. */
  symbol?: boolean;
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

/** `$`, `€`, `£` ; autre code → « CHF » suivi d'une espace ; `null` → rien (jamais de symbole deviné). */
export function currencySymbol(currency: CurrencyCode): string {
  if (!currency) return '';
  const code = currency.trim().toUpperCase();
  return SYMBOLS[code] ?? `${code} `;
}

/** `+$1,234.56`, `-€92.00`, `+$1.2k`… Le montant est affiché tel quel, jamais converti. */
export function formatMoney(value: number, currency: CurrencyCode, opts: MoneyOptions = {}): string {
  const { decimals = 2, sign = true, compact = false, symbol = true } = opts;
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : sign ? '+' : '';
  const sym = symbol ? currencySymbol(currency) : '';
  const body =
    compact && abs >= 1000
      ? `${(abs / 1000).toFixed(1)}k`
      : abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${prefix}${sym}${body}`;
}
