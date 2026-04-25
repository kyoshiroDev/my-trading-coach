import { PrismaClient, TradeSide, EmotionState, SetupType, TradingSession, Plan } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const USER_ID = 'cmo482e9h00009xz8nseczhcd';

const trades = [
  // Mois -2 : 18 trades
  { asset: 'BTC/USDT', side: 'LONG',  entry: 61200, exit: 63800, pnl:  520,  rr: 2.1, emotion: 'CONFIDENT', setup: 'BREAKOUT',  session: 'NEW_YORK',  tf: '1h',  daysAgo: 75, tags: ['trend', 'momentum'] },
  { asset: 'ETH/USDT', side: 'LONG',  entry: 3100,  exit: 3250,  pnl:  300,  rr: 1.9, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'LONDON',    tf: '4h',  daysAgo: 73, tags: ['support'] },
  { asset: 'EUR/USD',  side: 'SHORT', entry: 1.092,  exit: 1.086, pnl:  240,  rr: 2.4, emotion: 'CONFIDENT', setup: 'RANGE',     session: 'LONDON',    tf: '15m', daysAgo: 72, tags: ['range', 'resistance'] },
  { asset: 'SOL/USDT', side: 'LONG',  entry: 142,   exit: 138,   pnl: -160,  rr: 0.5, emotion: 'STRESSED',  setup: 'BREAKOUT',  session: 'NEW_YORK',  tf: '1h',  daysAgo: 70, tags: ['fakeout'] },
  { asset: 'NVDA',     side: 'LONG',  entry: 820,   exit: 855,   pnl:  350,  rr: 1.8, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 68, tags: ['earnings-play'] },
  { asset: 'GBP/USD',  side: 'SHORT', entry: 1.268,  exit: 1.275, pnl: -140,  rr: 0.7, emotion: 'FEAR',      setup: 'REVERSAL',  session: 'LONDON',    tf: '1h',  daysAgo: 67, tags: ['news'] },
  { asset: 'BTC/USDT', side: 'LONG',  entry: 62500, exit: 65100, pnl:  520,  rr: 2.6, emotion: 'CONFIDENT', setup: 'PULLBACK',  session: 'OVERLAP',   tf: '4h',  daysAgo: 65, tags: ['trend'] },
  { asset: 'XRP/USDT', side: 'LONG',  entry: 0.58,  exit: 0.62,  pnl:  200,  rr: 2.0, emotion: 'NEUTRAL',   setup: 'BREAKOUT',  session: 'ASIAN',     tf: '1h',  daysAgo: 63, tags: ['altcoin'] },
  { asset: 'ETH/USDT', side: 'SHORT', entry: 3300,  exit: 3180,  pnl:  480,  rr: 2.4, emotion: 'FOCUSED',   setup: 'REVERSAL',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 61, tags: ['resistance'] },
  { asset: 'SOL/USDT', side: 'LONG',  entry: 148,   exit: 156,   pnl:  320,  rr: 2.1, emotion: 'CONFIDENT', setup: 'BREAKOUT',  session: 'LONDON',    tf: '1h',  daysAgo: 60, tags: ['momentum'] },
  { asset: 'BNB/USDT', side: 'LONG',  entry: 415,   exit: 408,   pnl: -140,  rr: 0.6, emotion: 'REVENGE',   setup: 'SCALPING',  session: 'ASIAN',     tf: '5m',  daysAgo: 58, tags: ['revenge-trade'] },
  { asset: 'AAPL',     side: 'LONG',  entry: 188,   exit: 195,   pnl:  280,  rr: 1.6, emotion: 'NEUTRAL',   setup: 'PULLBACK',  session: 'NEW_YORK',  tf: 'D',   daysAgo: 56, tags: ['swing'] },
  { asset: 'EUR/USD',  side: 'LONG',  entry: 1.083,  exit: 1.089, pnl:  180,  rr: 1.5, emotion: 'FOCUSED',   setup: 'RANGE',     session: 'LONDON',    tf: '15m', daysAgo: 55, tags: ['range'] },
  { asset: 'BTC/USDT', side: 'SHORT', entry: 67200, exit: 64800, pnl:  480,  rr: 2.4, emotion: 'CONFIDENT', setup: 'REVERSAL',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 53, tags: ['double-top'] },
  { asset: 'ADA/USDT', side: 'LONG',  entry: 0.44,  exit: 0.41,  pnl: -150,  rr: 0.5, emotion: 'STRESSED',  setup: 'BREAKOUT',  session: 'ASIAN',     tf: '1h',  daysAgo: 51, tags: ['failed-breakout'] },
  { asset: 'ETH/USDT', side: 'LONG',  entry: 3050,  exit: 3180,  pnl:  390,  rr: 2.0, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'OVERLAP',   tf: '4h',  daysAgo: 49, tags: ['trend'] },
  { asset: 'NVDA',     side: 'SHORT', entry: 870,   exit: 840,   pnl:  300,  rr: 1.8, emotion: 'CONFIDENT', setup: 'REVERSAL',  session: 'NEW_YORK',  tf: '1h',  daysAgo: 48, tags: ['distribution'] },
  { asset: 'GBP/USD',  side: 'LONG',  entry: 1.261,  exit: 1.268, pnl:  210,  rr: 1.5, emotion: 'NEUTRAL',   setup: 'RANGE',     session: 'LONDON',    tf: '15m', daysAgo: 46, tags: ['range'] },

  // Mois -1 : 18 trades
  { asset: 'BTC/USDT', side: 'LONG',  entry: 63800, exit: 68200, pnl:  880,  rr: 3.1, emotion: 'FOCUSED',   setup: 'BREAKOUT',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 44, tags: ['ath-retest'] },
  { asset: 'SOL/USDT', side: 'LONG',  entry: 155,   exit: 162,   pnl:  280,  rr: 2.0, emotion: 'CONFIDENT', setup: 'PULLBACK',  session: 'LONDON',    tf: '1h',  daysAgo: 42, tags: ['trend'] },
  { asset: 'EUR/USD',  side: 'SHORT', entry: 1.098,  exit: 1.091, pnl:  280,  rr: 2.3, emotion: 'FOCUSED',   setup: 'REVERSAL',  session: 'LONDON',    tf: '1h',  daysAgo: 41, tags: ['resistance'] },
  { asset: 'XRP/USDT', side: 'SHORT', entry: 0.64,  exit: 0.68,  pnl: -160,  rr: 0.6, emotion: 'REVENGE',   setup: 'SCALPING',  session: 'ASIAN',     tf: '5m',  daysAgo: 39, tags: ['revenge'] },
  { asset: 'BNB/USDT', side: 'LONG',  entry: 420,   exit: 440,   pnl:  400,  rr: 2.5, emotion: 'CONFIDENT', setup: 'BREAKOUT',  session: 'OVERLAP',   tf: '4h',  daysAgo: 38, tags: ['momentum'] },
  { asset: 'AAPL',     side: 'SHORT', entry: 198,   exit: 192,   pnl:  240,  rr: 1.9, emotion: 'NEUTRAL',   setup: 'REVERSAL',  session: 'NEW_YORK',  tf: 'D',   daysAgo: 36, tags: ['swing', 'overbought'] },
  { asset: 'ETH/USDT', side: 'LONG',  entry: 3200,  exit: 3350,  pnl:  450,  rr: 2.3, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 35, tags: ['trend'] },
  { asset: 'BTC/USDT', side: 'LONG',  entry: 66500, exit: 64200, pnl: -460,  rr: 0.4, emotion: 'FEAR',      setup: 'BREAKOUT',  session: 'ASIAN',     tf: '1h',  daysAgo: 33, tags: ['stop-hunt'] },
  { asset: 'GBP/USD',  side: 'SHORT', entry: 1.274,  exit: 1.267, pnl:  210,  rr: 1.8, emotion: 'CONFIDENT', setup: 'RANGE',     session: 'LONDON',    tf: '15m', daysAgo: 31, tags: ['range-top'] },
  { asset: 'SOL/USDT', side: 'LONG',  entry: 158,   exit: 165,   pnl:  280,  rr: 2.1, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'LONDON',    tf: '1h',  daysAgo: 29, tags: ['support-bounce'] },
  { asset: 'NVDA',     side: 'LONG',  entry: 845,   exit: 880,   pnl:  350,  rr: 2.0, emotion: 'CONFIDENT', setup: 'BREAKOUT',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 28, tags: ['momentum'] },
  { asset: 'ADA/USDT', side: 'LONG',  entry: 0.46,  exit: 0.49,  pnl:  150,  rr: 1.5, emotion: 'NEUTRAL',   setup: 'RANGE',     session: 'ASIAN',     tf: '1h',  daysAgo: 26, tags: ['range'] },
  { asset: 'BTC/USDT', side: 'SHORT', entry: 69800, exit: 67500, pnl:  460,  rr: 2.3, emotion: 'FOCUSED',   setup: 'REVERSAL',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 24, tags: ['topping'] },
  { asset: 'EUR/USD',  side: 'LONG',  entry: 1.087,  exit: 1.082, pnl: -150,  rr: 0.6, emotion: 'STRESSED',  setup: 'BREAKOUT',  session: 'PRE_MARKET',tf: '15m', daysAgo: 22, tags: ['news-miss'] },
  { asset: 'ETH/USDT', side: 'SHORT', entry: 3400,  exit: 3280,  pnl:  360,  rr: 2.0, emotion: 'CONFIDENT', setup: 'REVERSAL',  session: 'OVERLAP',   tf: '4h',  daysAgo: 20, tags: ['double-top'] },
  { asset: 'XRP/USDT', side: 'LONG',  entry: 0.60,  exit: 0.65,  pnl:  250,  rr: 2.5, emotion: 'FOCUSED',   setup: 'BREAKOUT',  session: 'ASIAN',     tf: '1h',  daysAgo: 18, tags: ['altseason'] },
  { asset: 'BNB/USDT', side: 'SHORT', entry: 440,   exit: 425,   pnl:  300,  rr: 2.0, emotion: 'NEUTRAL',   setup: 'PULLBACK',  session: 'LONDON',    tf: '4h',  daysAgo: 16, tags: ['bearish-flag'] },
  { asset: 'AAPL',     side: 'LONG',  entry: 192,   exit: 198,   pnl:  240,  rr: 1.7, emotion: 'CONFIDENT', setup: 'PULLBACK',  session: 'NEW_YORK',  tf: 'D',   daysAgo: 14, tags: ['swing'] },

  // Ce mois : 13 trades
  { asset: 'BTC/USDT', side: 'LONG',  entry: 68500, exit: 71200, pnl:  540,  rr: 2.7, emotion: 'CONFIDENT', setup: 'BREAKOUT',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 12, tags: ['ath-break'] },
  { asset: 'SOL/USDT', side: 'SHORT', entry: 172,   exit: 165,   pnl:  280,  rr: 2.0, emotion: 'FOCUSED',   setup: 'REVERSAL',  session: 'LONDON',    tf: '1h',  daysAgo: 11, tags: ['exhaustion'] },
  { asset: 'ETH/USDT', side: 'LONG',  entry: 3500,  exit: 3650,  pnl:  450,  rr: 2.5, emotion: 'CONFIDENT', setup: 'PULLBACK',  session: 'OVERLAP',   tf: '4h',  daysAgo: 10, tags: ['trend'] },
  { asset: 'GBP/USD',  side: 'SHORT', entry: 1.282,  exit: 1.276, pnl:  180,  rr: 1.5, emotion: 'NEUTRAL',   setup: 'RANGE',     session: 'LONDON',    tf: '15m', daysAgo: 9,  tags: ['range-top'] },
  { asset: 'NVDA',     side: 'LONG',  entry: 890,   exit: 875,   pnl: -150,  rr: 0.5, emotion: 'STRESSED',  setup: 'SCALPING',  session: 'PRE_MARKET',tf: '5m',  daysAgo: 8,  tags: ['overtrading'] },
  { asset: 'BTC/USDT', side: 'LONG',  entry: 70200, exit: 73500, pnl:  660,  rr: 3.3, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 7,  tags: ['trend', 'high-conviction'] },
  { asset: 'XRP/USDT', side: 'LONG',  entry: 0.68,  exit: 0.64,  pnl: -200,  rr: 0.5, emotion: 'REVENGE',   setup: 'BREAKOUT',  session: 'ASIAN',     tf: '1h',  daysAgo: 6,  tags: ['revenge', 'fomo'] },
  { asset: 'ADA/USDT', side: 'LONG',  entry: 0.49,  exit: 0.52,  pnl:  150,  rr: 1.5, emotion: 'NEUTRAL',   setup: 'RANGE',     session: 'ASIAN',     tf: '1h',  daysAgo: 5,  tags: ['range'] },
  { asset: 'EUR/USD',  side: 'LONG',  entry: 1.092,  exit: 1.097, pnl:  200,  rr: 2.0, emotion: 'FOCUSED',   setup: 'BREAKOUT',  session: 'LONDON',    tf: '15m', daysAgo: 4,  tags: ['news-play'] },
  { asset: 'ETH/USDT', side: 'SHORT', entry: 3680,  exit: 3580,  pnl:  300,  rr: 2.0, emotion: 'CONFIDENT', setup: 'REVERSAL',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 3,  tags: ['topping'] },
  { asset: 'SOL/USDT', side: 'LONG',  entry: 168,   exit: 174,   pnl:  240,  rr: 2.0, emotion: 'FOCUSED',   setup: 'PULLBACK',  session: 'LONDON',    tf: '1h',  daysAgo: 2,  tags: ['support-bounce'] },
  { asset: 'BNB/USDT', side: 'LONG',  entry: 448,   exit: 460,   pnl:  240,  rr: 1.8, emotion: 'CONFIDENT', setup: 'BREAKOUT',  session: 'ASIAN',     tf: '4h',  daysAgo: 1,  tags: ['momentum'] },
  { asset: 'BTC/USDT', side: 'LONG',  entry: 72800, exit: 75200, pnl:  480,  rr: 2.4, emotion: 'CONFIDENT', setup: 'PULLBACK',  session: 'NEW_YORK',  tf: '4h',  daysAgo: 0,  tags: ['trend', 'continuation'] },
];

