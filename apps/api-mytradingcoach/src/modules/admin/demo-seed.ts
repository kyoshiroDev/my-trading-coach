import {
  PrismaClient, Plan, TradeSide, EmotionState,
  TradingSession, MoodState, SessionStatus,
  AccountType, AccountStatus, DrawdownType,
  BrokerProvider, BrokerConnectionStatus,
  ExecutionGrade, ExecutionMethod,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { computeTradeStats, formatMoney } from '@mtc/shared';
import { seedDefaultSetups } from '../setups/setups.defaults';
import {
  BEHAVIORAL_MIN_TRADES,
  computeBehavioralGrade,
  computeExecutionGrade,
  median,
} from '../../common/utils/execution-grade.util';

/**
 * Seed du compte DÉMO vitrine (landing + formateurs) : source de vérité unique, utilisée par
 * l'endpoint admin, le cron quotidien (DemoSeedCron) et le script standalone.
 *
 * Objectif (PROMPT-215) : un trader RÉALISTE, pas un gagnant parfait. Deux comptes prop firm en
 * USD, futures d'indices US uniquement (MES / MNQ / ES / NQ), jours ouvrés, frais réels qui
 * pèsent sur le net, ~40 % de journées rouges, une journée de revenge trading, des setups aux
 * résultats contrastés (dont un Scalping positif en brut mais NÉGATIF en net).
 *
 * - IDEMPOTENT : upsert du user + purge/recréation de SES données uniquement (scopé userId démo).
 * - Dates RELATIVES au moment du run (`now`) : après le cron de 03:20, la session du jour est
 *   aujourd'hui, le récap est hier ; rien n'est ré-ancré dans le passé. Les trades du jour sont
 *   placés AVANT `now` (jamais dans le futur, même quand le seed tourne à 03:20).
 * - Déterministe : PRNG seedé, puis recherche du premier tirage qui respecte les contraintes de
 *   crédibilité (`meetsTargets`) ; même `now` → mêmes données.
 */

export const DEMO_EMAIL = 'demo@mytradingcoach.app';
const DEMO_NAME = 'Lucas Mercier';

/** Fenêtre de génération : 6 semaines (la vue « 1M » par défaut du dashboard reste pleine). */
export const DEMO_WINDOW_DAYS = 42;

/**
 * Deux comptes prop firm en USD. Contrat de cohérence, à ne pas casser :
 *   Σ startingBalance des comptes ACTIVE === STARTING_CAPITAL (50 000 + 50 000)
 * (`dashboard.baseCapital` et `accounts.trackedCapital` somment les `startingBalance`).
 *
 * Règles = celles publiées par les firmes pour ce palier, à titre indicatif : l'app ESTIME marge
 * et pacing depuis les trades loggés (disclaimer affiché), elle ne reproduit pas leur calcul.
 */
const DEMO_ACCOUNTS = [
  {
    key: 'apex' as const,
    label: 'Apex 50k · Éval',
    broker: 'Apex',
    type: AccountType.EVALUATION,
    accountSize: 50_000,
    startingBalance: 50_000,
    profitTarget: 3_000,
    maxDrawdown: 2_500,
    drawdownType: DrawdownType.TRAILING,
  },
  {
    key: 'tradeify' as const,
    label: 'Tradeify 50k · Funded',
    broker: 'Tradeify',
    type: AccountType.FUNDED,
    accountSize: 50_000,
    startingBalance: 50_000,
    profitTarget: null,
    maxDrawdown: 2_000,
    drawdownType: DrawdownType.TRAILING,
  },
];
type AccountKey = (typeof DEMO_ACCOUNTS)[number]['key'];
const STARTING_CAPITAL = DEMO_ACCOUNTS.reduce((s, a) => s + a.startingBalance, 0);

/** Futures d'indices US : $ par point, frais aller-retour par contrat (commission + exchange + NFA). */
const INSTRUMENTS = {
  MNQ: { base: 19_850, ptVal: 2, fee: 1.24, stop: [10, 20] },
  MES: { base: 5_620, ptVal: 5, fee: 1.24, stop: [3, 6] },
  NQ: { base: 19_850, ptVal: 20, fee: 4.5, stop: [8, 15] },
  ES: { base: 5_620, ptVal: 50, fee: 4.5, stop: [2.5, 5] },
} as const;
type Sym = keyof typeof INSTRUMENTS;
const TICK = 0.25;

/**
 * Profils de setups : win rate BRUT visé, sortie gagnante / perdante en multiples du stop, part
 * des trades avec stop. Contrastés volontairement : Breakout est l'edge du trader, Reversal le
 * perd, et Scalping gagne en brut mais perd en net (petits gains, frais sur 6 contrats).
 */
const SETUP_PROFILES = {
  Breakout: { share: 0.17, wr: 0.64, win: [1.3, 2.0], loss: [0.7, 1.0], stopRate: 0.8, tf: '5m' },
  Pullback: { share: 0.2, wr: 0.6, win: [1.1, 1.8], loss: [0.7, 1.0], stopRate: 0.8, tf: '5m' },
  Range: { share: 0.15, wr: 0.47, win: [0.9, 1.4], loss: [0.7, 1.0], stopRate: 0.7, tf: '15m' },
  Reversal: { share: 0.12, wr: 0.4, win: [1.2, 2.0], loss: [0.8, 1.1], stopRate: 0.7, tf: '15m' },
  News: { share: 0.1, wr: 0.52, win: [1.2, 2.4], loss: [0.8, 1.35], stopRate: 0.6, tf: '1m' },
  Scalping: { share: 0.26, wr: 0.62, win: [0.35, 0.6], loss: [0.4, 0.7], stopRate: 0.2, tf: '1m' },
} as const;
type SetupTitle = keyof typeof SETUP_PROFILES;

// PRNG déterministe (mulberry32).
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;
const between = (r: Rand, [a, b]: readonly [number, number] | readonly number[]) => a + r() * (b - a);
const toTick = (v: number) => Math.max(TICK, Math.round(v / TICK) * TICK);
const round2 = (v: number) => Math.round(v * 100) / 100;
const pick = <T>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

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
  /** P&L BRUT (convention PROMPT-213 : les frais sont dans `commission`). */
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

const net = (t: { pnl: number; commission: number }) => t.pnl - t.commission;

function statsOf(days: DemoDay[]): DemoStats {
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

/** Contraintes de crédibilité validées avec Greg (PROMPT-215). */
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
    s.byAccount['apex'].worstDrawdown >= 350 && s.byAccount['apex'].worstDrawdown < 2_500 * 0.5 &&
    // Funded Tradeify : jamais au bord de la liquidation.
    s.byAccount['tradeify'].trades >= 12 && s.byAccount['tradeify'].worstDrawdown < 2_000 * 0.5
  );
}

