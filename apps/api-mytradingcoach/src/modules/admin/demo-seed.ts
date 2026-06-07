import {
  PrismaClient, Plan, TradeSide, EmotionState, SetupType,
  TradingSession, MoodState, SessionStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Logique de seed du compte DÉMO vitrine — source de vérité unique, utilisée par
 * l'endpoint admin (PrismaService) ET le script standalone (PrismaClient adapter).
 *
 * IDEMPOTENT : upsert du user + purge/recréation de SES données uniquement
 * (scopé userId démo). Dates RELATIVES recalculées à chaque run. Déterministe (PRNG seedé).
 */

export const DEMO_EMAIL = 'demo@mytradingcoach.app';
const DEMO_NAME = 'Lucas Mercier';
const STARTING_CAPITAL = 10_000;

// PRNG déterministe (mulberry32) → données stables.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ptVal = $ par mouvement de prix de 1.0, pour 1 contrat → entry/exit/pnl cohérents.
const ASSETS = [
  { sym: 'MNQ',      base: 18_500, ptVal: 2,       qty: 2, dec: 2 },
  { sym: 'MES',      base: 5_200,  ptVal: 5,       qty: 2, dec: 2 },
  { sym: 'BTC/USDT', base: 64_000, ptVal: 1,       qty: 1, dec: 1 },
  { sym: 'EUR/USD',  base: 1.0850, ptVal: 100_000, qty: 1, dec: 4 },
  { sym: 'GC',       base: 2_350,  ptVal: 100,     qty: 1, dec: 1 },
];
const EMOTIONS: EmotionState[] = ['CONFIDENT', 'FOCUSED', 'NEUTRAL', 'STRESSED', 'FEAR', 'REVENGE'];
const SETUPS: SetupType[] = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];
const TF = ['1m', '5m', '15m', '1h'];

interface GenTrade {
  asset: string; side: TradeSide; entry: number; exit: number; pnl: number;
  rr: number; qty: number; emotion: EmotionState; setup: SetupType;
  session: TradingSession; tf: string; daysAgo: number; hour: number;
}

function buildTrades(): GenTrade[] {
  const r = rng(20260607);
  const N = 52;
  const out: GenTrade[] = [];

  for (let i = 0; i < N; i++) {
    const a = ASSETS[i % ASSETS.length];
    const side: TradeSide = r() < 0.62 ? 'LONG' : 'SHORT';
    const win = (i * 37) % 100 < 57; // WR ~57 %, motif déterministe
    const pnl = win ? Math.round(90 + r() * 230) : -Math.round(60 + r() * 110);

    const drift = (r() - 0.5) * a.base * 0.02;
    const entry = +(a.base + drift).toFixed(a.dec);
    const move = pnl / (a.ptVal * a.qty);
    const exit = +(side === 'LONG' ? entry + move : entry - move).toFixed(a.dec);

    const emotion: EmotionState = win
      ? (r() < 0.7 ? 'CONFIDENT' : 'FOCUSED')
      : EMOTIONS[2 + Math.floor(r() * 4)];
    const session: TradingSession = r() < 0.5 ? 'LONDON' : (r() < 0.7 ? 'NEW_YORK' : 'ASIAN');
    const hour = session === 'LONDON' ? 9 + Math.floor(r() * 3)
      : session === 'NEW_YORK' ? 15 + Math.floor(r() * 2)
      : 3 + Math.floor(r() * 2);

    out.push({
      asset: a.sym, side, entry, exit, pnl,
      rr: +(1.2 + r() * 1.7).toFixed(1),
      qty: a.qty, emotion, setup: SETUPS[Math.floor(r() * SETUPS.length)],
      session, tf: TF[Math.floor(r() * TF.length)],
      daysAgo: 2 + Math.round(i * 1.35), hour,
    });
  }
  return out;
}

function isoWeek(d: Date): { week: number; year: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { week, year: date.getUTCFullYear() };
}