async function main() {
  console.log(`Seeding 49 trades for user ${USER_ID}...`);

  await prisma.trade.deleteMany({ where: { userId: USER_ID } });

  for (const t of trades) {
    const d = new Date();
    d.setDate(d.getDate() - t.daysAgo);
    d.setHours(Math.floor(Math.random() * 14) + 7, Math.floor(Math.random() * 60));

    await prisma.trade.create({
      data: {
        userId:       USER_ID,
        asset:        t.asset,
        side:         t.side as TradeSide,
        entry:        t.entry,
        exit:         t.exit,
        pnl:          t.pnl,
        riskReward:   t.rr,
        emotion:      t.emotion as EmotionState,
        setup:        t.setup as SetupType,
        session:      t.session as TradingSession,
        timeframe:    t.tf,
        tags:         t.tags,
        tradedAt:     d,
      },
    });
  }

  console.log(`✓ 49 trades inserted.`);

  // ── Utilisateurs E2E ────────────────────────────────────────────────────
  const e2ePassword = await argon2.hash('TestPassword123!');

  await prisma.user.upsert({
    where: { email: 'free-e2e@test.com' },
    update: {},
    create: {
      email: 'free-e2e@test.com',
      password: e2ePassword,
      name: 'Free E2E',
      plan: Plan.FREE,
      onboardingCompleted: true,
    },
  });
  console.log('✓ Utilisateur FREE créé : free-e2e@test.com');

  await prisma.user.upsert({
    where: { email: 'premium-e2e@test.com' },
    update: {},
    create: {
      email: 'premium-e2e@test.com',
      password: e2ePassword,
      name: 'Premium E2E',
      plan: Plan.PREMIUM,
      onboardingCompleted: true,
    },
  });
  console.log('✓ Utilisateur PREMIUM (manuel) créé : premium-e2e@test.com');

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 20);

  await prisma.user.upsert({
    where: { email: 'monthly-e2e@test.com' },
    update: {},
    create: {
      email: 'monthly-e2e@test.com',
      password: e2ePassword,
      name: 'Monthly E2E',
      plan: Plan.PREMIUM,
      onboardingCompleted: true,
      stripeInterval: 'month',
      stripeCurrentPeriodEnd: periodEnd,
    },
  });
  console.log('✓ Utilisateur PREMIUM (mensuel) créé : monthly-e2e@test.com');

  const annualEnd = new Date();
  annualEnd.setDate(annualEnd.getDate() + 300);

  await prisma.user.upsert({
    where: { email: 'annual-e2e@test.com' },
    update: {},
    create: {
      email: 'annual-e2e@test.com',
      password: e2ePassword,
      name: 'Annual E2E',
      plan: Plan.PREMIUM,
      onboardingCompleted: true,
      stripeInterval: 'year',
      stripeCurrentPeriodEnd: annualEnd,
    },
  });
  console.log('✓ Utilisateur PREMIUM (annuel) créé : annual-e2e@test.com');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
