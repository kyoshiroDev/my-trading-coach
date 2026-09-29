import type { InstrumentSearchResult, UserAssetItem } from '../../core/api/trades.api';

/** Liste courte proposée quand la recherche d'instruments de l'API est indisponible. */
const QUICK_LIST: InstrumentSearchResult[] = [
  { symbol: 'NQ',  label: 'E-mini Nasdaq (NQ)',              category: 'FUTURES' },
  { symbol: 'MNQ', label: 'Micro E-mini Nasdaq (MNQ)',       category: 'FUTURES' },
  { symbol: 'ES',  label: 'E-mini S&P 500 (ES)',             category: 'FUTURES' },
  { symbol: 'MES', label: 'Micro E-mini S&P 500 (MES)',      category: 'FUTURES' },
  { symbol: 'YM',  label: 'E-mini Dow Jones (YM)',           category: 'FUTURES' },
  { symbol: 'RTY', label: 'E-mini Russell 2000 (RTY)',       category: 'FUTURES' },
  { symbol: 'GC',  label: 'Gold Futures (GC)',               category: 'FUTURES' },
  { symbol: 'CL',  label: 'Crude Oil Futures (CL)',          category: 'FUTURES' },
  { symbol: 'MBT', label: 'Micro Bitcoin CME (MBT)',         category: 'FUTURES' },
  { symbol: 'BTC', label: 'Bitcoin Futures CME (BTC)',       category: 'FUTURES' },
  { symbol: 'MET', label: 'Micro Ether CME (MET)',           category: 'FUTURES' },
  { symbol: 'ETH', label: 'Ether Futures CME (ETH)',         category: 'FUTURES' },
  { symbol: 'BTC/USDT', label: 'Bitcoin Spot (BTC/USDT)',   category: 'CRYPTO' },
  { symbol: 'ETH/USDT', label: 'Ethereum Spot (ETH/USDT)', category: 'CRYPTO' },
  { symbol: 'EUR/USD',  label: 'Euro / Dollar (EUR/USD)',   category: 'FOREX' },
  { symbol: 'GBP/USD',  label: 'Livre / Dollar (GBP/USD)', category: 'FOREX' },
];

/** Recherche locale (8 résultats max) utilisée en repli si l'API ne répond pas. */
export function searchLocalInstruments(query: string): InstrumentSearchResult[] {
  const q = query.toLowerCase();
  return QUICK_LIST.filter(
    (i) => i.symbol.toLowerCase().includes(q) || i.label.toLowerCase().includes(q),
  ).slice(0, 8);
}

/** Ajoute un actif ; le premier ajouté devient le favori. `null` si déjà présent. */
export function withAsset(assets: UserAssetItem[], result: InstrumentSearchResult): UserAssetItem[] | null {
  const symbol = result.symbol.toUpperCase().trim();
  if (assets.some((a) => a.symbol === symbol)) return null;
  return [
    ...assets,
    {
      symbol,
      label: result.label,
      category: result.category,
      isFavorite: assets.length === 0,
      tradeCount: 0,
      lastEntry: null,
      lastQty: null,
    },
  ];
}

/** Retire un actif ; si c'était le favori, le premier restant le devient (un seul favori). */
export function withoutAsset(assets: UserAssetItem[], symbol: string): UserAssetItem[] {
  const wasFav = assets.find((a) => a.symbol === symbol)?.isFavorite ?? false;
  const next = assets.filter((a) => a.symbol !== symbol);
  return wasFav && next.length ? next.map((a, i) => ({ ...a, isFavorite: i === 0 })) : next;
}

const STYLE_EMOJI: Record<string, string> = {
  SCALPING: '⚡', DAY_TRADING: '📅', SWING: '🌊', POSITION: '🏔️',
};

const STYLE_LABEL: Record<string, string> = {
  SCALPING: 'Scalping', DAY_TRADING: 'Day Trading',
  SWING: 'Swing Trading', POSITION: 'Long terme',
};

const SESSION_LABEL: Record<string, string> = {
  LONDON: 'Londres', NEW_YORK: 'New York', ASIAN: 'Asie',
};

export function styleEmoji(style: string | null): string {
  return style ? (STYLE_EMOJI[style] ?? '📈') : '📈';
}

export function styleLabel(style: string | null): string {
  return style ? (STYLE_LABEL[style] ?? style) : '';
}

export function sessionLabel(s: string): string {
  return SESSION_LABEL[s] ?? s;
}
