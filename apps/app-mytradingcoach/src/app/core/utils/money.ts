/**
 * Formatage monétaire UNIQUE de l'app (PROMPT-213). Les montants arrivent de l'API en USD ;
 * ils sont convertis dans la devise d'affichage du user (`currency` + `currencyRate`) et
 * préfixés du bon symbole. Plus de `$` en dur : le calendrier, les courbes et les KPIs
 * affichaient chacun leur format, parfois sans conversion pour un compte en EUR.
 */
export type DisplayCurrency = 'USD' | 'EUR';

export interface MoneyFormat {
  currency: DisplayCurrency;
  /** Taux USD → devise d'affichage (1 en USD). */
  rate: number;
}

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

export const USD_FORMAT: MoneyFormat = { currency: 'USD', rate: 1 };

export function currencySymbol(currency: DisplayCurrency): string {
  return currency === 'EUR' ? '€' : '$';
}

/** `+$1,234.56`, `-€92.00`, `+$1.2k`… à partir d'un montant en USD. */
export function formatMoney(usd: number, fmt: MoneyFormat, opts: MoneyOptions = {}): string {
  const { decimals = 2, sign = true, compact = false, symbol = true } = opts;
  const value = usd * fmt.rate;
  const abs = Math.abs(value);
  const prefix = value < 0 ? '-' : sign ? '+' : '';
  const sym = symbol ? currencySymbol(fmt.currency) : '';
  const body =
    compact && abs >= 1000
      ? `${(abs / 1000).toFixed(1)}k`
      : abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${prefix}${sym}${body}`;
}
