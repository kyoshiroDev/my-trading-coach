// Script de seed pour injecter des trades fictifs pour Gregory
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: 'postgresql://mtc_user:devpassword@localhost:5432/mytradingcoach_dev',
});

const EMOTIONS = ['CONFIDENT', 'FOCUSED', 'NEUTRAL', 'STRESSED', 'FEAR', 'REVENGE'];
const SETUPS   = ['BREAKOUT', 'PULLBACK', 'RANGE', 'REVERSAL', 'SCALPING', 'NEWS'];
const SESSIONS = ['LONDON', 'NEW_YORK', 'ASIAN', 'PRE_MARKET', 'OVERLAP'];
const ASSETS   = ['BTC/USDT', 'ETH/USDT', 'EUR/USD', 'GBP/USD', 'AAPL', 'SOL/USDT', 'NQ', 'ES'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateTrade(userId, date) {
  const side      = Math.random() > 0.5 ? 'LONG' : 'SHORT';
  const entry     = parseFloat(rand(100, 50000).toFixed(2));
  const pnlSign   = Math.random() > 0.42 ? 1 : -1; // ~58% win rate
  const pnl       = parseFloat((pnlSign * rand(50, 800)).toFixed(2));
  const exit      = parseFloat((entry + (side === 'LONG' ? pnl / 10 : -pnl / 10)).toFixed(2));
  const riskReward = parseFloat(rand(0.8, 3.5).toFixed(2));

  return {
    userId,
    asset:      pick(ASSETS),
    side,
    entry,
    exit,
    stopLoss:   parseFloat((entry * (side === 'LONG' ? 0.985 : 1.015)).toFixed(2)),
    takeProfit: parseFloat((entry * (side === 'LONG' ? 1.025 : 0.975)).toFixed(2)),
    pnl,
    riskReward,
    emotion:    pick(EMOTIONS),
    setup:      pick(SETUPS),
    session:    pick(SESSIONS),
    timeframe:  pick(['1m','5m','15m','30m','1h','4h','1D']),
    notes:      null,
    tags:       '{}',
    tradedAt:   date.toISOString(),
  };
}

async function main() {
  // Trouver Gregory
  const { rows: users } = await pool.query(
    `SELECT id, email FROM "User" WHERE email = 'tahir.gregory@gmail.com'`
  );

  if (!users.length) {
    console.error('Utilisateur tahir.gregory@gmail.com introuvable.');
    process.exit(1);
  }

  const userId = users[0].id;
  console.log(`Utilisateur trouvé : ${users[0].email} (${userId})`);

  // Générer 90 trades sur les 90 derniers jours (1-2 trades/jour)
  const trades = [];
  const now = new Date();

  for (let daysAgo = 89; daysAgo >= 0; daysAgo--) {
    const tradesThisDay = Math.random() > 0.25 ? (Math.random() > 0.5 ? 2 : 1) : 0;
    for (let i = 0; i < tradesThisDay; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - daysAgo);
      date.setHours(Math.floor(rand(8, 20)), Math.floor(rand(0, 59)));
      trades.push(generateTrade(userId, date));
    }
  }

  console.log(`Insertion de ${trades.length} trades...`);

  for (const t of trades) {
    await pool.query(`
      INSERT INTO "Trade" (id, "userId", asset, side, entry, exit, "stopLoss", "takeProfit", pnl, "riskReward", emotion, setup, session, timeframe, notes, tags, "tradedAt", "createdAt")
      VALUES (
        gen_random_uuid(), $1, $2, $3::\"TradeSide\", $4, $5, $6, $7, $8, $9,
        $10::\"EmotionState\", $11::\"SetupType\", $12::\"TradingSession\", $13, $14, $15, $16, NOW()
      )
    `, [
      t.userId, t.asset, t.side, t.entry, t.exit, t.stopLoss, t.takeProfit,
      t.pnl, t.riskReward, t.emotion, t.setup, t.session, t.timeframe,
      t.notes, t.tags, t.tradedAt,
    ]);
  }

  console.log(`✓ ${trades.length} trades insérés pour Gregory.`);

  const { rows: count } = await pool.query(
    `SELECT COUNT(*) FROM "Trade" WHERE "userId" = $1`, [userId]
  );
  console.log(`Total trades en base : ${count[0].count}`);

  await pool.end();
}

main().catch(e => { console.error(e); pool.end(); process.exit(1); });
