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
import { DEMO_WINDOW_DAYS, INSTRUMENTS, SETUP_PROFILES, type SetupTitle, type Sym, round2 } from './config';

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
  asset: Sym;
  side: TradeSide;
  entry: number;
  exit: number;
  quantity: number;
  pnl: number;
  commission: number;
  session: TradingSession;
  timeframe: string;
  tradedAt: Date;
  setup: SetupTitle;
}

/**
 * Répartition réaliste des trades des comptes perdus, en rotations de longueurs différentes (les
 * combinaisons varient d'un trade à l'autre). Un compte perdu touche tous les setups, comme un vrai
 * trader : tout mettre sur Breakout le faisait chuter quand l'interrupteur « Inclure les comptes
 * échoués et archivés » est activé.
 * - setups : proches des parts du profil (`SETUP_PROFILES`) : Scalping 3/10, Pullback et Breakout
 *   2/10, Range, Reversal et News 1/10 ;
 * - actifs : micros surtout (MNQ 4/10, MES 3/10), quelques minis (NQ 2/10, ES 1/10) ;
 * - heures (UTC) : séance de New York à différents moments, et un trade de séance de Londres.
 */
const LOST_SETUPS: readonly SetupTitle[] = [
  'Scalping', 'Pullback', 'Breakout', 'Range', 'Scalping', 'Reversal', 'Pullback', 'News', 'Breakout', 'Scalping',
];
const LOST_ASSETS: readonly Sym[] = ['MNQ', 'MES', 'MNQ', 'NQ', 'MES', 'MNQ', 'ES', 'MES', 'MNQ', 'NQ'];
const LOST_TIMES: readonly { h: number; m: number; session: TradingSession }[] = [
  { h: 13, m: 42, session: TradingSession.NEW_YORK },
  { h: 14, m: 15, session: TradingSession.NEW_YORK },
  { h: 15, m: 3, session: TradingSession.NEW_YORK },
  { h: 17, m: 47, session: TradingSession.NEW_YORK },
  { h: 8, m: 35, session: TradingSession.LONDON },
  { h: 18, m: 20, session: TradingSession.NEW_YORK },
  { h: 14, m: 37, session: TradingSession.NEW_YORK },
  { h: 19, m: 12, session: TradingSession.NEW_YORK },
];

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
 * Trades des comptes perdus : un par jour ouvré, tous avant la fenêtre de génération. Prix cohérents
 * avec le P&L (2 micros ou 1 mini, frais réels de l'instrument). Déterministe : même `now` → mêmes trades.
 */
export function buildLostDemoTrades(now: Date): LostDemoTrade[] {
  const trades: LostDemoTrade[] = [];
  // Comptes successifs, du plus ancien au plus récent : Lucid, puis Apex #1.
  const order: LostDemoAccount['key'][] = ['lucidArchived', 'apexFailed'];
  const total = LOST_DEMO_ACCOUNTS.reduce((n, a) => n + a.pnls.length, 0);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (DEMO_WINDOW_DAYS + 7));
  start.setUTCHours(12, 0, 0, 0);
  const days = weekdaysBefore(start, total);
  let i = 0;
  for (const key of order) {
    const acct = LOST_DEMO_ACCOUNTS.find((a) => a.key === key)!;
    for (const pnl of acct.pnls) {
      const asset = LOST_ASSETS[i % LOST_ASSETS.length];
      const setup = LOST_SETUPS[i % LOST_SETUPS.length];
      const time = LOST_TIMES[i % LOST_TIMES.length];
      const { base, ptVal, fee } = INSTRUMENTS[asset];
      const quantity = asset === 'MNQ' || asset === 'MES' ? 2 : 1;
      const side = i % 3 === 1 ? TradeSide.SHORT : TradeSide.LONG;
      const points = pnl / (ptVal * quantity);
      const entry = base + (i % 7) * 12.5;
      const exit = round2(side === TradeSide.LONG ? entry + points : entry - points);
      const tradedAt = new Date(days[i]);
      tradedAt.setUTCHours(time.h, time.m, 0, 0);
      trades.push({
        account: key, asset, side, entry, exit, quantity, pnl,
        commission: round2(fee * quantity), session: time.session, timeframe: SETUP_PROFILES[setup].tf,
        tradedAt, setup,
      });
      i++;
    }
  }
  return trades;
}
