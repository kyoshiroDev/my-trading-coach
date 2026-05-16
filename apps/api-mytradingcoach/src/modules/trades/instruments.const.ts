export interface Instrument {
  symbol: string;
  label: string;
  category: 'FUTURES_US' | 'CRYPTO' | 'FOREX' | 'INDICES' | 'ACTIONS';
  tickValue: number | null; // valeur monétaire par tick ($)
  tickSize?: number; // taille d'un tick (unité de prix)
  pipDecimals?: number; // pour FOREX uniquement
}

export const INSTRUMENTS: Instrument[] = [
  // ── Equity Index Futures ─────────────────────────────────────────────────
  {
    symbol: 'MNQ',
    label: 'Micro E-mini Nasdaq (MNQ)',
    category: 'FUTURES_US',
    tickValue: 0.5,
    tickSize: 0.25,
  },
  {
    symbol: 'NQ',
    label: 'E-mini Nasdaq (NQ)',
    category: 'FUTURES_US',
    tickValue: 5.0,
    tickSize: 0.25,
  },
  {
    symbol: 'MES',
    label: 'Micro E-mini S&P 500 (MES)',
    category: 'FUTURES_US',
    tickValue: 1.25,
    tickSize: 0.25,
  },
  {
    symbol: 'ES',
    label: 'E-mini S&P 500 (ES)',
    category: 'FUTURES_US',
    tickValue: 12.5,
    tickSize: 0.25,
  },
  {
    symbol: 'MYM',
    label: 'Micro E-mini Dow Jones (MYM)',
    category: 'FUTURES_US',
    tickValue: 0.5,
    tickSize: 1.0,
  },
  {
    symbol: 'YM',
    label: 'E-mini Dow Jones (YM)',
    category: 'FUTURES_US',
    tickValue: 5.0,
    tickSize: 1.0,
  },
  {
    symbol: 'M2K',
    label: 'Micro E-mini Russell 2000 (M2K)',
    category: 'FUTURES_US',
    tickValue: 0.5,
    tickSize: 0.1,
  },
  {
    symbol: 'RTY',
    label: 'E-mini Russell 2000 (RTY)',
    category: 'FUTURES_US',
    tickValue: 5.0,
    tickSize: 0.1,
  },
  // ── Energy ───────────────────────────────────────────────────────────────
  {
    symbol: 'MCL',
    label: 'Micro WTI Crude Oil (MCL)',
    category: 'FUTURES_US',
    tickValue: 1.0,
    tickSize: 0.01,
  },
  {
    symbol: 'CL',
    label: 'WTI Crude Oil (CL)',
    category: 'FUTURES_US',
    tickValue: 10.0,
    tickSize: 0.01,
  },
  // ── Metals ───────────────────────────────────────────────────────────────
  {
    symbol: 'MGC',
    label: 'Micro Gold (MGC)',
    category: 'FUTURES_US',
    tickValue: 1.0,
    tickSize: 0.1,
  },
  {
    symbol: 'GC',
    label: 'Gold (GC)',
    category: 'FUTURES_US',
    tickValue: 10.0,
    tickSize: 0.1,
  },
  {
    symbol: 'SIL',
    label: 'Micro Silver (SIL)',
    category: 'FUTURES_US',
    tickValue: 1.25,
    tickSize: 0.005,
  },
  {
    symbol: 'SI',
    label: 'Silver (SI)',
    category: 'FUTURES_US',
    tickValue: 25.0,
    tickSize: 0.005,
  },
  // ── Bonds ────────────────────────────────────────────────────────────────
  {
    symbol: 'ZF',
    label: '5-Year T-Note (ZF)',
    category: 'FUTURES_US',
    tickValue: 7.8125,
    tickSize: 0.0078125,
  },
  {
    symbol: 'ZN',
    label: '10-Year T-Note (ZN)',
    category: 'FUTURES_US',
    tickValue: 15.625,
    tickSize: 0.015625,
  },
  {
    symbol: 'ZB',
    label: '30-Year T-Bond (ZB)',
    category: 'FUTURES_US',
    tickValue: 31.25,
    tickSize: 0.03125,
  },
  // ── Currency Futures ──────────────────────────────────────────────────────
  {
    symbol: '6E',
    label: 'Euro FX Futures (6E)',
    category: 'FUTURES_US',
    tickValue: 6.25,
    tickSize: 0.00005,
  },
  {
    symbol: 'M6E',
    label: 'Micro Euro FX Futures (M6E)',
    category: 'FUTURES_US',
    tickValue: 1.25,
    tickSize: 0.0001,
  },
  {
    symbol: '6B',
    label: 'British Pound Futures (6B)',
    category: 'FUTURES_US',
    tickValue: 6.25,
    tickSize: 0.0001,
  },
  {
    symbol: 'M6B',
    label: 'Micro British Pound Futures (M6B)',
    category: 'FUTURES_US',
    tickValue: 0.625,
    tickSize: 0.0001,
  },
  {
    symbol: '6J',
    label: 'Japanese Yen Futures (6J)',
    category: 'FUTURES_US',
    tickValue: 6.25,
    tickSize: 0.0000005,
  },
  {
    symbol: '6C',
    label: 'Canadian Dollar Futures (6C)',
    category: 'FUTURES_US',
    tickValue: 10.0,
    tickSize: 0.0001,
  },
  {
    symbol: '6S',
    label: 'Swiss Franc Futures (6S)',
    category: 'FUTURES_US',
    tickValue: 12.5,
    tickSize: 0.0001,
  },
  {
    symbol: '6A',
    label: 'Australian Dollar Futures (6A)',
    category: 'FUTURES_US',
    tickValue: 10.0,
    tickSize: 0.0001,
  },
  // ── Crypto Futures ────────────────────────────────────────────────────────
  {
    symbol: 'MBT',
    label: 'Micro Bitcoin Futures (MBT)',
    category: 'FUTURES_US',
    tickValue: 5.0,
    tickSize: 5.0,
  },
  {
    symbol: 'BTC',
    label: 'Bitcoin Futures (BTC)',
    category: 'FUTURES_US',
    tickValue: 25.0,
    tickSize: 5.0,
  },
  {
    symbol: 'MET',
    label: 'Micro Ether Futures (MET)',
    category: 'FUTURES_US',
    tickValue: 0.1,
    tickSize: 0.1,
  },
  // ── CRYPTO ───────────────────────────────────────────────────────────────
  {
    symbol: 'BTC/USDT',
    label: 'Bitcoin (BTC/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'ETH/USDT',
    label: 'Ethereum (ETH/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'SOL/USDT',
    label: 'Solana (SOL/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'BNB/USDT',
    label: 'BNB (BNB/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'XRP/USDT',
    label: 'XRP (XRP/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'DOGE/USDT',
    label: 'Dogecoin (DOGE/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'ADA/USDT',
    label: 'Cardano (ADA/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'AVAX/USDT',
    label: 'Avalanche (AVAX/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'LINK/USDT',
    label: 'Chainlink (LINK/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'DOT/USDT',
    label: 'Polkadot (DOT/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'UNI/USDT',
    label: 'Uniswap (UNI/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'LTC/USDT',
    label: 'Litecoin (LTC/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'BCH/USDT',
    label: 'Bitcoin Cash (BCH/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'ATOM/USDT',
    label: 'Cosmos (ATOM/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  {
    symbol: 'MATIC/USDT',
    label: 'Polygon (MATIC/USDT)',
    category: 'CRYPTO',
    tickValue: null,
  },
  // ── FOREX ────────────────────────────────────────────────────────────────
  // tickValue = valeur d'1 pip pour 1 lot standard (100 000 unités) en USD
  // pipDecimals = 2 pour paires JPY, 4 pour toutes les autres
  // ── Majeurs ──
  {
    symbol: 'EUR/USD',
    label: 'Euro / Dollar (EUR/USD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'GBP/USD',
    label: 'Livre Sterling / Dollar (GBP/USD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'USD/JPY',
    label: 'Dollar / Yen (USD/JPY)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 2,
  },
  {
    symbol: 'USD/CHF',
    label: 'Dollar / Franc Suisse (USD/CHF)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'AUD/USD',
    label: 'Dollar Australien / Dollar (AUD/USD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'USD/CAD',
    label: 'Dollar / Dollar Canadien (USD/CAD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'NZD/USD',
    label: 'Dollar NZ / Dollar (NZD/USD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  // ── Croisés EUR ──
  {
    symbol: 'EUR/GBP',
    label: 'Euro / Livre Sterling (EUR/GBP)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'EUR/JPY',
    label: 'Euro / Yen (EUR/JPY)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 2,
  },
  {
    symbol: 'EUR/CHF',
    label: 'Euro / Franc Suisse (EUR/CHF)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'EUR/AUD',
    label: 'Euro / Dollar Australien (EUR/AUD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'EUR/CAD',
    label: 'Euro / Dollar Canadien (EUR/CAD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  // ── Croisés GBP ──
  {
    symbol: 'GBP/JPY',
    label: 'Livre Sterling / Yen (GBP/JPY)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 2,
  },
  {
    symbol: 'GBP/CHF',
    label: 'Livre Sterling / Franc Suisse (GBP/CHF)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'GBP/AUD',
    label: 'Livre Sterling / Dollar Australien (GBP/AUD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  {
    symbol: 'GBP/CAD',
    label: 'Livre Sterling / Dollar Canadien (GBP/CAD)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 4,
  },
  // ── Croisés autres ──
  {
    symbol: 'AUD/JPY',
    label: 'Dollar Australien / Yen (AUD/JPY)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 2,
  },
  {
    symbol: 'CAD/JPY',
    label: 'Dollar Canadien / Yen (CAD/JPY)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 2,
  },
  {
    symbol: 'CHF/JPY',
    label: 'Franc Suisse / Yen (CHF/JPY)',
    category: 'FOREX',
    tickValue: 10,
    pipDecimals: 2,
  },
  // ── Or / Argent (spot Forex) ──
  {
    symbol: 'XAU/USD',
    label: 'Or / Dollar (XAU/USD)',
    category: 'FOREX',
    tickValue: 100,
    pipDecimals: 2,
  },
  {
    symbol: 'XAG/USD',
    label: 'Argent / Dollar (XAG/USD)',
    category: 'FOREX',
    tickValue: 50,
    pipDecimals: 3,
  },
  // ── INDICES CFD ──────────────────────────────────────────────────────────
  {
    symbol: 'US30',
    label: 'Dow Jones CFD (US30)',
    category: 'INDICES',
    tickValue: null,
  },
  {
    symbol: 'US500',
    label: 'S&P 500 CFD (US500)',
    category: 'INDICES',
    tickValue: null,
  },
  {
    symbol: 'US100',
    label: 'Nasdaq CFD (US100)',
    category: 'INDICES',
    tickValue: null,
  },
  {
    symbol: 'GER40',
    label: 'DAX CFD (GER40)',
    category: 'INDICES',
    tickValue: null,
  },
  {
    symbol: 'UK100',
    label: 'FTSE 100 CFD (UK100)',
    category: 'INDICES',
    tickValue: null,
  },
  {
    symbol: 'FRA40',
    label: 'CAC 40 CFD (FRA40)',
    category: 'INDICES',
    tickValue: null,
  },
  {
    symbol: 'JPN225',
    label: 'Nikkei 225 CFD (JPN225)',
    category: 'INDICES',
    tickValue: null,
  },
  // ── ACTIONS ──────────────────────────────────────────────────────────────
  {
    symbol: 'AAPL',
    label: 'Apple (AAPL)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'TSLA',
    label: 'Tesla (TSLA)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'NVDA',
    label: 'Nvidia (NVDA)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'META',
    label: 'Meta (META)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'GOOGL',
    label: 'Alphabet (GOOGL)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'AMZN',
    label: 'Amazon (AMZN)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'MSFT',
    label: 'Microsoft (MSFT)',
    category: 'ACTIONS',
    tickValue: null,
  },
  { symbol: 'AMD', label: 'AMD (AMD)', category: 'ACTIONS', tickValue: null },
  {
    symbol: 'COIN',
    label: 'Coinbase (COIN)',
    category: 'ACTIONS',
    tickValue: null,
  },
  {
    symbol: 'MSTR',
    label: 'MicroStrategy (MSTR)',
    category: 'ACTIONS',
    tickValue: null,
  },
];

export function getTickValue(symbol: string): number | null {
  return (
    INSTRUMENTS.find((i) => i.symbol.toUpperCase() === symbol.toUpperCase())
      ?.tickValue ?? null
  );
}

export function getTickSize(symbol: string): number | undefined {
  return INSTRUMENTS.find(
    (i) => i.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.tickSize;
}

export function getPipDecimals(symbol: string): number {
  return (
    INSTRUMENTS.find((i) => i.symbol.toUpperCase() === symbol.toUpperCase())
      ?.pipDecimals ?? 4
  );
}