// ── Banques de textes (réalistes, sans promesse de gain) ───────────────────

const PLANS = [
  "Plan : attendre la prise de liquidité de l'ouverture, breakout MNQ seulement si clôture M5 au-dessus du range. 3 trades max.",
  "Plan : tendance haussière H1 sur ES, je cherche des pullbacks vers le VWAP. Stop sous le dernier creux, R:R ≥ 1.5.",
  "Plan : journée de stats US à 14h30. Aucun trade 5 min avant, je trade la réaction seulement si le range est cassé proprement.",
  "Plan : marché en range depuis hier. Je vends le haut / j'achète le bas du range, taille réduite, 2 trades max.",
  "Plan : pas de conviction sur la direction. Je reste sur MES en petite taille et je coupe vite si ça ne part pas.",
];
const REFLECTIONS_GREEN = [
  "Plan suivi, perte coupée tôt et gagnant laissé courir. C'est ce schéma que je veux répéter.",
  "Journée correcte mais les frais du scalping ont mangé une bonne partie du gain. Moins de scalps, plus de setups A+.",
  "Bonne patience à l'ouverture : j'ai attendu la confirmation au lieu d'anticiper.",
];
const REFLECTIONS_RED = [
  "Journée rouge mais pertes contrôlées : tous les stops respectés. Le setup Reversal ne marche pas en tendance.",
  "J'ai forcé des entrées dans un range sans direction. Je dois accepter les journées sans trade.",
  "Deux pertes de suite puis j'ai arrêté comme prévu. Rouge, mais discipliné.",
];
const REFLECTION_REVENGE =
  "Mauvaise journée : après la première perte j'ai voulu me refaire tout de suite, deux entrées en moins de 2 minutes avec une taille doublée et sans stop. C'est exactement ce que je ne dois plus faire. Règle ajoutée : 15 minutes de pause après une perte.";
const NOTES_WIN = [
  'Entrée sur retest, sortie au niveau prévu.',
  'Setup A+ : confirmation M5 + volume. Laissé courir jusqu’à la cible.',
  'Entré un peu tard mais géré proprement.',
];
const NOTES_LOSS = [
  'Faux breakout, stop touché. Setup valide, résultat négatif : ça arrive.',
  'Entrée contre la tendance H1, à éviter.',
  'Coupé avant le stop, le momentum était parti.',
];
const ONELINERS = {
  green: [
    "Journée verte et propre : tes gains viennent de tes setups A+, pas du volume de trades.",
    "Bonne sélection : tu as évité les entrées moyennes. Continue à attendre la confirmation.",
  ],
  red: [
    "Journée rouge maîtrisée : pertes coupées, taille constante. Une perte contrôlée n'est pas une faute.",
    "Le range t'a piégé deux fois : sans direction claire, réduis la taille ou reste dehors.",
  ],
  revenge: ["Deux trades en 2 minutes après une perte, taille doublée : c'est du revenge trading. Impose-toi une pause après chaque perte."],
  fees: ["Journée légèrement positive en brut mais les frais la ramènent à plat : moins de scalps, plus de qualité."],
};

