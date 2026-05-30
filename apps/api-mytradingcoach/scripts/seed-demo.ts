import { PrismaClient, TradeSide, EmotionState, SetupType, TradingSession } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool    = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const TARGET_EMAIL = 'tahir.gregory.dev@gmail.com';

const DEMO_TRADES = [
  { asset: 'MNQ',      side: 'LONG',  entry: 18250,  exit: 18310,  pnl: 240,  rr: 2.4, qty: 2, emotion: 'CONFIDENT', setup: 'BREAKOUT', session: 'LONDON',   tf: '5m',  daysAgo: 20, hour: 9 },
  { asset: 'BTC/USDT', side: 'LONG',  entry: 63800,  exit: 64200,  pnl: 180,  rr: 1.8, qty: 1, emotion: 'FOCUSED',   setup: 'PULLBACK', session: 'LONDON',   tf: '15m', daysAgo: 19, hour: 10 },
  { asset: 'MNQ',      side: 'SHORT', entry: 18400,  exit: 18370,  pnl: -120, rr: 1.5, qty: 2, emotion: 'STRESSED',  setup: 'REVERSAL', session: 'NEW_YORK', tf: '5m',  daysAgo: 18, hour: 15 },
  { asset: 'EUR/USD',  side: 'LONG',  entry: 1.0820, exit: 1.0865, pnl: 210,  rr: 2.1, qty: 1, emotion: 'CONFIDENT', setup: 'BREAKOUT', session: 'LONDON',   tf: '15m', daysAgo: 17, hour: 9 },
  { asset: 'MES',      side: 'LONG',  entry: 5180,   exit: 5172,   pnl: -95,  rr: 1.6, qty: 1, emotion: 'NEUTRAL',   setup: 'RANGE',    session: 'NEW_YORK', tf: '5m',  daysAgo: 16, hour: 16 },
  { asset: 'BTC/USDT', side: 'LONG',  entry: 64500,  exit: 65100,  pnl: 320,  rr: 2.8, qty: 1, emotion: 'FOCUSED',   setup: 'BREAKOUT', session: 'LONDON',   tf: '1h',  daysAgo: 14, hour: 8 },
  { asset: 'MNQ',      side: 'LONG',  entry: 18500,  exit: 18555,  pnl: 220,  rr: 2.2, qty: 2, emotion: 'CONFIDENT', setup: 'PULLBACK', session: 'LONDON',   tf: '5m',  daysAgo: 13, hour: 10 },
  { asset: 'GC',       side: 'SHORT', entry: 2350,   exit: 2358,   pnl: -140, rr: 1.4, qty: 1, emotion: 'REVENGE',   setup: 'SCALPING', session: 'NEW_YORK', tf: '1m',  daysAgo: 13, hour: 17 },
  { asset: 'EUR/USD',  side: 'LONG',  entry: 1.0840, exit: 1.0880, pnl: 190,  rr: 2.0, qty: 1, emotion: 'FOCUSED',   setup: 'BREAKOUT', session: 'LONDON',   tf: '15m', daysAgo: 11, hour: 9 },
  { asset: 'MNQ',      side: 'LONG',  entry: 18600,  exit: 18640,  pnl: 160,  rr: 1.9, qty: 2, emotion: 'CONFIDENT', setup: 'PULLBACK', session: 'NEW_YORK', tf: '5m',  daysAgo: 9,  hour: 15 },
  { asset: 'BTC/USDT', side: 'SHORT', entry: 66000,  exit: 66300,  pnl: -160, rr: 1.5, qty: 1, emotion: 'FEAR',      setup: 'REVERSAL', session: 'ASIAN',    tf: '15m', daysAgo: 8,  hour: 3 },
  { asset: 'MES',      side: 'LONG',  entry: 5210,   exit: 5230,   pnl: 250,  rr: 2.5, qty: 2, emotion: 'CONFIDENT', setup: 'BREAKOUT', session: 'NEW_YORK', tf: '5m',  daysAgo: 6,  hour: 16 },
  { asset: 'MNQ',      side: 'SHORT', entry: 18700,  exit: 18680,  pnl: 130,  rr: 1.7, qty: 1, emotion: 'FOCUSED',   setup: 'RANGE',    session: 'LONDON',   tf: '5m',  daysAgo: 4,  hour: 11 },
  { asset: 'EUR/USD',  side: 'LONG',  entry: 1.0860, exit: 1.0850, pnl: -85,  rr: 1.3, qty: 1, emotion: 'STRESSED',  setup: 'NEWS',     session: 'NEW_YORK', tf: '15m', daysAgo: 2,  hour: 14 },
];

async function main() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) throw new Error(`User introuvable : ${TARGET_EMAIL}`);
  console.log(`Cible DEV : ${user.email} (${user.id})`);

  for (const t of DEMO_TRADES) {
    const tradedAt = new Date();
    tradedAt.setDate(tradedAt.getDate() - t.daysAgo);
    tradedAt.setHours(t.hour, Math.floor(Math.random() * 55), 0, 0);

    await prisma.trade.create({
      data: {
        userId:     user.id,
        asset:      t.asset,
        side:       t.side as TradeSide,
        entry:      t.entry,
        exit:       t.exit,
        pnl:        t.pnl,
        riskReward: t.rr,
        quantity:   t.qty,
        emotion:    t.emotion as EmotionState,
        setup:      t.setup as SetupType,
        session:    t.session as TradingSession,
        timeframe:  t.tf,
        tags:       ['DEMO_SEED'],
        tradedAt,
      },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data:  { startingCapital: 10000 },
  });

  const total = DEMO_TRADES.reduce((s, t) => s + t.pnl, 0);
  const wins  = DEMO_TRADES.filter(t => t.pnl > 0).length;
  console.log(`✅ ${DEMO_TRADES.length} trades créés.`);
  console.log(`   Win rate  : ${Math.round(wins / DEMO_TRADES.length * 100)}%`);
  console.log(`   P&L total : +$${total}`);
  console.log(`   Capital départ réglé à $10 000`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