const PROFILE = {
  isDemo: true, plan: Plan.PREMIUM, name: DEMO_NAME,
  onboardingCompleted: true, startingCapital: STARTING_CAPITAL, currency: 'USD', currencyRate: 1,
  tradingStyle: 'Day trading', tradingStrategy: ['ICT', 'SMC', 'Price Action'],
  tradingSessions: ['LONDON', 'NEW_YORK'], tradesPerDayMin: 1, tradesPerDayMax: 4,
  strategyDescription: "Je trade les indices et le forex sur les sessions Londres/NY, en suivant les concepts ICT/SMC (order blocks, FVG, liquidité). Discipline : 2 trades max par session, R:R minimum 1.5.",
  tradingAssets: ['MNQ', 'MES', 'BTC/USDT', 'EUR/USD', 'GC'], favoriteAsset: 'MNQ',
  market: 'Futures & Forex', goal: 'Devenir constant et discipliné',
  notificationsEmail: false, debriefAutomatic: false,
};

export interface DemoSeedResult {
  email: string; trades: number; winRate: number; pnl: number;
  sessions: number; recaps: number; debriefs: number;
}

/** Seed/refresh complet du compte démo. `prisma` = PrismaService ou PrismaClient adapter. */
export async function seedDemo(prisma: PrismaClient): Promise<DemoSeedResult> {
  const password = await argon2.hash(`demo-${Date.now()}-${Math.random()}`);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { ...PROFILE },
    create: { email: DEMO_EMAIL, password, ...PROFILE },
  });

  // Purge scopée (trades d'abord — FK session).
  await prisma.trade.deleteMany({ where: { userId: user.id } });
  await prisma.tradeSession.deleteMany({ where: { userId: user.id } });
  await prisma.weeklyDebrief.deleteMany({ where: { userId: user.id } });
  await prisma.dailyRecap.deleteMany({ where: { userId: user.id } });

  const trades = buildTrades();
  const dateOf = (daysAgo: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, (daysAgo * 7) % 55, 0, 0);
    return d;
  };

  const sessionDefs = [
    { daysAgo: 2, mood: 'FOCUSED' as MoodState, moodEnd: 'CONFIDENT' as MoodState,
      plan: "Plan : attendre la prise de liquidité asiatique puis chercher un FVG en M5 sur MNQ. 2 trades max.",
      reflection: "Bonne session, j'ai respecté mon plan et coupé un trade qui ne fonctionnait pas sans m'entêter." },
    { daysAgo: 6, mood: 'NEUTRAL' as MoodState, moodEnd: 'FOCUSED' as MoodState,
      plan: "Plan : journée NFP, je reste à l'écart avant l'annonce, je trade la réaction si setup propre.",
      reflection: "J'ai bien fait d'attendre l'annonce. Un trade pris en retard, à anticiper la prochaine fois." },
    { daysAgo: 11, mood: 'CONFIDENT' as MoodState, moodEnd: 'NEUTRAL' as MoodState,
      plan: "Plan : continuation haussière BTC, j'achète les pullbacks vers l'order block H1.",
      reflection: "Trop de trades aujourd'hui (overtrading léger). Résultat correct mais discipline à resserrer." },
  ];

  const sessionIdByDay = new Map<number, string>();
  for (const s of sessionDefs) {
    const created = await prisma.tradeSession.create({
      data: {
        userId: user.id, startedAt: dateOf(s.daysAgo, 8), endedAt: dateOf(s.daysAgo, 17),
        status: SessionStatus.CLOSED, moodStart: s.mood, moodEnd: s.moodEnd,
        planNote: s.plan, reflectionNote: s.reflection,
        reflectionQuestion: "As-tu respecté ton plan de trading aujourd'hui ?",
      },
    });
    sessionIdByDay.set(s.daysAgo, created.id);
  }

  for (const t of trades) {
    await prisma.trade.create({
      data: {
        userId: user.id, asset: t.asset, side: t.side, entry: t.entry, exit: t.exit,
        pnl: t.pnl, riskReward: t.rr, quantity: t.qty, emotion: t.emotion,
        setup: t.setup, session: t.session, timeframe: t.tf, tags: ['DEMO'],
        tradedAt: dateOf(t.daysAgo, t.hour),
        ...(sessionIdByDay.has(t.daysAgo) ? { sessionId: sessionIdByDay.get(t.daysAgo) } : {}),
      },
    });
  }

  for (const [daysAgo, sid] of sessionIdByDay) {
    const st = trades.filter(t => t.daysAgo === daysAgo);
    if (st.length === 0) continue;
    const pnl = st.reduce((s, t) => s + t.pnl, 0);
    const wins = st.filter(t => t.pnl > 0).length;
    const best = st.reduce((a, b) => (b.pnl > a.pnl ? b : a));
    await prisma.tradeSession.update({
      where: { id: sid },
      data: {
        totalPnl: pnl, totalTrades: st.length, winRate: Math.round((wins / st.length) * 100),
        bestTradePnl: best.pnl, bestTradeAsset: best.asset,
      },
    });
  }

  // ── Hier (J-1) : session CLOSED + 2 trades + recap (carte « Hier » pré-session) ──
  const yClosed = await prisma.tradeSession.create({
    data: {
      userId: user.id, startedAt: dateOf(1, 8), endedAt: dateOf(1, 17),
      status: SessionStatus.CLOSED, moodStart: 'NEUTRAL' as MoodState, moodEnd: 'CONFIDENT' as MoodState,
      planNote: "Plan : breakouts MNQ sur Londres, patience sur New York. 2 trades max, R:R ≥ 1.5.",
      reflectionNote: "Journée propre : plan suivi, perte coupée tôt et gagnant laissé courir. À reproduire.",
      reflectionQuestion: "As-tu respecté ton plan de trading aujourd'hui ?",
    },
  });
  const yTrades = [
    { asset: 'MNQ', side: 'LONG' as TradeSide, entry: 18500, exit: 18545, pnl: 180, rr: 2.2, qty: 2, emotion: 'CONFIDENT' as EmotionState, setup: 'BREAKOUT' as SetupType, session: 'LONDON' as TradingSession, tf: '5m', hour: 9 },
    { asset: 'MES', side: 'LONG' as TradeSide, entry: 5200, exit: 5198.6, pnl: -70, rr: 1.4, qty: 2, emotion: 'NEUTRAL' as EmotionState, setup: 'PULLBACK' as SetupType, session: 'NEW_YORK' as TradingSession, tf: '5m', hour: 15 },
  ];
  for (const t of yTrades) {
    await prisma.trade.create({ data: {
      userId: user.id, asset: t.asset, side: t.side, entry: t.entry, exit: t.exit,
      pnl: t.pnl, riskReward: t.rr, quantity: t.qty, emotion: t.emotion, setup: t.setup,
      session: t.session, timeframe: t.tf, tags: ['DEMO'], tradedAt: dateOf(1, t.hour), sessionId: yClosed.id,
    } });
  }
  {
    const pnl = yTrades.reduce((s, t) => s + t.pnl, 0);
    const wins = yTrades.filter(t => t.pnl > 0).length;
    const best = yTrades.reduce((a, b) => (b.pnl > a.pnl ? b : a));
    await prisma.tradeSession.update({ where: { id: yClosed.id }, data: {
      totalPnl: pnl, totalTrades: yTrades.length, winRate: Math.round((wins / yTrades.length) * 100),
      bestTradePnl: best.pnl, bestTradeAsset: best.asset,
    } });
    const d = dateOf(1, 18); d.setHours(0, 0, 0, 0); // hier 00:00 — clé du recap "yesterday"
    await prisma.dailyRecap.create({ data: {
      userId: user.id, date: d, tradesCount: yTrades.length, pnl,
      winRate: Math.round((wins / yTrades.length) * 100), dominantEmotion: 'CONFIDENT',
      aiOneLiner: "Belle discipline hier : perte coupée tôt, gagnant laissé courir. Reproduis ce schéma aujourd'hui.",
    } });
  }

  // ── Aujourd'hui (J-0) : session ACTIVE + 2 trades (onglet Session live) ──
  // Pas de totalPnl/totalTrades figés : les stats du jour se calculent via getTodayTrades.
  const todaySession = await prisma.tradeSession.create({
    data: {
      userId: user.id, startedAt: dateOf(0, 8), endedAt: null,
      status: SessionStatus.ACTIVE, moodStart: 'FOCUSED' as MoodState,
      // moodEnd + reflectionNote (sur session ACTIVE) → le débrief démo du jour
      // est cohérent avec le live (mêmes trades) tout en gardant la session active.
      moodEnd: 'CONFIDENT' as MoodState,
      reflectionNote: 'Deux entrées propres : MNQ sur breakout Londres laissé courir, EUR/USD scalp discipliné. Plan respecté.',
      planNote: "Plan du jour : breakouts MNQ sur Londres, 2 trades max, R:R ≥ 1.5.",
      reflectionQuestion: "As-tu respecté ton plan de trading aujourd'hui ?",
    },
  });
  const tTrades = [
    { asset: 'MNQ', side: 'LONG' as TradeSide, entry: 18600, exit: 18640, pnl: 160, rr: 2.1, qty: 2, emotion: 'CONFIDENT' as EmotionState, setup: 'BREAKOUT' as SetupType, session: 'LONDON' as TradingSession, tf: '5m', hour: 9 },
    { asset: 'EUR/USD', side: 'LONG' as TradeSide, entry: 1.0850, exit: 1.0853, pnl: 30, rr: 1.5, qty: 1, emotion: 'FOCUSED' as EmotionState, setup: 'PULLBACK' as SetupType, session: 'LONDON' as TradingSession, tf: '15m', hour: 10 },
  ];
  for (const t of tTrades) {
    await prisma.trade.create({ data: {
      userId: user.id, asset: t.asset, side: t.side, entry: t.entry, exit: t.exit,
      pnl: t.pnl, riskReward: t.rr, quantity: t.qty, emotion: t.emotion, setup: t.setup,
      session: t.session, timeframe: t.tf, tags: ['DEMO'], tradedAt: dateOf(0, t.hour), sessionId: todaySession.id,
    } });
  }

  const recaps = [
    { daysAgo: 2, emotion: 'FOCUSED', line: "Session disciplinée : 2 trades, R:R respecté. Continue sur cette lancée, la régularité paie." },
    { daysAgo: 6, emotion: 'NEUTRAL', line: "Bonne gestion du risque autour du NFP. Travaille ton timing d'entrée sur les news." },
    { daysAgo: 11, emotion: 'CONFIDENT', line: "Léger overtrading aujourd'hui. Tes meilleurs trades sont tes 2 premiers — sache t'arrêter." },
  ];
  for (const rc of recaps) {
    const day = trades.filter(t => t.daysAgo === rc.daysAgo);
    const pnl = day.reduce((s, t) => s + t.pnl, 0);
    const wins = day.filter(t => t.pnl > 0).length;
    const d = dateOf(rc.daysAgo, 18); d.setHours(0, 0, 0, 0);
    await prisma.dailyRecap.create({
      data: {
        userId: user.id, date: d, tradesCount: day.length, pnl,
        winRate: day.length ? Math.round((wins / day.length) * 100) : 0,
        dominantEmotion: rc.emotion, aiOneLiner: rc.line,
      },
    });
  }

  for (const wkAgo of [1, 2]) {
    const ref = new Date(); ref.setDate(ref.getDate() - wkAgo * 7);
    const { week, year } = isoWeek(ref);
    const start = new Date(ref); start.setDate(ref.getDate() - 6);
    const wk = trades.filter(t => t.daysAgo > wkAgo * 7 - 7 && t.daysAgo <= wkAgo * 7);
    const pnl = wk.reduce((s, t) => s + t.pnl, 0);
    const wins = wk.filter(t => t.pnl > 0).length;
    const wr = wk.length ? Math.round((wins / wk.length) * 100) : 0;
    const summary = wkAgo === 1
      ? "Semaine solide et disciplinée. Ton edge se confirme sur les sessions de Londres avec les setups breakout/pullback. Ta gestion émotionnelle s'est nettement améliorée : moins de trades de revanche."
      : "Semaine en dents de scie. Tes pertes viennent surtout des trades pris en session asiatique, hors de ta zone de confiance. Recentre-toi sur Londres/NY où ton win rate est bien meilleur.";
    const strengths = [
      { badge: 'Force', text: `Win rate ${wr}% sur la semaine` },
      { badge: 'Force', text: 'Discipline en hausse : R:R moyen supérieur à 1.8' },
    ];
    const weaknesses = [
      { badge: 'Attention', text: 'Performance plus faible en session asiatique' },
    ];
    const emotionInsight = "Tes trades en état FOCALISÉ affichent le meilleur win rate ; évite de trader FATIGUÉ.";
    const objectives = [
      { title: 'Limiter à 2 trades par session', reason: 'Tes meilleurs résultats viennent de tes 2 premiers trades' },
      { title: 'Ne trader que Londres et New York', reason: 'Ton win rate chute en session asiatique' },
      { title: 'Noter une émotion sur chaque trade', reason: "Corréler l'émotion au résultat affine ton edge" },
    ];
    await prisma.weeklyDebrief.create({
      data: {
        userId: user.id, weekNumber: week, year, startDate: start, endDate: ref,
        aiSummary: summary,
        // Forme attendue par le front (debrief.api.ts / debrief.component.ts).
        insights: { summary, strengths, weaknesses, emotionInsight, objectives },
        objectives, // colonne top-level lue par le composant
        stats: { winRate: wr, totalPnl: pnl, totalTrades: wk.length },
      },
    });
  }

  // ── Calendrier éco du jour + 2 favoris épinglés (agenda pré-session + live) ──
  // EcoEvent est global → upsert idempotent par (date, name, currency).
  const today = new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const ecoEvents = [
    { time: '01:50', name: 'Balance courante',  currency: 'JPY', country: 'JP', impact: 'medium', actual: 1.2,  estimate: 1.0,  previous: 0.9,  unit: 'T¥' },
    { time: '09:00', name: 'PMI manufacturier', currency: 'EUR', country: 'EU', impact: 'medium', actual: 49.2, estimate: 49.0, previous: 48.8, unit: null },
    { time: '14:30', name: 'Inflation CPI (US)', currency: 'USD', country: 'US', impact: 'high',  actual: 3.1,  estimate: 3.2,  previous: 3.4,  unit: '%' },
    { time: '16:00', name: 'Discours BCE',       currency: 'EUR', country: 'EU', impact: 'high',  actual: null, estimate: null, previous: null, unit: null },
  ];
  for (const e of ecoEvents) {
    const data = {
      time: e.time, nameFr: e.name, country: e.country, impact: e.impact,
      actual: e.actual, estimate: e.estimate, previous: e.previous,
      isReleased: e.actual !== null, unit: e.unit,
    };
    await prisma.ecoEvent.upsert({
      where: { date_name_currency: { date: today, name: e.name, currency: e.currency } },
      update: data,
      create: { date: today, name: e.name, currency: e.currency, ...data },
    });
  }
  // Favoris épinglés (format "name:currency") — matchés via normalizeEventKey côté front.
  await prisma.user.update({
    where: { id: user.id },
    data: { pinnedEcoEvents: ['Inflation CPI (US):USD', 'Discours BCE:EUR'] },
  });

  const total = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  return {
    email: user.email, trades: trades.length + 4, // +2 hier +2 aujourd'hui
    winRate: Math.round((wins / trades.length) * 100), pnl: total,
    sessions: sessionDefs.length + 2, recaps: recaps.length + 1, debriefs: 2,
  };
}