// ── Génération ─────────────────────────────────────────────────────────────

function sessionOf(hour: number): TradingSession {
  if (hour < 8) return TradingSession.ASIAN;
  if (hour < 14) return TradingSession.LONDON;
  return TradingSession.NEW_YORK;
}

function buildTrade(
  r: Rand,
  o: {
    account: AccountKey; setup: SetupTitle; win: boolean; asset: Sym; quantity: number;
    at: Date; daysAgo: number; moodStart: MoodState; forceNoStop?: boolean; lossMult?: number;
    emotion?: EmotionState | null;
  },
): DemoTrade {
  const inst = INSTRUMENTS[o.asset];
  const prof = SETUP_PROFILES[o.setup];
  const stopPts = toTick(between(r, inst.stop) * (o.setup === 'Scalping' ? 0.4 : 1));
  const mult = o.win ? between(r, prof.win) : (o.lossMult ?? between(r, prof.loss));
  const points = toTick(stopPts * mult);
  const side: TradeSide = r() < 0.6 ? TradeSide.LONG : TradeSide.SHORT;
  const dir = side === TradeSide.LONG ? 1 : -1;
  const entry = toTick(inst.base * (1 + (r() - 0.5) * 0.03));
  const exit = entry + dir * (o.win ? points : -points);
  const withStop = !o.forceNoStop && r() < prof.stopRate;
  const targetPts = toTick(stopPts * prof.win[1]);
  const stopLoss = withStop ? entry - dir * stopPts : null;
  const takeProfit = withStop ? entry + dir * targetPts : null;
  const riskReward = withStop ? Math.round((targetPts / stopPts) * 10) / 10 : null;
  const pnl = round2((exit - entry) * dir * inst.ptVal * o.quantity);
  const emotion =
    o.emotion !== undefined ? o.emotion
      : r() < 0.3 ? (o.win ? pick(r, ['CONFIDENT', 'FOCUSED'] as EmotionState[]) : pick(r, ['STRESSED', 'FEAR'] as EmotionState[]))
        : null;
  const notes = r() < 0.3 ? pick(r, o.win ? NOTES_WIN : NOTES_LOSS) : null;
  return {
    account: o.account, asset: o.asset, setup: o.setup, side, entry, exit, stopLoss, takeProfit,
    riskReward, quantity: o.quantity, pnl, commission: round2(inst.fee * o.quantity), emotion,
    timeframe: prof.tf, session: sessionOf(o.at.getHours()), tradedAt: o.at, notes,
    daysAgo: o.daysAgo, executionScore: null, executionGrade: null, executionMethod: null,
  };
}

