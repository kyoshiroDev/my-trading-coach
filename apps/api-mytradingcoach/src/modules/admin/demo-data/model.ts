// Modèle du jeu de données démo (trades, journées, stats) et critères de crédibilité (meetsTargets).
import { TradeSide, EmotionState, TradingSession, MoodState, ExecutionGrade, ExecutionMethod } from '@prisma/client';
import { computeTradeStats } from '@mtc/shared';
import { type AccountKey, DEMO_ACCOUNTS, SETUP_PROFILES, type SetupTitle, type Sym, round2 } from './config';

// ── Modèle généré (pur, sans base) ─────────────────────────────────────────

export interface DemoTrade {
  account: AccountKey;
  asset: Sym;
  setup: SetupTitle;
  side: TradeSide;
  entry: number;
  exit: number;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  quantity: number;
  /** P&L BRUT (convention : les frais sont dans `commission`). */
  pnl: number;
  commission: number;
  emotion: EmotionState | null;
  timeframe: string;
  session: TradingSession;
  tradedAt: Date;
  notes: string | null;
  daysAgo: number;
  executionScore: number | null;
  executionGrade: ExecutionGrade | null;
  executionMethod: ExecutionMethod | null;
}

export interface DemoDay {
  daysAgo: number;
  account: AccountKey;
  moodStart: MoodState;
  moodEnd: MoodState;
  kind: 'normal' | 'revenge' | 'yesterday' | 'today';
  trades: DemoTrade[];
}

export interface DemoStats {
  trades: number;
  tradingDays: number;
  redDays: number;
  winRateNet: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  bySetup: Record<string, { trades: number; winRateNet: number; grossPnl: number; netPnl: number }>;
  byAccount: Record<string, { trades: number; netPnl: number; worstDrawdown: number }>;
}

export const net = (t: { pnl: number; commission: number }) => t.pnl - t.commission;

export function statsOf(days: DemoDay[]): DemoStats {
  const all = days.flatMap((d) => d.trades);
  const st = computeTradeStats(all);
  const bySetup: DemoStats['bySetup'] = {};
  for (const s of Object.keys(SETUP_PROFILES)) {
    const ts = all.filter((t) => t.setup === s);
    bySetup[s] = {
      trades: ts.length,
      winRateNet: round2(computeTradeStats(ts).winRate),
      grossPnl: round2(ts.reduce((a, t) => a + t.pnl, 0)),
      netPnl: round2(ts.reduce((a, t) => a + net(t), 0)),
    };
  }
  const byAccount: DemoStats['byAccount'] = {};
  for (const a of DEMO_ACCOUNTS) {
    const ts = all.filter((t) => t.account === a.key).sort((x, y) => x.tradedAt.getTime() - y.tradedAt.getTime());
    let bal = 0, hwm = 0, worst = 0;
    for (const t of ts) { bal += net(t); hwm = Math.max(hwm, bal); worst = Math.max(worst, hwm - bal); }
    byAccount[a.key] = { trades: ts.length, netPnl: round2(bal), worstDrawdown: round2(worst) };
  }
  const dayNets = days.filter((d) => d.trades.length).map((d) => d.trades.reduce((a, t) => a + net(t), 0));
  return {
    trades: all.length,
    tradingDays: dayNets.length,
    redDays: dayNets.filter((n) => n < 0).length,
    winRateNet: round2(st.winRate),
    grossPnl: round2(all.reduce((a, t) => a + t.pnl, 0)),
    fees: round2(all.reduce((a, t) => a + t.commission, 0)),
    netPnl: round2(st.totalPnl),
    bySetup,
    byAccount,
  };
}

/** Contraintes de crédibilité validées avec Greg. */
const maxDrawdownOf = (key: AccountKey) => DEMO_ACCOUNTS.find((a) => a.key === key)!.maxDrawdown;

export function meetsTargets(s: DemoStats): boolean {
  const red = s.redDays / s.tradingDays;
  const setups = s.bySetup;
  const wr = (k: SetupTitle) => setups[k].winRateNet;
  return (
    s.trades >= 70 && s.trades <= 95 &&
    s.winRateNet >= 52 && s.winRateNet <= 57 &&
    red >= 0.35 && red <= 0.45 &&
    s.grossPnl >= 1_200 && s.grossPnl <= 1_800 &&
    s.netPnl >= 650 && s.netPnl <= 1_150 &&
    s.fees >= 470 && s.fees <= 700 &&
    // Scalping : positif en brut, négatif en net (les frais mangent l'edge).
    setups['Scalping'].grossPnl > 0 && setups['Scalping'].netPnl < 0 &&
    // Breakout = meilleur edge, Reversal = setup perdant.
    wr('Breakout') >= Math.max(wr('Pullback'), wr('Range'), wr('Reversal'), wr('News')) &&
    wr('Reversal') <= Math.min(wr('Breakout'), wr('Pullback'), wr('Range'), wr('News')) &&
    setups['Reversal'].netPnl < 0 &&
    // Éval Apex EN COURS : positive, loin de l'objectif ; drawdown visible, loin du seuil.
    s.byAccount['apex'].netPnl > 0 && s.byAccount['apex'].netPnl < 3_000 * 0.8 &&
    s.byAccount['apex'].worstDrawdown >= 350 && s.byAccount['apex'].worstDrawdown < maxDrawdownOf('apex') * 0.5 &&
    // Funded Tradeify : jamais au bord de la liquidation.
    s.byAccount['tradeify'].trades >= 12 && s.byAccount['tradeify'].worstDrawdown < maxDrawdownOf('tradeify') * 0.5
  );
}

