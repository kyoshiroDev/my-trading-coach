export interface Instrument {
  symbol: string;
  label: string;
  category: 'FUTURES_US' | 'CRYPTO' | 'FOREX' | 'INDICES' | 'ACTIONS';
  tickValue: number | null;
  tickSize?: number;
  pipDecimals?: number;
}

// ── Seules les données que FMP ne fournit pas : tickValue/tickSize CME ────────
// Ces valeurs sont des spécifications contractuelles fixes — jamais dans une API.
// Labels/catégories pour le reste → FMP /stable/search
export const INSTRUMENTS: Instrument[] = [
  // ── Equity Index Futures ──────────────────────────────────────────────────
  { symbol: 'MNQ', label: 'Micro E-mini Nasdaq (MNQ)',       category: 'FUTURES_US', tickValue: 0.5,      tickSize: 0.25      },
  { symbol: 'NQ',  label: 'E-mini Nasdaq (NQ)',              category: 'FUTURES_US', tickValue: 5.0,      tickSize: 0.25      },
  { symbol: 'MES', label: 'Micro E-mini S&P 500 (MES)',      category: 'FUTURES_US', tickValue: 1.25,     tickSize: 0.25      },
  { symbol: 'ES',  label: 'E-mini S&P 500 (ES)',             category: 'FUTURES_US', tickValue: 12.5,     tickSize: 0.25      },
  { symbol: 'MYM', label: 'Micro E-mini Dow Jones (MYM)',    category: 'FUTURES_US', tickValue: 0.5,      tickSize: 1.0       },
  { symbol: 'YM',  label: 'E-mini Dow Jones (YM)',           category: 'FUTURES_US', tickValue: 5.0,      tickSize: 1.0       },
  { symbol: 'M2K', label: 'Micro E-mini Russell 2000 (M2K)', category: 'FUTURES_US', tickValue: 0.5,      tickSize: 0.1       },
  { symbol: 'RTY', label: 'E-mini Russell 2000 (RTY)',       category: 'FUTURES_US', tickValue: 5.0,      tickSize: 0.1       },
  // ── Energy Futures ────────────────────────────────────────────────────────
  { symbol: 'MCL', label: 'Micro Crude Oil (MCL)',           category: 'FUTURES_US', tickValue: 1.0,      tickSize: 0.01      },
  { symbol: 'CL',  label: 'Crude Oil (CL)',                  category: 'FUTURES_US', tickValue: 10.0,     tickSize: 0.01      },
  // ── Metals Futures ────────────────────────────────────────────────────────
  { symbol: 'MGC', label: 'Micro Gold (MGC)',                category: 'FUTURES_US', tickValue: 1.0,      tickSize: 0.1       },
  { symbol: 'GC',  label: 'Gold (GC)',                       category: 'FUTURES_US', tickValue: 10.0,     tickSize: 0.1       },
  { symbol: 'SIL', label: 'Micro Silver (SIL)',              category: 'FUTURES_US', tickValue: 1.0,      tickSize: 0.005     },
  { symbol: 'SI',  label: 'Silver (SI)',                     category: 'FUTURES_US', tickValue: 25.0,     tickSize: 0.005     },
  // ── Bond Futures ──────────────────────────────────────────────────────────
  { symbol: 'ZF',  label: '5-Year T-Note (ZF)',              category: 'FUTURES_US', tickValue: 7.8125,   tickSize: 0.0078125 },
  { symbol: 'ZN',  label: '10-Year T-Note (ZN)',             category: 'FUTURES_US', tickValue: 15.625,   tickSize: 0.015625  },
  { symbol: 'ZB',  label: '30-Year T-Bond (ZB)',             category: 'FUTURES_US', tickValue: 31.25,    tickSize: 0.03125   },
  // ── Crypto Futures CME ───────────────────────────────────────────────────
  { symbol: 'MBT', label: 'Micro Bitcoin CME (MBT)', category: 'FUTURES_US', tickValue: 0.5,    tickSize: 5.0  },
  { symbol: 'BTC', label: 'Bitcoin CME (BTC)',        category: 'FUTURES_US', tickValue: 25.0,   tickSize: 5.0  },
  { symbol: 'MET', label: 'Micro Ether CME (MET)',    category: 'FUTURES_US', tickValue: 0.005,  tickSize: 0.05 },
  { symbol: 'ETH', label: 'Ether CME (ETH)',          category: 'FUTURES_US', tickValue: 2.5,    tickSize: 0.05 },
  // ── Forex Futures ─────────────────────────────────────────────────────────
  { symbol: '6E',  label: 'Euro FX (6E)',                    category: 'FUTURES_US', tickValue: 6.25,     tickSize: 0.00005   },
  { symbol: 'M6E', label: 'Micro Euro FX (M6E)',             category: 'FUTURES_US', tickValue: 0.625,    tickSize: 0.0001    },
  { symbol: '6B',  label: 'British Pound (6B)',              category: 'FUTURES_US', tickValue: 6.25,     tickSize: 0.0001    },
  { symbol: '6J',  label: 'Japanese Yen (6J)',               category: 'FUTURES_US', tickValue: 6.25,     tickSize: 0.0000005 },
  { symbol: '6A',  label: 'Australian Dollar (6A)',          category: 'FUTURES_US', tickValue: 10.0,     tickSize: 0.0001    },
  { symbol: '6C',  label: 'Canadian Dollar (6C)',            category: 'FUTURES_US', tickValue: 10.0,     tickSize: 0.0001    },
  { symbol: '6S',  label: 'Swiss Franc (6S)',                category: 'FUTURES_US', tickValue: 12.5,     tickSize: 0.0001    },
  // ── Crypto / Forex spot — tickValue null, FMP fournit labels ─────────────
  { symbol: 'BTC/USDT', label: 'Bitcoin (BTC/USDT)',  category: 'CRYPTO', tickValue: null },
  { symbol: 'ETH/USDT', label: 'Ethereum (ETH/USDT)', category: 'CRYPTO', tickValue: null },
  { symbol: 'SOL/USDT', label: 'Solana (SOL/USDT)',   category: 'CRYPTO', tickValue: null },
  { symbol: 'EUR/USD',  label: 'Euro / Dollar',        category: 'FOREX',  tickValue: null, pipDecimals: 4 },
  { symbol: 'GBP/USD',  label: 'Livre / Dollar',       category: 'FOREX',  tickValue: null, pipDecimals: 4 },
  { symbol: 'USD/JPY',  label: 'Dollar / Yen',         category: 'FOREX',  tickValue: null, pipDecimals: 2 },
];

export function getTickValue(symbol: string): number | null {
  return INSTRUMENTS.find(
    (i) => i.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.tickValue ?? null;
}

export function getTickSize(symbol: string): number | undefined {
  return INSTRUMENTS.find(
    (i) => i.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.tickSize;
}

export function getPipDecimals(symbol: string): number {
  return INSTRUMENTS.find(
    (i) => i.symbol.toUpperCase() === symbol.toUpperCase(),
  )?.pipDecimals ?? 4;
}