/** Date `daysAgo` jours avant `now`, à hh:mm locales. */
function dayAt(now: Date, daysAgo: number, hour: number, minute: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function assetFor(r: Rand, setup: SetupTitle): Sym {
  if (setup === 'Scalping') return r() < 0.6 ? 'MNQ' : 'MES';
  const x = r();
  return x < 0.45 ? 'MNQ' : x < 0.8 ? 'MES' : x < 0.9 ? 'NQ' : 'ES';
}
function quantityFor(r: Rand, asset: Sym, setup: SetupTitle): number {
  if (asset === 'NQ' || asset === 'ES') return 1;
  if (setup === 'Scalping') return 6;
  return 3 + Math.floor(r() * 3); // 3 à 5 micros
}

function generate(now: Date, seed: number): DemoDay[] {
  const r = rng(seed);
  // Jours ouvrés J-2..J-42 ; J-1 et J-0 sont construits à part (carte « Hier », session live).
  const weekdays: number[] = [];
  for (let d = DEMO_WINDOW_DAYS; d >= 2; d--) {
    const wd = dayAt(now, d, 12, 0).getDay();
    if (wd !== 0 && wd !== 6) weekdays.push(d);
  }
  // Journée de revenge : premier jour ouvré à ~3 semaines.
  const revengeDay = weekdays.find((d) => d <= 18) ?? weekdays[Math.floor(weekdays.length / 2)];
  const normalDays = weekdays.filter((d) => d !== revengeDay);

  // Nombre de trades par jour (2 à 4), puis quotas exacts par setup (win rate maîtrisé).
  const counts = normalDays.map(() => { const x = r(); return x < 0.4 ? 2 : x < 0.8 ? 3 : 4; });
  const total = counts.reduce((a, b) => a + b, 0);
  const setupsList = Object.keys(SETUP_PROFILES) as SetupTitle[];
  const pool: { setup: SetupTitle; win: boolean }[] = [];
  let remaining = total;
  setupsList.forEach((s, i) => {
    const n = i === setupsList.length - 1 ? remaining : Math.round(total * SETUP_PROFILES[s].share);
    remaining -= n;
    const wins = Math.round(n * SETUP_PROFILES[s].wr);
    for (let k = 0; k < n; k++) pool.push({ setup: s, win: k < wins });
  });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

  const days: DemoDay[] = [];
  const moods: MoodState[] = ['FOCUSED', 'CONFIDENT', 'NEUTRAL', 'TIRED', 'STRESSED'];
  let p = 0;
  normalDays.forEach((daysAgo, i) => {
    const account: AccountKey = r() < 0.3 ? 'tradeify' : 'apex';
    const moodStart = pick(r, moods);
    const ny = r() < 0.45;
    let minutes = (ny ? 15 * 60 + 32 : 9 * 60 + 5) + Math.floor(r() * 20);
    const trades: DemoTrade[] = [];
    for (let k = 0; k < counts[i]; k++) {
      const slot = pool[p++];
      const asset = assetFor(r, slot.setup);
      const at = slot.setup === 'News'
        ? dayAt(now, daysAgo, 14, 31 + Math.floor(r() * 8))
        : dayAt(now, daysAgo, Math.floor(minutes / 60), minutes % 60);
      trades.push(buildTrade(r, {
        account, setup: slot.setup, win: slot.win, asset, quantity: quantityFor(r, asset, slot.setup),
        at, daysAgo, moodStart,
      }));
      minutes += 25 + Math.floor(r() * 55);
    }
    trades.sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
    const dayNet = trades.reduce((a, t) => a + net(t), 0);
    days.push({
      daysAgo, account, moodStart, kind: 'normal', trades,
      moodEnd: dayNet >= 0 ? pick(r, ['CONFIDENT', 'FOCUSED'] as MoodState[]) : pick(r, ['NEUTRAL', 'TIRED', 'STRESSED'] as MoodState[]),
    });
  });

  // Journée de revenge (compte Apex, MNQ) : une perte, puis deux ré-entrées en < 2 min, taille doublée, sans stop.
  {
    const d = revengeDay;
    const t1 = buildTrade(r, { account: 'apex', setup: 'Range', win: false, asset: 'MNQ', quantity: 4, at: dayAt(now, d, 15, 41), daysAgo: d, moodStart: 'STRESSED', lossMult: 0.95, emotion: 'STRESSED' });
    const t2 = buildTrade(r, { account: 'apex', setup: 'Reversal', win: false, asset: 'MNQ', quantity: 8, at: dayAt(now, d, 15, 42), daysAgo: d, moodStart: 'STRESSED', forceNoStop: true, lossMult: 1.2, emotion: 'REVENGE' });
    const t3 = buildTrade(r, { account: 'apex', setup: 'Reversal', win: false, asset: 'MNQ', quantity: 8, at: dayAt(now, d, 15, 44), daysAgo: d, moodStart: 'STRESSED', forceNoStop: true, lossMult: 0.9, emotion: 'REVENGE' });
    t2.notes = 'Revenge : ré-entrée immédiate pour « récupérer » la perte, taille doublée, pas de stop.';
    days.push({ daysAgo: d, account: 'apex', moodStart: 'STRESSED', moodEnd: 'TIRED', kind: 'revenge', trades: [t1, t2, t3] });
  }

  // Hier (J-1) : journée propre, légèrement verte (carte « Hier » + récap).
  {
    const d = 1;
    const a = buildTrade(r, { account: 'apex', setup: 'Breakout', win: true, asset: 'MNQ', quantity: 3, at: dayAt(now, d, 9, 22), daysAgo: d, moodStart: 'FOCUSED', emotion: 'FOCUSED' });
    const b = buildTrade(r, { account: 'apex', setup: 'Pullback', win: false, asset: 'MES', quantity: 2, at: dayAt(now, d, 15, 47), daysAgo: d, moodStart: 'FOCUSED', lossMult: 0.75, emotion: null });
    days.push({ daysAgo: d, account: 'apex', moodStart: 'FOCUSED', moodEnd: 'CONFIDENT', kind: 'yesterday', trades: [a, b] });
  }

  // Aujourd'hui (J-0) : session ACTIVE, trades placés AVANT `now` (jamais dans le futur).
  {
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const clamp = (ms: number) => new Date(Math.max(startOfDay.getTime() + 5 * 60_000, ms));
    const a = buildTrade(r, { account: 'apex', setup: 'Breakout', win: true, asset: 'MNQ', quantity: 3, at: clamp(now.getTime() - 100 * 60_000), daysAgo: 0, moodStart: 'FOCUSED', emotion: 'CONFIDENT' });
    const b = buildTrade(r, { account: 'apex', setup: 'Scalping', win: true, asset: 'MES', quantity: 5, at: clamp(now.getTime() - 35 * 60_000), daysAgo: 0, moodStart: 'FOCUSED', forceNoStop: true, emotion: null });
    days.push({ daysAgo: 0, account: 'apex', moodStart: 'FOCUSED', moodEnd: 'CONFIDENT', kind: 'today', trades: [a, b] });
  }

  days.sort((x, y) => y.daysAgo - x.daysAgo);
  gradeAll(days);
  return days;
}

/** Note d'exécution, comme en prod : barème A (stop) par trade, barème B (comportemental) par compte. */
function gradeAll(days: DemoDay[]): void {
  const account = { startingBalance: 50_000, accountSize: 50_000 };
  for (const d of days) {
    for (const t of d.trades) {
      if (t.stopLoss == null) continue;
      const g = computeExecutionGrade(
        { side: t.side, entry: t.entry, exit: t.exit, stopLoss: t.stopLoss, takeProfit: t.takeProfit,
          riskReward: t.riskReward, emotion: t.emotion, tradeSession: { moodStart: d.moodStart } },
        account,
      );
      t.executionScore = g.score; t.executionGrade = g.grade;
      t.executionMethod = g.score != null ? ExecutionMethod.STOP_BASED : null;
    }
  }
  // Barème B : même algorithme que TradesService.recomputeBehavioralGrades (médianes par compte).
  for (const a of DEMO_ACCOUNTS) {
    const ts = days.flatMap((d) => d.trades).filter((t) => t.account === a.key)
      .sort((x, y) => x.tradedAt.getTime() - y.tradedAt.getTime());
    if (ts.length < BEHAVIORAL_MIN_TRADES) continue;
    const isLoss = (t: DemoTrade) => t.pnl < 0;
    const medianLoss = median(ts.filter(isLoss).map((t) => Math.abs(t.pnl)));
    const medianQuantity = median(ts.map((t) => t.quantity));
    ts.forEach((t, i) => {
      if (t.stopLoss != null) return;
      const day = t.tradedAt.toISOString().slice(0, 10);
      let lastSameDayLossAt: Date | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (ts[j].tradedAt.toISOString().slice(0, 10) !== day) break;
        if (isLoss(ts[j])) { lastSameDayLossAt = ts[j].tradedAt; break; }
      }
      const g = computeBehavioralGrade({
        pnl: t.pnl, quantity: t.quantity, tradedAt: t.tradedAt, medianLoss, medianQuantity,
        previousIsLoss: i > 0 && isLoss(ts[i - 1]), lastSameDayLossAt,
      });
      t.executionScore = g.score; t.executionGrade = g.grade;
      t.executionMethod = g.score != null ? ExecutionMethod.BEHAVIORAL : null;
    });
  }
}

