export interface Instrument {
  symbol: string;
  label: string;
  category: 'FUTURES_US' | 'CRYPTO' | 'FOREX' | 'INDICES' | 'ACTIONS';
  tickValue: number | null;
}

export const INSTRUMENTS: Instrument[] = [
  // ── FUTURES US ──────────────────────────────────────────────────────────
  { symbol: 'MNQ',  label: 'Micro Nasdaq (MNQ)',           category: 'FUTURES_US', tickValue: 2    },
  { symbol: 'NQ',   label: 'Nasdaq (NQ)',                   category: 'FUTURES_US', tickValue: 20   },
  { symbol: 'MES',  label: 'Micro S&P 500 (MES)',           category: 'FUTURES_US', tickValue: 5    },
  { symbol: 'ES',   label: 'S&P 500 (ES)',                  category: 'FUTURES_US', tickValue: 50   },
  { symbol: 'MYM',  label: 'Micro Dow Jones (MYM)',         category: 'FUTURES_US', tickValue: 0.5  },
  { symbol: 'YM',   label: 'Dow Jones (YM)',                category: 'FUTURES_US', tickValue: 5    },
  { symbol: 'M2K',  label: 'Micro Russell 2000 (M2K)',      category: 'FUTURES_US', tickValue: 5    },
  { symbol: 'RTY',  label: 'Russell 2000 (RTY)',            category: 'FUTURES_US', tickValue: 50   },
  { symbol: 'MCL',  label: 'Micro Crude Oil (MCL)',         category: 'FUTURES_US', tickValue: 10   },
  { symbol: 'CL',   label: 'Crude Oil (CL)',                category: 'FUTURES_US', tickValue: 1000 },
  { symbol: 'MGC',  label: 'Micro Gold (MGC)',              category: 'FUTURES_US', tickValue: 10   },
  { symbol: 'GC',   label: 'Gold (GC)',                     category: 'FUTURES_US', tickValue: 100  },
  { symbol: 'SI',   label: 'Silver (SI)',                   category: 'FUTURES_US', tickValue: 50   },
  { symbol: 'ZB',   label: 'T-Bond (ZB)',                   category: 'FUTURES_US', tickValue: 1000 },
  { symbol: 'ZN',   label: '10Y T-Note (ZN)',               category: 'FUTURES_US', tickValue: 1000 },
  { symbol: 'ZF',   label: '5Y T-Note (ZF)',                category: 'FUTURES_US', tickValue: 1000 },
  // ── CRYPTO ──────────────────────────────────────────────────────────────
  { symbol: 'BTC/USDT',   label: 'Bitcoin (BTC/USDT)',      category: 'CRYPTO', tickValue: null },
  { symbol: 'ETH/USDT',   label: 'Ethereum (ETH/USDT)',     category: 'CRYPTO', tickValue: null },
  { symbol: 'SOL/USDT',   label: 'Solana (SOL/USDT)',       category: 'CRYPTO', tickValue: null },
  { symbol: 'BNB/USDT',   label: 'BNB (BNB/USDT)',          category: 'CRYPTO', tickValue: null },
  { symbol: 'XRP/USDT',   label: 'XRP (XRP/USDT)',          category: 'CRYPTO', tickValue: null },
  { symbol: 'DOGE/USDT',  label: 'Dogecoin (DOGE/USDT)',    category: 'CRYPTO', tickValue: null },
  { symbol: 'ADA/USDT',   label: 'Cardano (ADA/USDT)',      category: 'CRYPTO', tickValue: null },
  { symbol: 'AVAX/USDT',  label: 'Avalanche (AVAX/USDT)',   category: 'CRYPTO', tickValue: null },
  { symbol: 'LINK/USDT',  label: 'Chainlink (LINK/USDT)',   category: 'CRYPTO', tickValue: null },
  { symbol: 'DOT/USDT',   label: 'Polkadot (DOT/USDT)',     category: 'CRYPTO', tickValue: null },
  { symbol: 'UNI/USDT',   label: 'Uniswap (UNI/USDT)',      category: 'CRYPTO', tickValue: null },
  { symbol: 'LTC/USDT',   label: 'Litecoin (LTC/USDT)',     category: 'CRYPTO', tickValue: null },
  { symbol: 'BCH/USDT',   label: 'Bitcoin Cash (BCH/USDT)', category: 'CRYPTO', tickValue: null },
  { symbol: 'ATOM/USDT',  label: 'Cosmos (ATOM/USDT)',      category: 'CRYPTO', tickValue: null },
  { symbol: 'MATIC/USDT', label: 'Polygon (MATIC/USDT)',    category: 'CRYPTO', tickValue: null },
  // ── FOREX ───────────────────────────────────────────────────────────────
  { symbol: 'EUR/USD', label: 'Euro / Dollar (EUR/USD)',    category: 'FOREX', tickValue: null },
  { symbol: 'GBP/USD', label: 'Livre / Dollar (GBP/USD)',   category: 'FOREX', tickValue: null },
  { symbol: 'USD/JPY', label: 'Dollar / Yen (USD/JPY)',     category: 'FOREX', tickValue: null },
  { symbol: 'USD/CHF', label: 'Dollar / Franc (USD/CHF)',   category: 'FOREX', tickValue: null },
  { symbol: 'AUD/USD', label: 'Australien / Dollar',        category: 'FOREX', tickValue: null },
  { symbol: 'USD/CAD', label: 'Dollar / Canadien',          category: 'FOREX', tickValue: null },
  { symbol: 'NZD/USD', label: 'NZ Dollar / Dollar',         category: 'FOREX', tickValue: null },
  { symbol: 'EUR/GBP', label: 'Euro / Livre (EUR/GBP)',     category: 'FOREX', tickValue: null },
  { symbol: 'EUR/JPY', label: 'Euro / Yen (EUR/JPY)',       category: 'FOREX', tickValue: null },
  { symbol: 'GBP/JPY', label: 'Livre / Yen (GBP/JPY)',     category: 'FOREX', tickValue: null },
  // ── INDICES CFD ─────────────────────────────────────────────────────────
  { symbol: 'US30',   label: 'Dow Jones CFD (US30)',        category: 'INDICES', tickValue: null },
  { symbol: 'US500',  label: 'S&P 500 CFD (US500)',         category: 'INDICES', tickValue: null },
  { symbol: 'US100',  label: 'Nasdaq CFD (US100)',          category: 'INDICES', tickValue: null },
  { symbol: 'GER40',  label: 'DAX CFD (GER40)',             category: 'INDICES', tickValue: null },
  { symbol: 'UK100',  label: 'FTSE 100 CFD (UK100)',        category: 'INDICES', tickValue: null },
  { symbol: 'FRA40',  label: 'CAC 40 CFD (FRA40)',          category: 'INDICES', tickValue: null },
  { symbol: 'JPN225', label: 'Nikkei 225 CFD (JPN225)',     category: 'INDICES', tickValue: null },
  // ── ACTIONS ─────────────────────────────────────────────────────────────
  { symbol: 'AAPL',  label: 'Apple (AAPL)',                 category: 'ACTIONS', tickValue: null },
  { symbol: 'TSLA',  label: 'Tesla (TSLA)',                 category: 'ACTIONS', tickValue: null },
  { symbol: 'NVDA',  label: 'Nvidia (NVDA)',                category: 'ACTIONS', tickValue: null },
  { symbol: 'META',  label: 'Meta (META)',                  category: 'ACTIONS', tickValue: null },
  { symbol: 'GOOGL', label: 'Alphabet (GOOGL)',             category: 'ACTIONS', tickValue: null },
  { symbol: 'AMZN',  label: 'Amazon (AMZN)',                category: 'ACTIONS', tickValue: null },
  { symbol: 'MSFT',  label: 'Microsoft (MSFT)',             category: 'ACTIONS', tickValue: null },
  { symbol: 'AMD',   label: 'AMD (AMD)',                    category: 'ACTIONS', tickValue: null },
  { symbol: 'COIN',  label: 'Coinbase (COIN)',              category: 'ACTIONS', tickValue: null },
  { symbol: 'MSTR',  label: 'MicroStrategy (MSTR)',         category: 'ACTIONS', tickValue: null },
];

export function getTickValue(symbol: string): number | null {
  return INSTRUMENTS.find(
    (i) => i.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.tickValue ?? null;
}
