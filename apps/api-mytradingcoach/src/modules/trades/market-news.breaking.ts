/**
 * Choix des news éligibles au bandeau BREAKING de la session live (fonction pure).
 *
 * Avant : la première news dont le titre CONTENAIT « fed », « ecb », « powell » ou « fomc »,
 * même au milieu d'un mot. Le flux FMP étant dominé par le Bitcoin, un titre comme
 * « Bitcoin needs ETF flows to confirm Fed-driven rally » gagnait presque toujours.
 * Maintenant : mots entiers, thèmes macro qui bougent les indices et le dollar, hors
 * crypto, et seulement si la news est récente.
 */

/** Banques centrales, décisions de taux, grands chiffres macro. */
const MACRO = new RegExp(
  [
    'fed', 'federal reserve', 'fomc', 'powell', 'ecb', 'lagarde', 'boj', 'boe', 'bank of (japan|england)',
    'rate (cut|cuts|hike|hikes|decision)', 'interest rates?', 'inflation', 'cpi', 'pce',
    'payrolls?', 'nonfarm', 'non-farm', 'jobs report', 'jobless claims', 'gdp', 'recession',
    'treasury yields?', 'tariffs?', 'trade war',
  ].map((w) => `\\b${w}\\b`).join('|'),
  'i',
);

/** Crypto : écartée même quand le titre parle de la Fed. */
const CRYPTO_SYMBOL = /^(BTC|ETH|SOL|XRP|DOGE|ADA|BNB|LTC)/i;
const CRYPTO_TITLE = /\b(bitcoin|btc|ether(eum)?|crypto(currency|currencies)?|stablecoins?|altcoins?|solana|xrp|binance|coinbase)\b/i;

/** Au-delà, une news n'est plus « breaking ». */
export const BREAKING_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function isBreakingNews(
  news: { title: string; symbol?: string | null; publishedDate: Date | string },
  now: Date = new Date(),
): boolean {
  const title = news.title ?? '';
  if (!MACRO.test(title)) return false;
  if ((news.symbol && CRYPTO_SYMBOL.test(news.symbol)) || CRYPTO_TITLE.test(title)) return false;
  const age = now.getTime() - new Date(news.publishedDate).getTime();
  return Number.isFinite(age) && age >= 0 && age <= BREAKING_MAX_AGE_MS;
}