/**
 * Jeu de données démo pour `now` : premier tirage (seeds successifs, déterministes) qui respecte
 * les contraintes de crédibilité. Pur (aucune base) : testé et affiché sans Prisma.
 */
export function buildDemoDataset(now: Date = new Date()): { days: DemoDay[]; stats: DemoStats; seed: number } {
  let last: { days: DemoDay[]; stats: DemoStats; seed: number } | null = null;
  for (let seed = 20260919; seed < 20260919 + 5_000; seed++) {
    const days = generate(now, seed);
    const stats = statsOf(days);
    last = { days, stats, seed };
    if (meetsTargets(stats)) return last;
  }
  return last!;
}

// ── Débriefs & récaps (texte dérivé des VRAIS chiffres générés) ────────────

function isoWeek(d: Date): { week: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}
const usd = (v: number) => formatMoney(v, 'USD', { decimals: 0 });

function setupRanking(trades: DemoTrade[]) {
  const by = new Map<string, number>();
  for (const t of trades) by.set(t.setup, (by.get(t.setup) ?? 0) + net(t));
  const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

const PROFILE = {
  isDemo: true, plan: Plan.PREMIUM, name: DEMO_NAME,
  onboardingCompleted: true, startingCapital: STARTING_CAPITAL,
  tradingStyle: 'Day trading', tradingStrategy: ['Price Action', 'ICT', 'Order Flow'],
  tradingSessions: ['LONDON', 'NEW_YORK'], tradesPerDayMin: 2, tradesPerDayMax: 4,
  strategyDescription: "Je trade les futures d'indices US (MNQ, MES, parfois NQ/ES) sur deux comptes prop firm. Breakouts et pullbacks sur l'ouverture de Londres et de New York. Règles : 4 trades max par jour, stop systématique, R:R minimum 1.5.",
  tradingAssets: ['MNQ', 'MES', 'NQ', 'ES'], favoriteAsset: 'MNQ',
  market: 'Futures', goal: 'Passer mon éval Apex sans casser mes règles',
  notificationsEmail: false, debriefAutomatic: false,
};

export interface DemoSeedResult {
  email: string; trades: number; winRate: number; pnl: number;
  grossPnl: number; fees: number; redDays: number; tradingDays: number;
  sessions: number; recaps: number; debriefs: number; accounts: number;
  bySetup: DemoStats['bySetup']; byAccount: DemoStats['byAccount'];
}

/** Seed/refresh complet du compte démo. `prisma` = PrismaService ou PrismaClient adapter. */
export async function seedDemo(prisma: PrismaClient, now: Date = new Date()): Promise<DemoSeedResult> {
  const { days, stats } = buildDemoDataset(now);
  const password = await argon2.hash(`demo-${Date.now()}-${Math.random()}`);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { ...PROFILE },
    create: { email: DEMO_EMAIL, password, ...PROFILE },
  });

  // Purge scopée (trades d'abord, FK session ; comptes APRÈS trades et sessions : onDelete SetNull).
  await prisma.trade.deleteMany({ where: { userId: user.id } });
  await prisma.tradeSession.deleteMany({ where: { userId: user.id } });
  await prisma.brokerConnection.deleteMany({ where: { userId: user.id } });
  await prisma.tradingAccount.deleteMany({ where: { userId: user.id } });
  await prisma.weeklyDebrief.deleteMany({ where: { userId: user.id } });
  await prisma.dailyRecap.deleteMany({ where: { userId: user.id } });

  const accountIdByKey = new Map<AccountKey, string>();
  for (const a of DEMO_ACCOUNTS) {
    const created = await prisma.tradingAccount.create({
      data: {
        userId: user.id, label: a.label, broker: a.broker, type: a.type,
        status: AccountStatus.ACTIVE, accountSize: a.accountSize,
        startingBalance: a.startingBalance, profitTarget: a.profitTarget,
        maxDrawdown: a.maxDrawdown, drawdownType: a.drawdownType, currency: 'USD',
      },
    });
    accountIdByKey.set(a.key, created.id);
  }

  await seedDefaultSetups(prisma, user.id);
  const demoSetups = await prisma.setup.findMany({ where: { userId: user.id }, select: { id: true, title: true } });
  const setupIdByTitle = new Map(demoSetups.map((s) => [s.title, s.id]));
  const setupIdFor = (title: string): string => setupIdByTitle.get(title) ?? demoSetups[0].id;

  // Sessions (une par jour de trading) + trades rattachés.
  let reflectionToggle = 0;
  for (const d of days) {
    if (!d.trades.length) continue;
    const first = d.trades[0].tradedAt, last = d.trades[d.trades.length - 1].tradedAt;
    const dayStats = computeTradeStats(d.trades);
    let cum = 0, peak = 0, maxDd = 0;
    for (const t of d.trades) { cum += net(t); peak = Math.max(peak, cum); maxDd = Math.min(maxDd, cum - peak); }
    const best = d.trades.reduce((a, b) => (net(b) > net(a) ? b : a));
    const green = dayStats.totalPnl >= 0;
    const reflection =
      d.kind === 'revenge' ? REFLECTION_REVENGE
        : d.kind === 'today' ? null
          : d.kind === 'yesterday' || reflectionToggle++ % 2 === 0
            ? (green ? REFLECTIONS_GREEN : REFLECTIONS_RED)[d.daysAgo % 3]
            : null;
    const isToday = d.kind === 'today';
    // Session du jour : jamais démarrée la veille, même si le seed tourne juste après minuit.
    const dayStart = new Date(first); dayStart.setHours(0, 0, 0, 0);
    const session = await prisma.tradeSession.create({
      data: {
        userId: user.id, accountId: accountIdByKey.get(d.account)!,
        startedAt: new Date(Math.max(dayStart.getTime(), first.getTime() - 25 * 60_000)),
        endedAt: isToday ? null : new Date(last.getTime() + 20 * 60_000),
        status: isToday ? SessionStatus.ACTIVE : SessionStatus.CLOSED,
        moodStart: d.moodStart, moodEnd: isToday ? null : d.moodEnd,
        planNote: PLANS[d.daysAgo % PLANS.length],
        reflectionNote: reflection,
        reflectionQuestion: "As-tu respecté ton plan de trading aujourd'hui ?",
        // Stats figées des sessions clôturées (le live du jour se calcule via getTodayTrades).
        ...(isToday ? {} : {
          totalPnl: dayStats.totalPnl, totalTrades: d.trades.length, winRate: dayStats.winRate,
          maxDrawdown: round2(maxDd), bestTradePnl: round2(net(best)), bestTradeAsset: best.asset,
        }),
      },
    });
    for (const t of d.trades) {
      await prisma.trade.create({
        data: {
          userId: user.id, accountId: accountIdByKey.get(t.account)!, sessionId: session.id,
          asset: t.asset, side: t.side, entry: t.entry, exit: t.exit,
          stopLoss: t.stopLoss, takeProfit: t.takeProfit, riskReward: t.riskReward,
          quantity: t.quantity, pnl: t.pnl, commission: t.commission, emotion: t.emotion,
          setupId: setupIdFor(t.setup), session: t.session, timeframe: t.timeframe,
          notes: t.notes, tags: ['DEMO'], tradedAt: t.tradedAt,
          executionScore: t.executionScore, executionGrade: t.executionGrade, executionMethod: t.executionMethod,
        },
      });
    }
  }

  // Récaps quotidiens (J-1 → J-42) : chiffres NETS du jour, phrase selon le type de journée.
  let recaps = 0;
  for (const d of days) {
    if (d.kind === 'today' || !d.trades.length) continue;
    const s = computeTradeStats(d.trades);
    const gross = d.trades.reduce((a, t) => a + t.pnl, 0);
    const line = d.kind === 'revenge' ? ONELINERS.revenge[0]
      : s.totalPnl < 0 ? ONELINERS.red[d.daysAgo % 2]
        : gross > 0 && s.totalPnl < 25 ? ONELINERS.fees[0]
          : ONELINERS.green[d.daysAgo % 2];
    const emo = new Map<string, number>();
    for (const t of d.trades) { const e = t.emotion ?? d.moodStart; emo.set(e, (emo.get(e) ?? 0) + 1); }
    const dominant = [...emo.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const date = dayAt(now, d.daysAgo, 0, 0);
    await prisma.dailyRecap.create({
      data: { userId: user.id, date, tradesCount: d.trades.length, pnl: s.totalPnl, winRate: s.winRate, dominantEmotion: dominant, aiOneLiner: line },
    });
    recaps++;
  }

  // Débriefs hebdo : une semaine ISO TERMINÉE = un débrief, textes calculés sur ses trades.
  const thisWeek = isoWeek(now);
  const weeks = new Map<string, { week: number; year: number; days: DemoDay[] }>();
  for (const d of days) {
    const w = isoWeek(dayAt(now, d.daysAgo, 12, 0));
    if (w.week === thisWeek.week && w.year === thisWeek.year) continue;
    const k = `${w.year}-${w.week}`;
    if (!weeks.has(k)) weeks.set(k, { ...w, days: [] });
    weeks.get(k)!.days.push(d);
  }
  let debriefs = 0;
  for (const w of weeks.values()) {
    const trades = w.days.flatMap((d) => d.trades);
    if (!trades.length) continue;
    const s = computeTradeStats(trades);
    const fees = trades.reduce((a, t) => a + t.commission, 0);
    const reds = w.days.filter((d) => d.trades.reduce((a, t) => a + net(t), 0) < 0).length;
    const { best, worst } = setupRanking(trades);
    const revenge = w.days.some((d) => d.kind === 'revenge');
    const summary =
      `Semaine ${s.totalPnl >= 0 ? 'positive' : 'négative'} : ${trades.length} trades, ${Math.round(s.winRate)} % de réussite nette, ` +
      `${usd(s.totalPnl)} net après ${usd(fees)} de frais. ${best[0]} reste ton meilleur setup (${usd(best[1])}), ` +
      `${worst[0]} te coûte ${usd(worst[1])}. ` +
      (revenge ? "La séance de revenge trading pèse lourd sur la semaine : c'est ta priorité n°1." : `${reds} journée(s) rouge(s), pertes globalement contrôlées.`);
    const strengths = [
      { badge: 'Force', text: `${best[0]} : ${usd(best[1])} net sur la semaine` },
      { badge: 'Force', text: 'Stops respectés sur la majorité des trades avec stop' },
    ];
    const weaknesses = [
      { badge: 'Attention', text: `${worst[0]} : ${usd(worst[1])} net, à réduire ou à supprimer` },
      revenge
        ? { badge: 'Discipline', text: 'Revenge trading : ré-entrées en moins de 2 minutes, taille doublée' }
        : { badge: 'Frais', text: `${usd(fees)} de frais : le scalping sur 5 contrats coûte plus qu'il ne rapporte` },
    ];
    const objectives = [
      { title: '15 minutes de pause après une perte', reason: 'Tes pires séquences commencent juste après une perte.' },
      { title: 'Réduire le scalping', reason: 'Positif en brut, négatif une fois les frais payés.' },
      { title: 'Stop systématique sur chaque trade', reason: 'Tes trades sans stop concentrent les pertes les plus lourdes.' },
    ];
    const emotionInsight = 'Tes trades en état FOCALISÉ ou CONFIANT ont le meilleur résultat net ; STRESSÉ ou FATIGUÉ, tu prends des entrées moyennes.';
    const accounts = DEMO_ACCOUNTS.map((a) => {
      const at = trades.filter((t) => t.account === a.key);
      const as = computeTradeStats(at);
      return {
        accountId: accountIdByKey.get(a.key)!, name: a.label, type: a.type, status: 'ACTIVE',
        stats: { totalTrades: at.length, winRate: as.winRate, totalPnl: as.totalPnl },
        rules: { startingBalance: a.startingBalance, profitTarget: a.profitTarget, maxDrawdown: a.maxDrawdown, drawdownType: a.drawdownType },
        summary: at.length
          ? `${at.length} trades, ${usd(as.totalPnl)} net sur ${a.label}.`
          : `Aucun trade sur ${a.label} cette semaine.`,
        strengths: at.length ? [strengths[0]] : [],
        weaknesses: at.length ? [weaknesses[0]] : [],
        objectives: objectives.slice(0, 2),
        propNote: a.profitTarget
          ? `Objectif ${usd(a.profitTarget)} : estimation d'après les trades loggés, pas le calcul officiel de la firme.`
          : `Compte funded : marge de drawdown estimée d'après les trades loggés, pas le calcul officiel de la firme.`,
      };
    });
    const monday = dayAt(now, Math.max(...w.days.map((d) => d.daysAgo)), 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 0);
    await prisma.weeklyDebrief.create({
      data: {
        userId: user.id, weekNumber: w.week, year: w.year, startDate: monday, endDate: sunday,
        aiSummary: summary,
        insights: { overview: { summary }, accounts, summary, strengths, weaknesses, emotionInsight, objectives },
        objectives,
        stats: { winRate: s.winRate, totalPnl: s.totalPnl, totalTrades: trades.length },
      },
    });
    debriefs++;
  }

  // Calendrier éco du jour + 2 favoris épinglés (agenda pré-session + live). Upsert idempotent.
  const today = now.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const ecoEvents = [
    { time: '01:50', name: 'Balance courante', currency: 'JPY', country: 'JP', impact: 'medium', actual: 1.2, estimate: 1.0, previous: 0.9, unit: 'T¥' },
    { time: '09:00', name: 'PMI manufacturier', currency: 'EUR', country: 'EU', impact: 'medium', actual: 49.2, estimate: 49.0, previous: 48.8, unit: null },
    { time: '14:30', name: 'Inflation CPI (US)', currency: 'USD', country: 'US', impact: 'high', actual: 3.1, estimate: 3.2, previous: 3.4, unit: '%' },
    { time: '16:00', name: 'Discours BCE', currency: 'EUR', country: 'EU', impact: 'high', actual: null, estimate: null, previous: null, unit: null },
  ];
  for (const e of ecoEvents) {
    const data = {
      time: e.time, nameFr: e.name, country: e.country, impact: e.impact,
      actual: e.actual, estimate: e.estimate, previous: e.previous, isReleased: e.actual !== null, unit: e.unit,
    };
    await prisma.ecoEvent.upsert({
      where: { date_name_currency: { date: today, name: e.name, currency: e.currency } },
      update: data,
      create: { date: today, name: e.name, currency: e.currency, ...data },
    });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { pinnedEcoEvents: ['Inflation CPI (US):USD', 'Discours BCE:EUR'] },
  });

  // Compte Apex « Connecté » à Tradovate (vitrine PROMPT-207) : aucun vrai token, le compte démo
  // ne peut ni synchroniser ni connecter (DemoReadOnlyGuard bloque les POST).
  const apexId = accountIdByKey.get('apex')!;
  const demoTradovateAccount = { id: '0', name: 'APEX-DEMO-01', env: 'demo' };
  await prisma.brokerConnection.create({
    data: {
      userId: user.id, accountId: apexId, provider: BrokerProvider.TRADOVATE,
      status: BrokerConnectionStatus.CONNECTED, accessTokenEnc: 'demo:aucun-token',
      accessTokenExpiresAt: new Date(now.getTime() + 80 * 60 * 1000),
      externalAccountId: demoTradovateAccount.id, externalAccountName: demoTradovateAccount.name,
      externalEnv: demoTradovateAccount.env, availableAccounts: [demoTradovateAccount],
      lastSyncAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      tradesImported: stats.byAccount['apex'].trades,
    },
  });

  return {
    email: user.email, trades: stats.trades, winRate: Math.round(stats.winRateNet), pnl: stats.netPnl,
    grossPnl: stats.grossPnl, fees: stats.fees, redDays: stats.redDays, tradingDays: stats.tradingDays,
    sessions: days.filter((d) => d.trades.length).length, recaps, debriefs, accounts: DEMO_ACCOUNTS.length,
    bySetup: stats.bySetup, byAccount: stats.byAccount,
  };
}
