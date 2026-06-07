/**
 * Seed du compte DÉMO vitrine (lecture seule) — Lucas Mercier, PREMIUM, isDemo=true.
 *
 * IDEMPOTENT : ré-exécutable sans dupliquer. Upsert du user, puis purge + recréation
 * de SES données uniquement (scopé par userId démo → aucun impact sur les vrais users).
 * Dates RELATIVES recalculées à chaque run → la démo ne vieillit jamais.
 * Données déterministes (PRNG seedé) → démo stable et reproductible.
 *
 * Lancement :  DATABASE_URL=... pnpm tsx apps/api-mytradingcoach/scripts/seed-demo-account.ts
 */
import {
  PrismaClient, Plan, TradeSide, EmotionState, SetupType,
  TradingSession, MoodState, SessionStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const DEMO_EMAIL = 'demo@mytradingcoach.app';
const DEMO_NAME = 'Lucas Mercier';
const STARTING_CAPITAL = 10_000;

// PRNG déterministe (mulberry32) → données stables d'un run à l'autre.
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

    // Win rate ~57 %, motif déterministe (petits drawdowns puis reprise).
    const win = (i * 37) % 100 < 57;
    const winAmt = Math.round(90 + r() * 230);   // +90 → +320
    const lossAmt = -Math.round(60 + r() * 110); // -60 → -170
    const pnl = win ? winAmt : lossAmt;

    // entry dérive dans le temps ; exit déduit du pnl → cohérence parfaite.
    const drift = (r() - 0.5) * a.base * 0.02;
    const entry = +(a.base + drift).toFixed(a.dec);
    const move = pnl / (a.ptVal * a.qty);
    const exit = +(side === 'LONG' ? entry + move : entry - move).toFixed(a.dec);

    // émotion corrélée au résultat (crédibilité)
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
      qty: a.qty, emotion,
      setup: SETUPS[Math.floor(r() * SETUPS.length)],
      session, tf: TF[Math.floor(r() * TF.length)],
      daysAgo: 2 + Math.round(i * 1.35), // ~2 → 71 jours, ordre chronologique
      hour,
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

async function main() {
  const password = await argon2.hash(`demo-${Date.now()}-${Math.random()}`);

  // 1. Upsert du compte démo (idempotent).
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      isDemo: true, plan: Plan.PREMIUM, name: DEMO_NAME,
      onboardingCompleted: true, startingCapital: STARTING_CAPITAL, currency: 'USD', currencyRate: 1,
      tradingStyle: 'Day trading', tradingStrategy: ['ICT', 'SMC', 'Price Action'],
      tradingSessions: ['LONDON', 'NEW_YORK'], tradesPerDayMin: 1, tradesPerDayMax: 4,
      strategyDescription: "Je trade les indices et le forex sur les sessions Londres/NY, en suivant les concepts ICT/SMC (order blocks, FVG, liquidité). Discipline : 2 trades max par session, R:R minimum 1.5.",
      tradingAssets: ['MNQ', 'MES', 'BTC/USDT', 'EUR/USD', 'GC'], favoriteAsset: 'MNQ',
      market: 'Futures & Forex', goal: 'Devenir constant et discipliné',
      notificationsEmail: false, debriefAutomatic: false,
    },
    create: {
      email: DEMO_EMAIL, password, isDemo: true, plan: Plan.PREMIUM, name: DEMO_NAME,
      onboardingCompleted: true, startingCapital: STARTING_CAPITAL, currency: 'USD', currencyRate: 1,
      tradingStyle: 'Day trading', tradingStrategy: ['ICT', 'SMC', 'Price Action'],
      tradingSessions: ['LONDON', 'NEW_YORK'], tradesPerDayMin: 1, tradesPerDayMax: 4,
      strategyDescription: "Je trade les indices et le forex sur les sessions Londres/NY, en suivant les concepts ICT/SMC (order blocks, FVG, liquidité). Discipline : 2 trades max par session, R:R minimum 1.5.",
      tradingAssets: ['MNQ', 'MES', 'BTC/USDT', 'EUR/USD', 'GC'], favoriteAsset: 'MNQ',
      market: 'Futures & Forex', goal: 'Devenir constant et discipliné',
      notificationsEmail: false, debriefAutomatic: false,
    },
  });
  console.log(`Compte démo : ${user.email} (${user.id})`);

  // 2. Purge des données démo (scopé userId → safe). Trades d'abord (FK session).
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

  // 3. Sessions complètes (3 jours récents) — créées avant les trades pour le lien.
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
    const startedAt = dateOf(s.daysAgo, 8);
    const endedAt = dateOf(s.daysAgo, 17);
    const created = await prisma.tradeSession.create({
      data: {
        userId: user.id, startedAt, endedAt, status: SessionStatus.CLOSED,
        moodStart: s.mood, moodEnd: s.moodEnd, planNote: s.plan, reflectionNote: s.reflection,
        reflectionQuestion: "As-tu respecté ton plan de trading aujourd'hui ?",
      },
    });
    sessionIdByDay.set(s.daysAgo, created.id);
  }

  // 4. Trades (certains rattachés à une session du même jour).
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

  // 4b. Agrégats des sessions (depuis leurs trades).
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

  // 5. Daily recaps figés (IA pré-générée, servis en GET — pas d'appel live).
  const recaps = [
    { daysAgo: 2, emotion: 'FOCUSED', line: "Session disciplinée : 2 trades, R:R respecté. Continue sur cette lancée, la régularité paie." },
    { daysAgo: 6, emotion: 'NEUTRAL', line: "Bonne gestion du risque autour du NFP. Travaille ton timing d'entrée sur les news." },
    { daysAgo: 11, emotion: 'CONFIDENT', line: "Léger overtrading aujourd'hui. Tes meilleurs trades sont tes 2 premiers — sache t'arrêter." },
  ];
  for (const rc of recaps) {
    const day = trades.filter(t => t.daysAgo === rc.daysAgo);
    const pnl = day.reduce((s, t) => s + t.pnl, 0);
    const wins = day.filter(t => t.pnl > 0).length;
    const d = dateOf(rc.daysAgo, 18);
    d.setHours(0, 0, 0, 0);
    await prisma.dailyRecap.create({
      data: {
        userId: user.id, date: d, tradesCount: day.length, pnl,
        winRate: day.length ? Math.round((wins / day.length) * 100) : 0,
        dominantEmotion: rc.emotion, aiOneLiner: rc.line,
      },
    });
  }

  // 6. Weekly debriefs figés (2 dernières semaines).
  for (const wkAgo of [1, 2]) {
    const ref = new Date();
    ref.setDate(ref.getDate() - wkAgo * 7);
    const { week, year } = isoWeek(ref);
    const start = new Date(ref); start.setDate(ref.getDate() - 6);
    const wkTrades = trades.filter(t => t.daysAgo > wkAgo * 7 - 7 && t.daysAgo <= wkAgo * 7);
    const pnl = wkTrades.reduce((s, t) => s + t.pnl, 0);
    const wins = wkTrades.filter(t => t.pnl > 0).length;
    await prisma.weeklyDebrief.create({
      data: {
        userId: user.id, weekNumber: week, year, startDate: start, endDate: ref,
        aiSummary: wkAgo === 1
          ? "Semaine solide et disciplinée. Ton edge se confirme sur les sessions de Londres avec les setups breakout/pullback. Ta gestion émotionnelle s'est nettement améliorée : moins de trades de revanche."
          : "Semaine en dents de scie. Tes pertes viennent surtout des trades pris en session asiatique, hors de ta zone de confiance. Recentre-toi sur Londres/NY où ton win rate est bien meilleur.",
        insights: [
          { type: 'strength', text: `Win rate ${wkTrades.length ? Math.round((wins / wkTrades.length) * 100) : 0}% sur la semaine` },
          { type: 'strength', text: 'Meilleure discipline : R:R moyen > 1.8' },
          { type: 'weakness', text: 'Performance plus faible en session asiatique' },
        ],
        objectives: [
          { text: 'Limiter à 2 trades par session', type: 'focus' },
          { text: 'Ne trader que Londres et New York', type: 'risk' },
          { text: 'Noter une émotion sur chaque trade', type: 'focus' },
        ],
        stats: {
          trades: wkTrades.length, pnl,
          winRate: wkTrades.length ? Math.round((wins / wkTrades.length) * 100) : 0,
        },
      },
    });
  }

  // Récap console
  const total = trades.reduce((s, t) => s + t.pnl, 0);
  const wins = trades.filter(t => t.pnl > 0).length;
  console.log(`✅ Seed démo terminé.`);
  console.log(`   ${trades.length} trades · WR ${Math.round((wins / trades.length) * 100)}% · P&L net +$${total}`);
  console.log(`   ${sessionDefs.length} sessions · ${recaps.length} daily recaps · 2 weekly debriefs`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
