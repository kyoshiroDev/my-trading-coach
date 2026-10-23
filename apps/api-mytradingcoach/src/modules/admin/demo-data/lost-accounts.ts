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
  /** P&L brut de chaque trade, un par jour ouvré, dans l'ordre chronologique. */
  pnls: number[];
  /**
   * Dernière séance, de plusieurs trades (MNQ), le jour ouvré suivant le dernier de `pnls` : celle
   * où le plancher est franchi, que montre l'autopsie (#669). Heures UTC.
   */
  lastSession?: { pnl: number; quantity: number; h: number; m: number }[];
}

export const LOST_DEMO_ACCOUNTS: LostDemoAccount[] = [
  {
    // Première tentative de l'Apex 50k : plancher franchi sur la dernière séance (-2 130 $ brut au
    // total pour un drawdown de 2 000 $, plancher suiveur remonté de 470 $). Le compte Apex actif
    // (« Apex 50k · Éval #2 ») en est la nouvelle tentative.
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
    pnls: [320, -260, 410, -540, -180, 260, -620, -390, 150, -50],
    // Séance de l'autopsie : 3 trades à 2 contrats, alerte « pertes d'affilée », puis 2 trades à 4
    // contrats ; le dernier fait passer la marge estimée sous zéro.
    lastSession: [
      { pnl: 80, quantity: 2, h: 13, m: 34 },
      { pnl: -140, quantity: 2, h: 13, m: 58 },
      { pnl: -160, quantity: 2, h: 14, m: 21 },
      { pnl: -330, quantity: 4, h: 14, m: 49 },
      { pnl: -600, quantity: 4, h: 15, m: 12 },
    ],
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
  const total = LOST_DEMO_ACCOUNTS.reduce((n, a) => n + a.pnls.length + (a.lastSession ? 1 : 0), 0);
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
    // Dernière séance (plusieurs trades MNQ le même jour), sur le jour ouvré suivant.
    if (acct.lastSession) {
      const day = days[i];
      const { base, ptVal, fee } = INSTRUMENTS.MNQ;
      acct.lastSession.forEach((t, j) => {
        const side = j % 2 === 0 ? TradeSide.LONG : TradeSide.SHORT;
        const points = t.pnl / (ptVal * t.quantity);
        const entry = base + j * 12.5;
        const tradedAt = new Date(day);
        tradedAt.setUTCHours(t.h, t.m, 0, 0);
        trades.push({
          account: key, asset: 'MNQ', side, entry, exit: round2(side === TradeSide.LONG ? entry + points : entry - points),
          quantity: t.quantity, pnl: t.pnl, commission: round2(fee * t.quantity), session: TradingSession.NEW_YORK,
          timeframe: SETUP_PROFILES[LOST_SETUPS[(i + j) % LOST_SETUPS.length]].tf,
          tradedAt, setup: LOST_SETUPS[(i + j) % LOST_SETUPS.length],
        });
      });
      i++;
    }
  }
  return trades;
}

/**
 * Texte d'analyse préenregistré de l'autopsie démo : un exemple, jamais un appel IA (#669). Montants
 * NETS (frais déduits), comme la chronologie de la page : `demo-incident.spec.ts` le vérifie.
 */
export const DEMO_INCIDENT_ANALYSIS =
  "D'après tes trades enregistrés, la séance se décompose en deux phases : trois trades à 2 contrats " +
  '(+$78, -$142, -$162), puis deux entrées à 4 contrats après deux pertes d\'affilée.\n\n' +
  "L'alerte de MyTradingCoach sur les pertes d'affilée a précédé les deux plus grosses pertes de la " +
  'séance, et la marge estimée est passée sous le plancher sur le dernier trade.';

export interface LostDemoIncident {
  /** Journée de la séance de casse, `AAAA-MM-JJ`. */
  day: string;
  snapshot: { limit: number; remaining: number; floor: number; detectedAt: string };
  /** Alerte anti-tilt enregistrée pendant la séance. */
  alert: { at: Date; type: string; message: string };
  /** Paliers de marge drawdown franchis pendant la séance (journal de risque). */
  propEvents: { at: Date; level: 'warning' | 'critical' | 'breached'; remaining: number }[];
  aiGeneratedAt: Date;
}

/**
 * Autopsie d'exemple du compte échoué (#669), calculée sur SES trades : plancher suiveur fin de
 * journée (plus haut des clôtures − drawdown), marge estimée après chaque trade de la dernière
 * séance, paliers 25 % / 10 % / dépassé, et l'alerte « pertes d'affilée » posée entre les deux
 * phases. Null si le compte n'a pas de dernière séance.
 */
export function buildLostDemoIncident(trades: LostDemoTrade[], dayOf: (at: Date) => string): LostDemoIncident | null {
  const acct = LOST_DEMO_ACCOUNTS.find((a) => a.key === 'apexFailed');
  if (!acct?.lastSession) return null;
  const own = trades.filter((t) => t.account === 'apexFailed').sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const session = own.slice(-acct.lastSession.length);
  const before = own.slice(0, own.length - session.length);
  const net = (t: LostDemoTrade) => t.pnl - t.commission;
  // Un trade par jour avant la séance : chaque cumul est une clôture de journée.
  let cum = 0;
  let peak = 0;
  for (const t of before) {
    cum += net(t);
    peak = Math.max(peak, cum);
  }
  const floor = round2(acct.startingBalance + peak - acct.maxDrawdown);
  let margin = acct.startingBalance + cum - floor;
  const propEvents: LostDemoIncident['propEvents'] = [];
  const rank = { warning: 1, critical: 2, breached: 3 } as const;
  let sent = 0;
  for (const t of session) {
    margin += net(t);
    const level = margin <= 0 ? 'breached' : margin <= 0.1 * acct.maxDrawdown ? 'critical' : margin <= 0.25 * acct.maxDrawdown ? 'warning' : null;
    if (level && rank[level] > sent) {
      sent = rank[level];
      propEvents.push({ at: new Date(t.tradedAt.getTime() + 60_000), level, remaining: round2(margin) });
    }
  }
  const last = session[session.length - 1].tradedAt;
  const detectedAt = new Date(last.getTime() + 60_000);
  // Entre le 3e et le 4e trade : après deux pertes d'affilée.
  const alertAt = new Date(session[3].tradedAt.getTime() - 5 * 60_000);
  return {
    day: dayOf(session[0].tradedAt),
    snapshot: { limit: acct.maxDrawdown, remaining: round2(margin), floor, detectedAt: detectedAt.toISOString() },
    alert: { at: alertAt, type: 'C1_LOSS_STREAK', message: "Nouvelle entrée après 2 pertes d'affilée dans la séance." },
    propEvents,
    aiGeneratedAt: new Date(detectedAt.getTime() + 8 * 60_000),
  };
}
