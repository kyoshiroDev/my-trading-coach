// Comptes « perdus » du compte démo (fonctionnalité compte perdu) : un compte ÉCHOUÉ dont le compte
// Apex actif est la nouvelle tentative, et un compte ARCHIVÉ. Ils montrent la ligne « 2 comptes exclus
// des chiffres » et l'interrupteur des statistiques. Pas de compte VALIDÉ : il serait compté dans les
// chiffres et changerait ceux de la vitrine (décision du 2026-10-21 ; le statut Validé est couvert par
// les tests unitaires et d'intégration).
//
// Contrat de cohérence de `config.ts` préservé : aucun de ces comptes n'est ACTIVE, donc
// Σ startingBalance des comptes ACTIVE === STARTING_CAPITAL. Leurs trades tombent AVANT la fenêtre
// de génération (`DEMO_WINDOW_DAYS`) : récaps, débriefs, journal de risque et vue « 1M » du tableau
// de bord ne bougent pas. Module pur (aucun service Nest) : chargé tel quel par `seed:demo` sous tsx.
import { AccountStatus, AccountType, DrawdownType, TradeSide, TradingSession } from '@prisma/client';
import { DEMO_WINDOW_DAYS, INSTRUMENTS, round2 } from './config';

export interface LostDemoAccount {
  key: 'apexFailed' | 'lucidArchived';
  label: string;
  broker: string;
  type: AccountType;
  status: AccountStatus;
  accountSize: number;
  startingBalance: number;
  profitTarget: number;
  maxDrawdown: number;
  drawdownType: DrawdownType;
  propFirmPlanId: string;
  /** P&L brut de chaque trade, dans l'ordre chronologique. */
  pnls: number[];
}

export const LOST_DEMO_ACCOUNTS: LostDemoAccount[] = [
  {
    // Première tentative de l'Apex 50k : plancher dépassé (-2 210 $ pour un drawdown de 2 000 $).
    // Le compte Apex actif (« Apex 50k · Éval #2 ») en est la nouvelle tentative.
    key: 'apexFailed',
    label: 'Apex 50k · Éval #1',
    broker: 'Apex Trader Funding',
    type: AccountType.EVALUATION,
    status: AccountStatus.FAILED,
    accountSize: 50_000,
    startingBalance: 50_000,
    profitTarget: 3_000,
    maxDrawdown: 2_000,
    drawdownType: DrawdownType.TRAILING,
    propFirmPlanId: 'apex-eod-50k',
    pnls: [320, -260, 410, -540, -180, 260, -620, -390, 150, -480, -330, -550],
  },
  {
    // Ancien compte rangé : archivé, hors statistiques, historique consultable à part.
    key: 'lucidArchived',
    label: 'Lucid 25k · Flex',
    broker: 'Lucid Trading',
    type: AccountType.EVALUATION,
    status: AccountStatus.ARCHIVED,
    accountSize: 25_000,
    startingBalance: 25_000,
    profitTarget: 1_250,
    maxDrawdown: 1_000,
    drawdownType: DrawdownType.TRAILING,
    propFirmPlanId: 'lucid-flex-25k',
    pnls: [180, -240, 90, -310, 150, -120, -260, 60],
  },
];

export interface LostDemoTrade {
  account: LostDemoAccount['key'];
  asset: 'MNQ';
  side: TradeSide;
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  commission: number;
  session: TradingSession;
  timeframe: string;
  tradedAt: Date;
}

/** Jours ouvrés (lundi → vendredi) en remontant le temps à partir de `from`. */
function weekdaysBefore(from: Date, count: number): Date[] {
  const out: Date[] = [];
  const d = new Date(from);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

/**
 * Trades des comptes perdus : un par jour ouvré, à 15:30 UTC (séance de New York), tous avant la
 * fenêtre de génération. Prix cohérents avec le P&L (MNQ, 2 contrats, frais réels). Déterministe :
 * même `now` → mêmes trades.
 */
export function buildLostDemoTrades(now: Date): LostDemoTrade[] {
  const { base, ptVal, fee } = INSTRUMENTS.MNQ;
  const quantity = 2;
  const trades: LostDemoTrade[] = [];
  // Comptes successifs, du plus ancien au plus récent : Lucid, puis Apex #1.
  const order: LostDemoAccount['key'][] = ['lucidArchived', 'apexFailed'];
  const total = LOST_DEMO_ACCOUNTS.reduce((n, a) => n + a.pnls.length, 0);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (DEMO_WINDOW_DAYS + 7));
  start.setUTCHours(15, 30, 0, 0);
  const days = weekdaysBefore(start, total);
  let i = 0;
  for (const key of order) {
    const acct = LOST_DEMO_ACCOUNTS.find((a) => a.key === key)!;
    for (const pnl of acct.pnls) {
      const side = i % 2 === 0 ? TradeSide.LONG : TradeSide.SHORT;
      const points = pnl / (ptVal * quantity);
      const entry = base + (i % 7) * 12.5;
      const exit = round2(side === TradeSide.LONG ? entry + points : entry - points);
      trades.push({
        account: key, asset: 'MNQ', side, entry, exit, quantity, pnl,
        commission: round2(fee * quantity), session: TradingSession.NEW_YORK, timeframe: '5m',
        tradedAt: days[i],
      });
      i++;
    }
  }
  return trades;
}
