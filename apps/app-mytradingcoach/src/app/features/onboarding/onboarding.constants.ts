export type TradingStyle = 'SCALPING' | 'DAY_TRADING' | 'SWING' | 'POSITION';
export type TradingSession = 'LONDON' | 'NEW_YORK' | 'ASIAN';

export const TRADING_STYLES: { value: TradingStyle; label: string; emoji: string; desc: string }[] = [
  { value: 'SCALPING',    label: 'Scalping',    emoji: '⚡', desc: 'Trades de quelques secondes à minutes' },
  { value: 'DAY_TRADING', label: 'Day Trading', emoji: '📅', desc: 'Positions fermées dans la journée' },
  { value: 'SWING',       label: 'Swing',       emoji: '🌊', desc: 'Positions de quelques jours à semaines' },
  { value: 'POSITION',    label: 'Long terme',  emoji: '🏔️', desc: 'Plusieurs semaines à mois' },
];

export const STRATEGY_TAGS = [
  'ICT', 'SMC', 'Price Action', 'Indicateurs',
  'Order Blocks', 'FVG', 'Liquidity', 'Algo',
  'Prop Firm', 'Supply & Demand', 'Wyckoff', 'Elliott Wave',
];

export const SESSIONS: { value: TradingSession; label: string; time: string }[] = [
  { value: 'LONDON',   label: 'Londres',  time: '8h-12h CET' },
  { value: 'NEW_YORK', label: 'New York', time: '14h-20h CET' },
  { value: 'ASIAN',    label: 'Asie',     time: '00h-8h CET' },
];

export const ASSET_SUGGESTIONS: Record<string, string[]> = {
  CRYPTO:  ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'],
  FOREX:   ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'],
  ACTIONS: ['NQ', 'ES', 'MNQ', 'MES', 'AAPL', 'TSLA'],
  MULTI:   ['BTC/USDT', 'EUR/USD', 'NQ', 'ES'],
};
