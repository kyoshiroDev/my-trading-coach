/**
 * Sources du News live et correspondance actifs → symboles de news (fonctions pures).
 *
 * Avant : un seul appel `stock?symbols=QQQ,SPY,BTCUSD,…&limit=30`, dominé par le Bitcoin
 * (17 news sur 30 le 06/10/2026), et aucune actualité macro générale.
 */

import { isCryptoNews } from './market-news.breaking';

/** Symbole des news FMP « générales », qui n'en portent aucun. */
export const MACRO_NEWS_SYMBOL = 'MACRO';

export interface NewsFeed {
  /** Chemin sous `https://financialmodelingprep.com/stable/news/`, sans apikey. */
  path: string;
  /** Symbole imposé quand le flux n'en fournit pas. */
  symbol?: string;
}

/** Chaque flux a sa propre limite : aucun ne peut évincer les autres. */
export const NEWS_FEEDS: NewsFeed[] = [
  { path: 'general-latest?limit=20', symbol: MACRO_NEWS_SYMBOL }, // macro, banques centrales
  { path: 'forex-latest?limit=15' }, // dollar, or, paires (EURUSD, XAUUSD…)
  // Indices (QQQ, SPY, DIA, IWM), taux (TLT), pétrole (USO) et les 3 poids lourds du Nasdaq.
  { path: 'stock?symbols=SPY,QQQ,DIA,IWM,TLT,USO,NVDA,AAPL,MSFT&limit=25' },
  { path: 'stock?symbols=BTCUSD,ETHUSD&limit=5' }, // la crypto reste présente, sans dominer
];

/** Actif du journal → symboles de news FMP. Les futures et paires n'existent pas tels quels chez FMP. */
const ASSET_TO_NEWS: Record<string, string[]> = {
  MNQ: ['QQQ'], NQ: ['QQQ'], NAS100: ['QQQ'], US100: ['QQQ'],
  MES: ['SPY'], ES: ['SPY'], SPX: ['SPY'], US500: ['SPY'],
  MYM: ['DIA'], YM: ['DIA'], US30: ['DIA'],
  M2K: ['IWM'], RTY: ['IWM'],
  MCL: ['USO'], CL: ['USO'], WTI: ['USO'], USOIL: ['USO'],
  MGC: ['XAUUSD'], GC: ['XAUUSD'], XAU: ['XAUUSD'], GOLD: ['XAUUSD'],
  SI: ['XAGUSD'], SIL: ['XAGUSD'],
  ZN: ['TLT'], ZB: ['TLT'],
  '6E': ['EURUSD'], M6E: ['EURUSD'], '6B': ['GBPUSD'], '6J': ['USDJPY'], '6C': ['USDCAD'],
  '6A': ['AUDUSD'], '6S': ['USDCHF'],
  BTC: ['BTCUSD'], MBT: ['BTCUSD'], ETH: ['ETHUSD'], MET: ['ETHUSD'],
};

/** « EUR/USD », « BTC/USDT », « btc-usd » → « EURUSD », « BTCUSD », « BTCUSD ». */
function normalize(asset: string): string {
  return asset.trim().toUpperCase().replace(/[\s/_.-]/g, '').replace(/USDT$|USDC$/, 'USD');
}

/** Symboles de news pour les actifs de l'utilisateur, macro toujours incluse. */
export function newsSymbolsFor(assets: string[]): string[] {
  const out = new Set<string>([MACRO_NEWS_SYMBOL]);
  for (const a of assets) {
    if (!a?.trim()) continue;
    const n = normalize(a);
    for (const s of ASSET_TO_NEWS[n] ?? [n]) out.add(s);
  }
  return [...out];
}

/**
 * FMP date ses news « YYYY-MM-DD HH:mm:ss » en heure de New York, pas en UTC (le calendrier
 * éco, lui, est en UTC). Lues comme UTC, elles apparaissaient 4 h (5 h l'hiver) trop tôt :
 * « 15:35 » pour une news de 21:35 à Paris, et un bandeau breaking qui ne voyait que 2 h.
 */
export function parseFmpNewsDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value?.trim() ?? '');
  if (!m) return new Date(value); // format inattendu (ISO avec fuseau…) : tel quel
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const wall = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // Décalage de New York à cet instant, recalculé une fois pour les changements d'heure.
  let utc = wall - nyOffsetMs(wall);
  utc = wall - nyOffsetMs(utc);
  return new Date(utc);
}

/** Décalage (ms) de America/New_York par rapport à UTC à l'instant donné (négatif). */
function nyOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** News affichées dans le News live, et part maximale de la crypto. */
export const NEWS_DISPLAY_COUNT = 20;
export const NEWS_CRYPTO_MAX = 4;

/**
 * Les 20 news les plus récentes, crypto plafonnée à 4. Chaque flux est limité à la source,
 * mais l'affichage trie toutes les news par date : la crypto, qui publie en continu, prenait
 * le haut de la liste (13 news sur 20 le 07/10/2026). Plafond levé si l'utilisateur trade
 * lui-même de la crypto.
 */
export function selectNewsForDisplay<T extends { title: string; symbol?: string | null }>(
  rows: T[],
  opts: { keepCrypto?: boolean } = {},
): T[] {
  if (opts.keepCrypto) return rows.slice(0, NEWS_DISPLAY_COUNT);
  const out: T[] = [];
  let crypto = 0;
  for (const r of rows) {
    if (out.length >= NEWS_DISPLAY_COUNT) break;
    if (isCryptoNews(r)) {
      if (crypto >= NEWS_CRYPTO_MAX) continue;
      crypto++;
    }
    out.push(r);
  }
  return out;
}
